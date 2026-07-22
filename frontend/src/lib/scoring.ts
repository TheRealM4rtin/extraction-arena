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
  reapplyJudgeResults,
  type DatasetEvaluation,
  type FieldEvaluation,
  type FieldEvalConfig,
  type JudgeFieldResult,
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
  /** 0-100 exact-match accuracy across fields (gate). */
  accuracy: number;
  /** 0-100 mean partial credit (softer metric). */
  partialAccuracy: number;
  /** 0-100 composed extraction score (primary UI gauge). */
  extractionScore: number;
  meanPrecision?: number;
  meanRecall?: number;
  meanF1?: number;
  detAccuracy?: number;
  judgeUpliftCount?: number;
  judgeReviewedCount?: number;
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

function toScoreResult(evaluation: DatasetEvaluation, golden: GoldenDataset): ScoreResult {
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
    extractionScore: evaluation.extractionScore,
    meanPrecision: evaluation.meanPrecision,
    meanRecall: evaluation.meanRecall,
    meanF1: evaluation.meanF1,
    detAccuracy: evaluation.detAccuracy,
    judgeUpliftCount: evaluation.judgeUpliftCount,
    judgeReviewedCount: evaluation.judgeReviewedCount,
    evaluation,
  };
}

/**
 * Score one model extraction against golden.
 * Uses smart defaults (and optional per-field config overrides).
 * When `judgeResults` is provided, deterministic scores are uplifted without re-calling the LLM.
 */
export function scoreDataset(
  extracted: Record<string, GoldenValue>,
  golden: GoldenDataset,
  configMap: Record<string, Partial<FieldEvalConfig>> = {},
  judgeResults?: Record<string, JudgeFieldResult>
): ScoreResult {
  const det = evalDataset(extracted, golden, configMap);
  const evaluation =
    judgeResults && Object.keys(judgeResults).length > 0
      ? reapplyJudgeResults(det, judgeResults)
      : det;
  return toScoreResult(evaluation, golden);
}

/** Build ScoreResult from a stored DatasetEvaluation (e.g. post-judge on ModelResult). */
export function scoreFromEvaluation(
  evaluation: DatasetEvaluation,
  golden: GoldenDataset
): ScoreResult {
  return toScoreResult(evaluation, golden);
}
