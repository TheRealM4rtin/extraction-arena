/**
 * Composed headline Extraction Score from the three always-on deterministic
 * signals (after optional judge uplift). Not production accuracy without gold.
 */

export interface ExtractionScoreWeights {
  /** Weight on gate accuracy (matched/total). */
  gate: number;
  /** Weight on mean partial credit. */
  partial: number;
  /** Weight on mean field F1. */
  f1: number;
}

export const DEFAULT_SCORE_WEIGHTS: ExtractionScoreWeights = {
  gate: 0.25,
  partial: 0.35,
  f1: 0.4,
};

export function normalizeWeights(w: ExtractionScoreWeights): ExtractionScoreWeights {
  const sum = w.gate + w.partial + w.f1;
  if (sum <= 0) return { ...DEFAULT_SCORE_WEIGHTS };
  return {
    gate: w.gate / sum,
    partial: w.partial / sum,
    f1: w.f1 / sum,
  };
}

/**
 * Compose 0–100 extraction score from dataset-level aggregates.
 * `accuracy` and `partialAccuracy` are 0–100; `meanF1` is 0–1.
 */
export function extractionScore(
  signals: {
    accuracy: number;
    partialAccuracy: number;
    meanF1: number;
  },
  weights: ExtractionScoreWeights = DEFAULT_SCORE_WEIGHTS
): number {
  const w = normalizeWeights(weights);
  const raw =
    w.gate * (signals.accuracy / 100) +
    w.partial * (signals.partialAccuracy / 100) +
    w.f1 * signals.meanF1;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
