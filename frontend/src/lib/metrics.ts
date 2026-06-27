import {
  type GoldenValue,
  type ValueKind,
  valueKind,
} from './dataset';
import { isAbsentValue, normalizeStr, tokenizeScalar } from './scoring';

/** Per-field match strategy, configurable from the Golden Dataset page. */
export type MatchStrategy = 'exact' | 'partial';

/** Per-field optimization priority, configurable from the Golden Dataset page. */
export type OptimizationPriority = 'precision' | 'recall';

/** Per-field evaluation configuration set on the Golden Dataset page. */
export interface FieldMetricConfig {
  matchStrategy: MatchStrategy;
  priority: OptimizationPriority;
}

/** Default config applied to any field the user hasn't customized. */
export const DEFAULT_FIELD_CONFIG: FieldMetricConfig = {
  matchStrategy: 'partial',
  priority: 'recall',
};

export interface PRF {
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Color band for a 0..1 score, per the Metrics Dashboard spec:
 * >= 0.95 green, 0.80–0.94 amber, < 0.80 red.
 */
export function scoreBand(score: number): 'green' | 'amber' | 'red' {
  if (score >= 0.95) return 'green';
  if (score >= 0.8) return 'amber';
  return 'red';
}

function tokenize(value: string): Set<string> {
  return new Set(tokenizeScalar(value));
}

/**
 * Token-overlap ratio in [0,1] between two strings, using shared tokens over
 * the larger token count (matches the diff UI's overlap heuristic). 1.0 means
 * one string's tokens fully cover the other.
 */
function tokenOverlap(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / Math.max(sa.size, sb.size);
}

/**
 * Per-item similarity under the chosen strategy.
 * - exact: 1 iff normalized strings are equal, else 0.
 * - partial: 1 on a normalized substring containment, otherwise token overlap.
 */
function itemSimilarity(
  model: string,
  golden: string,
  strategy: MatchStrategy
): number {
  const nm = normalizeStr(model);
  const ng = normalizeStr(golden);
  if (nm === ng) return 1;
  if (strategy === 'exact') return 0;
  if (nm === '' || ng === '') return 0;
  if (nm.includes(ng) || ng.includes(nm)) return 1;
  return tokenOverlap(nm, ng);
}

/** Convert a value to a list of comparable items based on its kind. */
function toItems(v: GoldenValue, kind: ValueKind): string[] {
  if (kind === 'array') return (v as string[]).map((x) => String(x));
  if (kind === 'object') {
    return Object.entries(v as Record<string, string>).map(
      ([k, val]) => `${k}\u0000${val}`
    );
  }
  return [String(v)];
}

/**
 * Greedy best-match alignment between golden and extracted items. For each
 * golden item, pair it with the unused extracted item of highest similarity
 * (if it crosses the strategy threshold). Returns the summed similarity of the
 * matched pairs — the shared numerator for precision and recall.
 *
 * Threshold: exact requires similarity === 1; partial requires >= 0.5 so only
 * meaningfully overlapping items count (mirrors the diff UI pairing rule).
 */
function matchedSimilarity(
  modelItems: string[],
  goldenItems: string[],
  strategy: MatchStrategy
): number {
  const threshold = strategy === 'exact' ? 1 : 0.5;
  const usedModel = new Set<number>();
  let sum = 0;

  for (const g of goldenItems) {
    let bestJ = -1;
    let bestSim = 0;
    modelItems.forEach((m, j) => {
      if (usedModel.has(j)) return;
      const sim = itemSimilarity(m, g, strategy);
      if (sim > bestSim) {
        bestSim = sim;
        bestJ = j;
      }
    });
    if (bestJ >= 0 && bestSim >= threshold) {
      usedModel.add(bestJ);
      sum += bestSim;
    }
  }

  return sum;
}

function harmonicMean(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Compute precision / recall / F1 for a single field, comparing one model's
 * extracted value against the golden value, under the chosen match strategy.
 *
 * Itemization follows the golden value's kind (array → items, object →
 * key/value pairs, scalar → single item). Absence uses standard TP/FP/FN
 * conventions: both absent = perfect; golden-absent + model-present = all
 * false positives (precision 0, recall 1); golden-present + model-absent =
 * all false negatives (precision 1, recall 0).
 */
export function computeFieldPRF(
  modelValue: GoldenValue,
  goldenValue: GoldenValue,
  strategy: MatchStrategy
): PRF {
  const mAbsent = isAbsentValue(modelValue);
  const gAbsent = isAbsentValue(goldenValue);

  if (mAbsent && gAbsent) return { precision: 1, recall: 1, f1: 1 };

  if (gAbsent && !mAbsent) {
    // Ground truth has no positives; every extraction is a false positive.
    return { precision: 0, recall: 1, f1: 0 };
  }

  if (mAbsent && !gAbsent) {
    // Model extracted nothing; every golden item is a false negative.
    return { precision: 1, recall: 0, f1: 0 };
  }

  const kind = valueKind(goldenValue);
  const modelItems = toItems(modelValue, kind);
  const goldenItems = toItems(goldenValue, kind);

  const numerator = matchedSimilarity(modelItems, goldenItems, strategy);
  const precision = modelItems.length === 0 ? 1 : numerator / modelItems.length;
  const recall = goldenItems.length === 0 ? 1 : numerator / goldenItems.length;

  return { precision, recall, f1: harmonicMean(precision, recall) };
}

export interface FieldMetricsRow {
  key: string;
  config: FieldMetricConfig;
  /** PRF per model id (e.g. 'glm' | 'gpt'), only for models that produced
   *  results. Averaged across present models into `avg`. */
  byModel: Record<string, PRF>;
  avg: PRF;
  /** True when at least one model has produced results for this field. */
  hasData: boolean;
}

/**
 * Build the per-field metrics rows for the Dashboard. Each row carries the
 * per-model PRF (keyed by model id) plus the average across every model that
 * has produced (`done`) results, so the Dashboard can switch between an
 * average view and a per-model breakdown. Fields with no results yet are still
 * listed (config + empty scores) so the framework is visible before any run.
 * Configs default to DEFAULT_FIELD_CONFIG when unset.
 */
export function buildDashboardRows(
  goldenKeys: string[],
  goldenExtraction: Record<string, { value: GoldenValue }>,
  modelResults: Array<{ id: string; data: Record<string, GoldenValue> }>,
  configs: Record<string, FieldMetricConfig>
): FieldMetricsRow[] {
  return goldenKeys.map((key) => {
    const config = configs[key] ?? DEFAULT_FIELD_CONFIG;
    const goldenValue = goldenExtraction[key]?.value;
    const byModel: Record<string, PRF> = {};

    let pSum = 0;
    let rSum = 0;
    let fSum = 0;

    for (const { id, data } of modelResults) {
      const modelValue = data[key];
      if (modelValue === undefined) continue;
      if (goldenValue === undefined) continue;
      const prf = computeFieldPRF(modelValue, goldenValue, config.matchStrategy);
      byModel[id] = prf;
      pSum += prf.precision;
      rSum += prf.recall;
      fSum += prf.f1;
    }

    const n = Object.keys(byModel).length;
    const avg: PRF =
      n === 0
        ? { precision: 0, recall: 0, f1: 0 }
        : { precision: pSum / n, recall: rSum / n, f1: fSum / n };

    return { key, config, byModel, avg, hasData: n > 0 };
  });
}

/** Aggregate (mean) PRF across all rows for a single model id (or 'avg').
 *  Fields without data for that view are skipped. Used for the summary strip. */
export function aggregateRows(
  rows: FieldMetricsRow[],
  view: string
): PRF & { count: number } {
  let p = 0;
  let r = 0;
  let f = 0;
  let count = 0;
  for (const row of rows) {
    const prf = view === 'avg' ? (row.hasData ? row.avg : undefined) : row.byModel[view];
    if (!prf) continue;
    p += prf.precision;
    r += prf.recall;
    f += prf.f1;
    count += 1;
  }
  if (count === 0) return { precision: 0, recall: 0, f1: 0, count: 0 };
  return { precision: p / count, recall: r / count, f1: f / count, count };
}
