import { type GoldenValue } from './dataset';
import { normalizeVlmToDraft, mergeDrafts } from './canonical/vlm';
import { project } from './canonical/project';
import { validate, type Issue } from './canonical/validate';
import type { SourceContext } from './canonical/adapters/types';
import type { RescueSheetV1Draft } from './canonical/schema';
import type { DatasetEvaluation, JudgeFieldResult } from './evaluation/types';

export interface PageImage {
  page: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type ModelStatus = 'idle' | 'loading' | 'done' | 'error';

/** Semantic judge lifecycle (runs after extraction when fields score low). */
export type JudgeStatus = 'idle' | 'judging' | 'done' | 'error' | 'skipped';

export interface ModelResult {
  modelId: string;
  label: string;
  data: Record<string, GoldenValue>;
  /** Canonical draft produced by normalizing the model's raw JSON. */
  draft?: RescueSheetV1Draft;
  /** Validation issues on the canonical draft (informational; never blocks). */
  validationIssues?: Issue[];
  rawText: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  status: ModelStatus;
  error?: string;
  /**
   * Post-uplift dataset evaluation (deterministic + optional LLM judge).
   * When present, UI gauges prefer this over re-scoring from scratch.
   */
  evaluation?: DatasetEvaluation;
  /** Field/item id → judge verdict map for re-apply after config edits. */
  judgeResults?: Record<string, JudgeFieldResult>;
  judgeStatus?: JudgeStatus;
  judgeError?: string;
}

export interface VisionConfig {
  modelId: string;
  label: string;
  endpoint: string;
  apiKey: string;
  /** USD per 1M tokens. */
  inputPer1m: number;
  outputPer1m: number;
}

// Per-model pricing estimates (labelled "est." in the UI). Update with live rates.
export const GLM_PRICING = { inputPer1m: 0.5, outputPer1m: 1.5 };
export const GPT_PRICING = { inputPer1m: 0.5, outputPer1m: 2.0 };

interface BackendResponse {
  dpi: number;
  pages: number;
  images: Array<{ page: number; width: number; height: number; dataUrl: string }>;
}

interface VisionPayloadResult {
  draft: RescueSheetV1Draft;
  rawText: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

interface HttpStatusError extends Error {
  status: number;
}

/** Convert an uploaded PDF to PNG pages via the backend (300 DPI). */
export async function convertPdfToPages(
  file: File
): Promise<{ dpi: number; pages: PageImage[]; pdfName: string }> {
  const fd = new FormData();
  fd.append('pdf', file);
  const res = await fetch('/api/extract', { method: 'POST', body: fd });
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error ?? `Conversion failed (HTTP ${res.status})`);
  }
  const data: BackendResponse = await res.json();
  const pages: PageImage[] = data.images.map((img) => ({
    page: img.page,
    width: img.width,
    height: img.height,
    dataUrl: img.dataUrl,
  }));
  return { dpi: data.dpi, pages, pdfName: file.name };
}
/**
 * Call an OpenAI-compatible vision endpoint (Z.AI GLM-5V-Turbo or OpenAI gpt-5.4-mini).
 * Sends every page image + the canonical-schema-driven prompt. temperature: 0 and
 * response_format: json_object per the fixed integration spec. The raw model JSON
 * is normalized to a canonical draft, validated, then projected to the field map
 * the scorer consumes.
 */
export async function callVisionModel(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  ctx: SourceContext,
  signal?: AbortSignal
): Promise<Omit<ModelResult, 'status' | 'error'>> {
  const startedAt = performance.now();
  const result = await callVisionWithFallback(config, pages, prompt, ctx, signal);
  const data = flattenProjection(project(result.draft));
  const validation = validate(result.draft);

  return {
    modelId: config.modelId,
    label: config.label,
    data,
    draft: result.draft,
    validationIssues: validation.issues,
    rawText: result.rawText,
    elapsedMs: performance.now() - startedAt,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    estimatedCostUsd: result.estimatedCostUsd,
  };
}

/** Flatten a canonical projection into the `path -> GoldenValue` map the scorer reads. */
function flattenProjection(proj: ReturnType<typeof project>): Record<string, GoldenValue> {
  const out: Record<string, GoldenValue> = {};
  for (const [path, field] of Object.entries(proj)) {
    out[path] = field.value;
  }
  return out;
}

