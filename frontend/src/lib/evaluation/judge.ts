import type { GoldenDataset, GoldenValue } from '../dataset';
import { normalizeStr, toItems } from './normalize';
import type { DatasetEvaluation, FieldEvaluation, JudgeFieldResult, JudgeVerdict } from './types';
import {
  JUDGE_MODEL_ID,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  JUDGE_VERDICTS,
  buildJudgeUserPrompt,
  type JudgeCandidate,
} from './judgePrompt';
import { applyJudgeMap, countReviewed, countUplifts, type JudgeResultMap } from './uplift';
import { aggregateFieldEvaluations } from './evaluate';
import { callLlmJson } from '../api';
import { JUDGE_ENDPOINT } from './judgePrompt';

/** Fields with partial below this (and not perfect match) are candidates. */
export const JUDGE_PARTIAL_THRESHOLD = 1;

/** Max candidates sent to the judge per model run. */
export const JUDGE_MAX_CANDIDATES = 40;

/** Items per LLM request. */
export const JUDGE_BATCH_SIZE = 15;

const VERDICT_SET = new Set<string>(JUDGE_VERDICTS);

export function isJudgeVerdict(v: unknown): v is JudgeVerdict {
  return typeof v === 'string' && VERDICT_SET.has(v);
}

/** Session-scoped cache: never re-ask for the same (field, gold, model, prompt). */
const judgeCache = new Map<string, JudgeFieldResult>();

export function clearJudgeCache(): void {
  judgeCache.clear();
}

export function judgeCacheKey(
  id: string,
  goldenValue: string,
  modelValue: string
): string {
  return [
    JUDGE_PROMPT_VERSION,
    id,
    normalizeStr(goldenValue),
    normalizeStr(modelValue),
  ].join('\u0001');
}

export function getCachedJudge(key: string): JudgeFieldResult | undefined {
  return judgeCache.get(key);
}

export function setCachedJudge(key: string, result: JudgeFieldResult): void {
  judgeCache.set(key, result);
}

function formatValue(v: GoldenValue): string {
  if (Array.isArray(v)) return v.map(String).join(' | ');
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v)
      .map(([k, val]) => `${k}: ${val}`)
      .join(' | ');
  }
  return String(v);
}

/**
 * Select weak fields (and weak list items) for semantic judging.
 */
export function selectJudgeCandidates(
  evaluation: DatasetEvaluation,
  golden: GoldenDataset,
  modelData: Record<string, GoldenValue>
): JudgeCandidate[] {
  const out: JudgeCandidate[] = [];

  for (const f of evaluation.perField) {
    if (!needsJudge(f)) continue;

    const goldField = golden.golden_extraction[f.key];
    if (!goldField) continue;
    const modelVal = modelData[f.key] ?? 'not_found';

    // List fields: prefer item-level candidates for low-sim / unmatched gold items.
    if (f.kind === 'array' || f.kind === 'object') {
      const goldItems = toItems(goldField.value, f.kind);
      const modelItems = toItems(modelVal, f.kind);
      let addedItem = false;

      for (const a of f.alignments) {
        const gIdx = a.goldenIndex;
        const gText = goldItems[gIdx] ?? '';
        const mText =
          a.modelIndex != null && a.modelIndex >= 0
            ? (modelItems[a.modelIndex] ?? '')
            : '';
        if (a.similarity >= JUDGE_PARTIAL_THRESHOLD && a.modelIndex != null) continue;

        out.push({
          id: `${f.key}#${gIdx}`,
          fieldKey: f.key,
          label: f.label,
          kind: 'item',
          listMode: f.config.listMode,
          goldenValue: gText,
          modelValue: mText || '(missing)',
          detPartial: a.similarity,
          detMatch: a.similarity >= 1,
        });
        addedItem = true;
        if (out.length >= JUDGE_MAX_CANDIDATES) return out;
      }

      // Also cover unmatched model extras as field-level context if no item rows.
      if (!addedItem) {
        out.push(fieldCandidate(f, goldField.value, modelVal));
        if (out.length >= JUDGE_MAX_CANDIDATES) return out;
      }
      continue;
    }

    out.push(fieldCandidate(f, goldField.value, modelVal));
    if (out.length >= JUDGE_MAX_CANDIDATES) return out;
  }

  return out;
}

function fieldCandidate(
  f: FieldEvaluation,
  gold: GoldenValue,
  model: GoldenValue
): JudgeCandidate {
  return {
    id: f.key,
    fieldKey: f.key,
    label: f.label,
    kind: f.kind,
    listMode: f.config.listMode,
    goldenValue: formatValue(gold),
    modelValue: formatValue(model),
    detPartial: f.partial,
    detMatch: f.match,
  };
}

export function needsJudge(f: FieldEvaluation): boolean {
  if (f.goldenCount === 0 && f.modelCount === 0) return false;
  if (f.match && f.partial >= 1) return false;
  return !f.match || f.partial < JUDGE_PARTIAL_THRESHOLD;
}

