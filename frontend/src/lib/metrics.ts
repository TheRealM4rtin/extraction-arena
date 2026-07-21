/**
 * Compatibility facade over the unified evaluation engine.
 * Prefer importing from `@/lib/evaluation` for new code.
 */
import type { GoldenValue } from './dataset';
import {
  evaluateField,
  resolveFieldConfig,
  meanPrf,
  scoreBand,
  DEFAULT_FIELD_CONFIG,
  type FieldEvalConfig,
  type MatchStrategy,
  type OptimizationPriority,
  type PRF,
  type FieldEvaluation,
} from './evaluation';

export type { MatchStrategy, OptimizationPriority, PRF, FieldEvalConfig };
export { scoreBand, DEFAULT_FIELD_CONFIG, resolveFieldConfig };

/** @deprecated Use FieldEvalConfig — kept for store/UI compatibility. */
export type FieldMetricConfig = FieldEvalConfig;

export interface FieldMetricsRow {
  key: string;
  config: FieldEvalConfig;
  byModel: Record<string, PRF>;
  avg: PRF;
  hasData: boolean;
  /** Full per-model field evaluations when available. */
  evaluationsByModel?: Record<string, FieldEvaluation>;
  avgEvaluation?: FieldEvaluation;
}

/**
 * Build dashboard rows from the same engine the main UI uses.
 */
export function buildDashboardRows(
  goldenKeys: string[],
  goldenExtraction: Record<string, { value: GoldenValue }>,
  modelResults: Array<{ id: string; data: Record<string, GoldenValue> }>,
  configs: Record<string, Partial<FieldEvalConfig>>
): FieldMetricsRow[] {
  return goldenKeys.map((key) => {
    const config = resolveFieldConfig(key, configs[key]);
    const goldenValue = goldenExtraction[key]?.value;
    const byModel: Record<string, PRF> = {};
    const evaluationsByModel: Record<string, FieldEvaluation> = {};

    for (const { id, data } of modelResults) {
      if (goldenValue === undefined) continue;
      // Same universe as evaluateDataset: missing keys score as not_found.
      const modelValue = data[key] ?? 'not_found';
      const ev = evaluateField(modelValue, goldenValue, key, config);
      evaluationsByModel[id] = ev;
      byModel[id] = {
        precision: ev.precision,
        recall: ev.recall,
        f1: ev.f1,
      };
    }

    const n = Object.keys(byModel).length;
    const avg: PRF =
      n === 0
        ? { precision: 0, recall: 0, f1: 0 }
        : {
            precision:
              Object.values(byModel).reduce((s, p) => s + p.precision, 0) / n,
            recall: Object.values(byModel).reduce((s, p) => s + p.recall, 0) / n,
            f1: Object.values(byModel).reduce((s, p) => s + p.f1, 0) / n,
          };

    return {
      key,
      config,
      byModel,
      avg,
      hasData: n > 0,
      evaluationsByModel,
    };
  });
}

export function computeFieldPRF(
  modelValue: GoldenValue,
  goldenValue: GoldenValue,
  strategy: MatchStrategy,
  fieldKey = '',
  listMode?: FieldEvalConfig['listMode']
): PRF {
  const config = resolveFieldConfig(fieldKey, {
    matchStrategy: strategy,
    ...(listMode ? { listMode } : {}),
  });
  const ev = evaluateField(modelValue, goldenValue, fieldKey, config);
  return { precision: ev.precision, recall: ev.recall, f1: ev.f1 };
}

export function aggregateRows(
  rows: FieldMetricsRow[],
  view: string
): PRF & { count: number } {
  const prfs: PRF[] = [];
  for (const row of rows) {
    const prf = view === 'avg' ? (row.hasData ? row.avg : undefined) : row.byModel[view];
    if (!prf) continue;
    prfs.push(prf);
  }
  // meanPrf expects FieldEvaluation — map PRF-only
  if (prfs.length === 0) return { precision: 0, recall: 0, f1: 0, count: 0 };
  let p = 0;
  let r = 0;
  let f = 0;
  for (const prf of prfs) {
    p += prf.precision;
    r += prf.recall;
    f += prf.f1;
  }
  const count = prfs.length;
  return { precision: p / count, recall: r / count, f1: f / count, count };
}

// Re-export for any code that imported mean helpers
export { meanPrf };