async function callVisionWithFallback(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  ctx: SourceContext,
  signal?: AbortSignal
): Promise<VisionPayloadResult> {
  try {
    return await callVisionOnce(config, pages, prompt, ctx, signal);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    if (!isHttpStatusError(error, 413)) throw error;

    if (pages.length === 1) {
        throw createHttpStatusError(
          413,
          'HTTP 413: request body too large even after retrying with single-page batches. Increase the proxy or upstream body-size limit for 300 DPI PNG pages.'
        );
      }

    const [left, right] = splitPages(pages);
    const results: VisionPayloadResult[] = [];

    for (const batch of [left, right]) {
      results.push(await callVisionWithFallback(config, batch, prompt, ctx, signal));
    }

    return mergeChunkResults(results);
  }
}

async function callVisionOnce(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  ctx: SourceContext,
  signal?: AbortSignal
): Promise<VisionPayloadResult> {
  const content: unknown[] = [
    { type: 'text', text: prompt },
    ...pages.map((p) => ({ type: 'image_url', image_url: { url: p.dataUrl } })),
  ];

  const payload = {
    model: config.modelId,
    messages: [{ role: 'user', content }],
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Route through the backend pass-through to avoid browser CORS: neither
    // Z.AI nor OpenAI return CORS headers, so direct browser fetches can't read
    // the response. The backend forwards endpoint + Authorization verbatim.
    signal,
    body: JSON.stringify({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      payload,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw createHttpStatusError(res.status, formatHttpError(res.status, errText || res.statusText));
  }

  const json = await res.json();
  const contentText: string = json?.choices?.[0]?.message?.content ?? '';
  const usage = json?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);

  const draft = normalizeVlmToDraft(parseJsonLoose(contentText), ctx);

  return {
    draft,
    rawText: contentText,
    promptTokens,
    completionTokens,
    estimatedCostUsd:
      (promptTokens / 1_000_000) * config.inputPer1m +
      (completionTokens / 1_000_000) * config.outputPer1m,
  };
}

/** Merge per-chunk canonical drafts + usage for the HTTP 413 page-split fallback. */
function mergeChunkResults(results: VisionPayloadResult[]): VisionPayloadResult {
  return {
    draft: mergeDrafts(results.map((r) => r.draft)),
    rawText: results
      .map((result, index) => result.rawText.trim() && `Batch ${index + 1}\n${result.rawText.trim()}`)
      .filter(Boolean)
      .join('\n\n'),
    promptTokens: results.reduce((sum, result) => sum + result.promptTokens, 0),
    completionTokens: results.reduce((sum, result) => sum + result.completionTokens, 0),
    estimatedCostUsd: results.reduce((sum, result) => sum + result.estimatedCostUsd, 0),
  };
}

function splitPages(pages: PageImage[]): [PageImage[], PageImage[]] {
  const midpoint = Math.ceil(pages.length / 2);
  return [pages.slice(0, midpoint), pages.slice(midpoint)];
}

function formatHttpError(status: number, text: string): string {
  if (status === 413) {
    return 'HTTP 413: request body too large.';
  }

  const summary = summarizeBodyText(text);
  return `HTTP ${status}: ${summary || 'Request failed.'}`;
}

function summarizeBodyText(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isHttpStatusError(error: unknown, status: number): error is HttpStatusError {
  return error instanceof Error && 'status' in error && error.status === status;
}

/** True for a fetch aborted via AbortController (i.e. user cancel). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      // Some runtimes surface aborted fetches as a TypeError "aborted"
      /aborted/i.test(error.message))
  );
}

export interface LlmJsonCallOptions {
  endpoint: string;
  apiKey: string;
  modelId: string;
  system?: string;
  user: string;
  signal?: AbortSignal;
  temperature?: number;
}

/**
 * Text-only OpenAI-compatible chat completion expecting a JSON object body.
 * Used by the semantic judge (no images). Routes through `/api/llm` for CORS.
 */
export async function callLlmJson(options: LlmJsonCallOptions): Promise<unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.system?.trim()) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: options.user });

  const payload = {
    model: options.modelId,
    messages,
    temperature: options.temperature ?? 0,
    response_format: { type: 'json_object' as const },
  };

  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      payload,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw createHttpStatusError(res.status, formatHttpError(res.status, errText || res.statusText));
  }

  const json = await res.json();
  const contentText: string = json?.choices?.[0]?.message?.content ?? '';
  if (!contentText.trim()) {
    throw new Error('Judge returned empty content.');
  }
  return parseJsonLoose(contentText);
}

function createHttpStatusError(status: number, message: string): HttpStatusError {
  return Object.assign(new Error(message), { status });
}

/** Tolerant JSON parse: models occasionally wrap JSON in prose or code fences. */
export function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        /* fall through */
      }
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        /* give up */
      }
    }
    return null;
  }
}