/** Parse judge JSON body into a result map (invalid verdicts → unknown). */
export function parseJudgeResponse(raw: unknown, expectedIds: string[]): JudgeResultMap {
  const map: JudgeResultMap = {};
  const expected = new Set(expectedIds);

  let results: unknown[] = [];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results)) {
    results = (raw as { results: unknown[] }).results;
  } else if (Array.isArray(raw)) {
    results = raw;
  }

  for (const row of results) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id || !expected.has(id)) continue;
    const verdict: JudgeVerdict = isJudgeVerdict(r.verdict) ? r.verdict : 'unknown';
    const rationale =
      typeof r.rationale === 'string' && r.rationale.trim()
        ? r.rationale.trim()
        : 'No rationale provided.';
    map[id] = { id, verdict, rationale };
  }

  // Fill missing expected ids as unknown.
  for (const id of expectedIds) {
    if (!map[id]) {
      map[id] = {
        id,
        verdict: 'unknown',
        rationale: 'Judge did not return a verdict for this field.',
      };
    }
  }

  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface JudgeRunOptions {
  apiKey: string;
  signal?: AbortSignal;
  /** Pre-seeded results (e.g. from prior session state). */
  priorResults?: JudgeResultMap;
}

export interface JudgeRunOutcome {
  results: JudgeResultMap;
  evaluation: DatasetEvaluation;
  fromCache: number;
  fetched: number;
  error?: string;
}

/**
 * Run semantic judge on weak fields, apply deterministic uplift, re-aggregate.
 */
export async function runSemanticJudgeAndUplift(
  detEvaluation: DatasetEvaluation,
  golden: GoldenDataset,
  modelData: Record<string, GoldenValue>,
  options: JudgeRunOptions
): Promise<JudgeRunOutcome> {
  const detAccuracy = detEvaluation.accuracy;
  const candidates = selectJudgeCandidates(detEvaluation, golden, modelData);

  const results: JudgeResultMap = { ...(options.priorResults ?? {}) };
  let fromCache = 0;
  let fetched = 0;

  if (candidates.length === 0) {
    const evaluation = finalizeEvaluation(detEvaluation.perField, results, detAccuracy);
    return { results, evaluation, fromCache: 0, fetched: 0 };
  }

  if (!options.apiKey?.trim()) {
    const evaluation = finalizeEvaluation(detEvaluation.perField, {}, detAccuracy);
    return {
      results: {},
      evaluation,
      fromCache: 0,
      fetched: 0,
      error: 'OpenAI API key required for semantic judge (gpt-5.4-nano).',
    };
  }

  const toFetch: JudgeCandidate[] = [];
  for (const c of candidates) {
    const key = judgeCacheKey(c.id, c.goldenValue, c.modelValue);
    const cached = getCachedJudge(key) ?? results[c.id];
    if (cached) {
      results[c.id] = cached;
      fromCache += 1;
    } else {
      toFetch.push(c);
    }
  }

  try {
    for (const batch of chunk(toFetch, JUDGE_BATCH_SIZE)) {
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const user = buildJudgeUserPrompt(batch);
      const raw = await callLlmJson({
        endpoint: JUDGE_ENDPOINT,
        apiKey: options.apiKey,
        modelId: JUDGE_MODEL_ID,
        system: JUDGE_SYSTEM_PROMPT,
        user,
        signal: options.signal,
      });
      const parsed = parseJudgeResponse(
        raw,
        batch.map((c) => c.id)
      );
      for (const c of batch) {
        const r = parsed[c.id]!;
        results[c.id] = r;
        setCachedJudge(judgeCacheKey(c.id, c.goldenValue, c.modelValue), r);
        fetched += 1;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Partial results still apply; missing stay without overlay.
    const evaluation = finalizeEvaluation(detEvaluation.perField, results, detAccuracy);
    return { results, evaluation, fromCache, fetched, error: message };
  }

  const evaluation = finalizeEvaluation(detEvaluation.perField, results, detAccuracy);
  return { results, evaluation, fromCache, fetched };
}

function finalizeEvaluation(
  detFields: FieldEvaluation[],
  results: JudgeResultMap,
  detAccuracy: number
): DatasetEvaluation {
  const uplifted = applyJudgeMap(detFields, results);
  const agg = aggregateFieldEvaluations(uplifted);
  return {
    ...agg,
    detAccuracy,
    judgeUpliftCount: countUplifts(uplifted),
    judgeReviewedCount: countReviewed(uplifted),
  };
}

/** Re-apply stored judge results after config change (no LLM). */
export function reapplyJudgeResults(
  detEvaluation: DatasetEvaluation,
  results: JudgeResultMap
): DatasetEvaluation {
  return finalizeEvaluation(detEvaluation.perField, results, detEvaluation.accuracy);
}
