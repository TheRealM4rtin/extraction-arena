import type { FieldEvaluation, JudgeFieldResult, JudgeOverlay, JudgeVerdict } from './types';
import { JUDGE_MODEL_ID, JUDGE_PROMPT_VERSION } from './judgePrompt';

function harmonicMean(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function baseOverlay(det: FieldEvaluation, judge: JudgeFieldResult): JudgeOverlay {
  return {
    verdict: judge.verdict,
    rationale: judge.rationale,
    judgeModel: JUDGE_MODEL_ID,
    promptVersion: JUDGE_PROMPT_VERSION,
    upliftApplied: false,
    det: { match: det.match, partial: det.partial, f1: det.f1 },
  };
}

/**
 * Pure, deterministic score rewrite from a closed judge verdict.
 * Never calls the LLM — only applies the uplift table.
 */
export function applyJudgeUplift(
  det: FieldEvaluation,
  judge: JudgeFieldResult | undefined
): FieldEvaluation {
  if (!judge) return det;

  const overlay = baseOverlay(det, judge);

  if (judge.verdict === 'exact' || judge.verdict === 'equivalent') {
    return {
      ...det,
      match: true,
      partial: 1,
      precision: 1,
      recall: 1,
      f1: 1,
      judge: { ...overlay, upliftApplied: true },
    };
  }

  if (judge.verdict === 'partial') {
    const partial = Math.max(det.partial, 0.5);
    const precision = Math.max(det.precision, 0.5);
    const recall = Math.max(det.recall, 0.5);
    const f1 = harmonicMean(precision, recall);
    // Only mark uplift when a raw signal actually moved (avoid float noise on F1).
    const upliftApplied =
      partial > det.partial || precision > det.precision || recall > det.recall;
    return {
      ...det,
      partial,
      precision,
      recall,
      f1,
      judge: { ...overlay, upliftApplied },
    };
  }

  // different | unknown — keep deterministic scores, attach overlay for UI.
  return { ...det, judge: overlay };
}

/** Map of field key → judge result (field-level; item ids use field prefix). */
export type JudgeResultMap = Record<string, JudgeFieldResult>;

/**
 * Resolve the judge result for a field.
 * Prefers field-level id; falls back to best item-level verdict if any.
 */
export function resolveFieldJudge(
  fieldKey: string,
  results: JudgeResultMap
): JudgeFieldResult | undefined {
  if (results[fieldKey]) return results[fieldKey];

  const prefix = `${fieldKey}#`;
  const itemResults = Object.values(results).filter((r) => r.id.startsWith(prefix));
  if (itemResults.length === 0) return undefined;

  // Aggregate item verdicts: all exact/equivalent → equivalent; any different → different;
  // else partial if any partial; else unknown.
  const verdicts = new Set(itemResults.map((r) => r.verdict));
  let verdict: JudgeVerdict = 'unknown';
  if ([...verdicts].every((v) => v === 'exact' || v === 'equivalent')) {
    verdict = verdicts.has('exact') && !verdicts.has('equivalent') ? 'exact' : 'equivalent';
  } else if (verdicts.has('different')) {
    verdict = 'different';
  } else if (verdicts.has('partial')) {
    verdict = 'partial';
  } else if (verdicts.has('unknown')) {
    verdict = 'unknown';
  }

  const rationale = itemResults
    .map((r) => r.rationale)
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');

  return { id: fieldKey, verdict, rationale: rationale || 'Aggregated from list items.' };
}

/** Apply judge map to every field evaluation. */
export function applyJudgeMap(
  perField: FieldEvaluation[],
  results: JudgeResultMap
): FieldEvaluation[] {
  return perField.map((f) => applyJudgeUplift(f, resolveFieldJudge(f.key, results)));
}

export function countUplifts(perField: FieldEvaluation[]): number {
  return perField.filter((f) => f.judge?.upliftApplied).length;
}

export function countReviewed(perField: FieldEvaluation[]): number {
  return perField.filter((f) => f.judge != null).length;
}
