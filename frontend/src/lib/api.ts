import { coerceExtracted, NOT_FOUND, type GoldenValue, type ValueKind } from './dataset';

export interface PageImage {
  page: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type ModelStatus = 'idle' | 'loading' | 'done' | 'error';

export interface ModelResult {
  modelId: string;
  label: string;
  data: Record<string, GoldenValue>;
  rawText: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  status: ModelStatus;
  error?: string;
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

export interface DoclingDocumentPage {
  page: number;
  markdown: string;
  document: unknown;
}

export interface DoclingDocumentPayload {
  engine: string;
  model: string;
  pages: DoclingDocumentPage[];
}

interface DoclingBackendResponse {
  text: string;
  document: DoclingDocumentPayload;
}

interface VisionPayloadResult {
  data: Record<string, GoldenValue>;
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

/** Run the local Docling MLX pipeline on the converted page images. */
export async function runDoclingPipeline(
  pages: PageImage[]
): Promise<{ text: string; document: DoclingDocumentPayload }> {
  const res = await fetch('/api/docling', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pages: pages.map((page) => ({ page: page.page, dataUrl: page.dataUrl })),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(formatHttpError(res.status, errText || res.statusText));
  }

  const data = (await res.json()) as DoclingBackendResponse;
  return {
    text: typeof data.text === 'string' ? data.text : '',
    document: data.document,
  };
}

/**
 * Call an OpenAI-compatible vision endpoint (Z.AI GLM-5V-Turbo or OpenAI gpt-5.4-mini).
 * Sends every page image + the dataset-driven prompt. temperature: 0 and
 * response_format: json_object per the fixed integration spec. Output is coerced
 * to the golden field shape before it is ever displayed/scored.
 */
export async function callVisionModel(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  kinds: Record<string, ValueKind>
): Promise<Omit<ModelResult, 'status' | 'error'>> {
  const startedAt = performance.now();
  const result = await callVisionWithFallback(config, pages, prompt, kinds);

  return {
    modelId: config.modelId,
    label: config.label,
    data: result.data,
    rawText: result.rawText,
    elapsedMs: performance.now() - startedAt,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    estimatedCostUsd: result.estimatedCostUsd,
  };
}

async function callVisionWithFallback(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  kinds: Record<string, ValueKind>
): Promise<VisionPayloadResult> {
  try {
    return await callVisionOnce(config, pages, prompt, kinds);
  } catch (error) {
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
      results.push(await callVisionWithFallback(config, batch, prompt, kinds));
    }

    return mergeChunkResults(results, kinds);
  }
}

async function callVisionOnce(
  config: VisionConfig,
  pages: PageImage[],
  prompt: string,
  kinds: Record<string, ValueKind>
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

  const data = coerceExtracted(parseJsonLoose(contentText), kinds);

  return {
    data,
    rawText: contentText,
    promptTokens,
    completionTokens,
    estimatedCostUsd:
      (promptTokens / 1_000_000) * config.inputPer1m +
      (completionTokens / 1_000_000) * config.outputPer1m,
  };
}

function mergeChunkResults(
  results: VisionPayloadResult[],
  kinds: Record<string, ValueKind>
): VisionPayloadResult {
  const data: Record<string, GoldenValue> = {};

  for (const [key, kind] of Object.entries(kinds)) {
    data[key] = mergeFieldValue(
      results.map((result) => result.data[key]),
      kind
    );
  }

  return {
    data,
    rawText: results
      .map((result, index) => result.rawText.trim() && `Batch ${index + 1}\n${result.rawText.trim()}`)
      .filter(Boolean)
      .join('\n\n'),
    promptTokens: results.reduce((sum, result) => sum + result.promptTokens, 0),
    completionTokens: results.reduce((sum, result) => sum + result.completionTokens, 0),
    estimatedCostUsd: results.reduce((sum, result) => sum + result.estimatedCostUsd, 0),
  };
}

function mergeFieldValue(values: Array<GoldenValue | undefined>, kind: ValueKind): GoldenValue {
  if (kind === 'array') {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const normalized = normalizeText(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        merged.push(item);
      }
    }

    return merged;
  }

  if (kind === 'object') {
    const merged: Record<string, string> = {};

    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [key, item] of Object.entries(value)) {
        if (!(key in merged) && !isAbsentScalar(item)) {
          merged[key] = item;
        }
      }
    }

    return merged;
  }

  for (const value of values) {
    if (typeof value === 'string' && !isAbsentScalar(value)) {
      return value;
    }
  }

  return NOT_FOUND;
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

function isAbsentScalar(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === NOT_FOUND;
}

function isHttpStatusError(error: unknown, status: number): error is HttpStatusError {
  return error instanceof Error && 'status' in error && error.status === status;
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
