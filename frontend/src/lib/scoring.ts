/**
 * Compatibility facade over the unified evaluation engine.
 * Prefer importing from `@/lib/evaluation` for new code.
 */
import type { GoldenDataset, GoldenValue, ValueKind } from './dataset';
import {
  evaluateDataset as evalDataset,
  evaluateField,
  isAbsentValue,
  normalizeStr,
  tokenizeScalar,
  accuracyBand,
  resolveFieldConfig,
  type DatasetEvaluation,
  type FieldEvaluation,
  type FieldEvalConfig,
} from './evaluation';

export { isAbsentValue, normalizeStr, tokenizeScalar, accuracyBand };

export interface FieldScore {
  key: string;
  label: string;
  match: boolean;
  /** 0..1 partial overlap (item-level for arrays/maps). */
  partial: number;
  difficulty?: string;
  source?: string;
  kind: ValueKind;
  /** Full evaluation when available (same engine as metrics). */
  evaluation?: FieldEvaluation;
}

export interface ScoreResult {
  perField: FieldScore[];
  matched: number;
  total: number;
  /** 0-100 exact-match accuracy across fields. */
  accuracy: number;
  /** 0-100 mean partial credit (softer metric). */
  partialAccuracy: number;
  meanPrecision?: number;
  meanRecall?: number;
  meanF1?: number;
  /** Full dataset evaluation (single engine). */
  evaluation?: DatasetEvaluation;
}

export interface MatchOutcome {
  match: boolean;
  partial: number;
}

/** Compare a model value against the golden value for a single field. */
export function fieldMatch(
  model: GoldenValue,
  golden: GoldenValue,
  fieldKey = '',
  config?: Partial<FieldEvalConfig>
): MatchOutcome {
  const resolved = resolveFieldConfig(fieldKey, config);
  const ev = evaluateField(model, golden, fieldKey, resolved);
  return { match: ev.match, partial: ev.partial };
}

/**
 * Score one model extraction against golden.
 * Uses smart defaults (and optional per-field config overrides).
 */
export function scoreDataset(
  extracted: Record<string, GoldenValue>,
  golden: GoldenDataset,
  configMap: Record<string, Partial<FieldEvalConfig>> = {}
): ScoreResult {
  const evaluation = evalDataset(extracted, golden, configMap);
  const perField: FieldScore[] = evaluation.perField.map((f) => {
    const meta = golden.golden_extraction[f.key];
    return {
      key: f.key,
      label: f.label,
      match: f.match,
      partial: f.partial,
      difficulty: meta?.difficulty,
      source: meta?.source,
      kind: f.kind,
      evaluation: f,
    };
  });

  return {
    perField,
    matched: evaluation.matched,
    total: evaluation.total,
    accuracy: evaluation.accuracy,
    partialAccuracy: evaluation.partialAccuracy,
    meanPrecision: evaluation.meanPrecision,
    meanRecall: evaluation.meanRecall,
    meanF1: evaluation.meanF1,
    evaluation,
  };
}
