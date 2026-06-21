import {
  type GoldenDataset,
  type GoldenValue,
  type ValueKind,
  valueKind,
  humanLabel,
} from './dataset';
import { NOT_FOUND } from './dataset';

export interface FieldScore {
  key: string;
  label: string;
  match: boolean;
  /** 0..1 partial overlap (item-level for arrays/maps). */
  partial: number;
  difficulty?: string;
  source?: string;
  kind: ValueKind;
}

export interface ScoreResult {
  perField: FieldScore[];
  matched: number;
  total: number;
  /** 0-100 exact-match accuracy across fields. */
  accuracy: number;
  /** 0-100 mean partial credit (softer metric). */
  partialAccuracy: number;
}

export function isAbsentValue(v: GoldenValue): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return v === NOT_FOUND || v.trim() === '';
}

export function normalizeStr(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

const SCALAR_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const NEGATION_TOKENS = ['no', 'not', 'never', 'without'];

function tokenizeWords(value: string): string[] {
  const normalized = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized ? normalized.split(' ') : [];
}

function removeScalarNoise(tokens: string[]): string[] {
  return tokens.filter((token) => !SCALAR_STOP_WORDS.has(token));
}

function stripFieldTokens(tokens: string[], fieldKey: string): string[] {
  const ignored = new Set(removeScalarNoise(tokenizeWords(fieldKey)));
  if (ignored.size === 0) return tokens;
  return tokens.filter((token) => !ignored.has(token));
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function sharedTokenCount(modelTokens: string[], goldenTokens: string[]): number {
  if (modelTokens.length === 0 || goldenTokens.length === 0) return 0;

  const remaining = countTokens(goldenTokens);
  let matched = 0;

  for (const token of modelTokens) {
    const available = remaining.get(token) ?? 0;
    if (available <= 0) continue;
    remaining.set(token, available - 1);
    matched += 1;
  }

  return matched;
}

function sameTokenMultiset(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;

  const aCounts = countTokens(a);
  const bCounts = countTokens(b);
  if (aCounts.size !== bCounts.size) return false;

  for (const [token, count] of aCounts.entries()) {
    if (bCounts.get(token) !== count) return false;
  }

  return true;
}

function sameNegationState(a: string[], b: string[]): boolean {
  const aSet = new Set(a);
  const bSet = new Set(b);
  return NEGATION_TOKENS.every((token) => aSet.has(token) === bSet.has(token));
}

function overlapRatio(modelTokens: string[], goldenTokens: string[]): number {
  if (goldenTokens.length === 0) return 0;
  return sharedTokenCount(modelTokens, goldenTokens) / goldenTokens.length;
}

function scalarTokens(value: string, fieldKey: string): string[] {
  return stripFieldTokens(removeScalarNoise(tokenizeWords(value)), fieldKey);
}

function scalarMatch(model: string, golden: string, fieldKey: string): MatchOutcome {
  const normalizedModel = normalizeStr(model);
  const normalizedGolden = normalizeStr(golden);
  if (normalizedModel === normalizedGolden) {
    return { match: true, partial: 1 };
  }

  const generalModelTokens = removeScalarNoise(tokenizeWords(model));
  const generalGoldenTokens = removeScalarNoise(tokenizeWords(golden));
  const coreModelTokens = scalarTokens(model, fieldKey);
  const coreGoldenTokens = scalarTokens(golden, fieldKey);

  // Ground-truth scalars sometimes include field-label boilerplate like
  // "Coolant is blue or orange." while the model returns just "blue or orange".
  const match =
    sameNegationState(generalModelTokens, generalGoldenTokens) &&
    (sameTokenMultiset(generalModelTokens, generalGoldenTokens) ||
      sameTokenMultiset(coreModelTokens, coreGoldenTokens));

  const partial = Math.max(
    overlapRatio(generalModelTokens, generalGoldenTokens),
    overlapRatio(coreModelTokens, coreGoldenTokens)
  );

  return { match, partial };
}

function asArray(v: GoldenValue): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'object') return Object.entries(v).map(([k, val]) => `${k} ${val}`);
  return [String(v)];
}

function asMap(v: GoldenValue): Record<string, string> {
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  if (Array.isArray(v)) {
    const o: Record<string, string> = {};
    v.forEach((x, i) => (o[String(i)] = String(x)));
    return o;
  }
  return { value: String(v) };
}

export interface MatchOutcome {
  match: boolean;
  partial: number;
}

/** Compare a model value against the golden value for a single field. */
export function fieldMatch(model: GoldenValue, golden: GoldenValue, fieldKey = ''): MatchOutcome {
  const mAbsent = isAbsentValue(model);
  const gAbsent = isAbsentValue(golden);
  if (mAbsent || gAbsent) {
    const ok = mAbsent && gAbsent;
    return { match: ok, partial: ok ? 1 : 0 };
  }

  const gKind = valueKind(golden);

  if (gKind === 'array') {
    const ma = asArray(model).map(normalizeStr);
    const ga = asArray(golden).map(normalizeStr);
    const goldenSet = new Set(ga);
    const matched = ma.filter((x) => goldenSet.has(x)).length;
    const exact = ma.length === ga.length && matched === ga.length;
    return { match: exact, partial: ga.length === 0 ? 0 : matched / ga.length };
  }

  if (gKind === 'object') {
    const mo = asMap(model);
    const go = asMap(golden);
    const goldenKeys = Object.keys(go);
    let matched = 0;
    for (const k of goldenKeys) {
      if (normalizeStr(mo[k] ?? '') === normalizeStr(go[k])) matched++;
    }
    const exact = Object.keys(mo).length === goldenKeys.length && matched === goldenKeys.length;
    return { match: exact, partial: goldenKeys.length === 0 ? 0 : matched / goldenKeys.length };
  }

  // scalar
  return scalarMatch(String(model), String(golden), fieldKey);
}

export function scoreDataset(
  extracted: Record<string, GoldenValue>,
  golden: GoldenDataset
): ScoreResult {
  const perField: FieldScore[] = Object.entries(golden.golden_extraction).map(([key, field]) => {
    const modelValue = extracted[key];
    const outcome = fieldMatch(modelValue ?? NOT_FOUND, field.value, key);
    return {
      key,
      label: humanLabel(key),
      match: outcome.match,
      partial: outcome.partial,
      difficulty: field.difficulty,
      source: field.source,
      kind: valueKind(field.value),
    };
  });

  const matched = perField.filter((f) => f.match).length;
  const total = perField.length;
  const partialSum = perField.reduce((acc, f) => acc + f.partial, 0);

  return {
    perField,
    matched,
    total,
    accuracy: total === 0 ? 0 : Math.round((matched / total) * 100),
    partialAccuracy: total === 0 ? 0 : Math.round((partialSum / total) * 100),
  };
}

export function accuracyBand(accuracy: number): 'red' | 'yellow' | 'green' {
  if (accuracy >= 80) return 'green';
  if (accuracy >= 50) return 'yellow';
  return 'red';
}
