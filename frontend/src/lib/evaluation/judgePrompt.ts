/**
 * LLM-as-judge prompt contract for rescue-sheet extraction evaluation.
 * Prompt version is part of the cache key — bump when the rubric changes.
 */

export const JUDGE_PROMPT_VERSION = 'judge-v1' as const;
export const JUDGE_MODEL_ID = 'gpt-5.4-nano' as const;
export const JUDGE_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const JUDGE_VERDICTS = [
  'exact',
  'equivalent',
  'partial',
  'different',
  'unknown',
] as const;

export interface JudgeCandidate {
  /** Stable id: field path or `path#goldenIndex`. */
  id: string;
  fieldKey: string;
  label: string;
  kind: 'string' | 'array' | 'object' | 'item';
  listMode?: 'sequence' | 'set';
  goldenValue: string;
  modelValue: string;
  /** Deterministic partial in [0,1] for context. */
  detPartial: number;
  detMatch: boolean;
}

export const JUDGE_SYSTEM_PROMPT = `You are an independent evaluator of EV first-responder rescue-sheet extractions (ISO-17840-style).

Your job: decide whether the MODEL value states the SAME operational fact as the GOLD value for emergency responders — not whether the strings match.

## Verdict labels (use EXACTLY one of these strings per item)
- "exact" — same fact AND effectively the same wording or codes
- "equivalent" — same fact for first responders; different wording, synonyms, snake_case vs spaces, abbreviations (e.g. Li-ion vs lithium_ion, truck vs pickup truck, place_vehicle_in_park vs put vehicle into park position)
- "partial" — related or overlapping but incomplete, imprecise, or missing an important part
- "different" — wrong, contradictory, different procedure, wrong number/voltage, reversed meaning, or missing a critical safety fact
- "unknown" — cannot decide from the given strings alone

## Rules
1. Gold is the reference fact for THIS document — not "any possible English."
2. Ignore style: case, punctuation, bullets, underscores vs spaces, minor word order.
3. Be STRICT on safety-critical content: voltages, numeric values, prohibitions (do / do not), presence vs absence of hazards, and STEP ORDER when the field is an ordered procedure (listMode sequence).
4. Synonyms and paraphrases of the same action or component are "equivalent", not "different".
5. If MODEL invents content not in GOLD that changes the operational meaning → "different". If MODEL omits a required gold fact → "partial" or "different" depending on severity.
6. Output JSON only. No markdown fences. No extra commentary outside the JSON object.

## Output schema
{
  "results": [
    { "id": "<same id as input>", "verdict": "exact|equivalent|partial|different|unknown", "rationale": "<one short sentence>" }
  ]
}

Return exactly one result object per input item, preserving each input id.`;

export function buildJudgeUserPrompt(candidates: JudgeCandidate[]): string {
  const payload = candidates.map((c) => ({
    id: c.id,
    field: c.fieldKey,
    label: c.label,
    kind: c.kind,
    listMode: c.listMode ?? null,
    gold: c.goldenValue,
    model: c.modelValue,
    det_match: c.detMatch,
    det_partial: Number(c.detPartial.toFixed(3)),
  }));

  return `Evaluate each extraction field below. Respond with JSON matching the schema.

Items:
${JSON.stringify(payload, null, 2)}`;
}
