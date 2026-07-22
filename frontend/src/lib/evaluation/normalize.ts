import type { GoldenValue } from '../dataset';
import { NOT_FOUND } from '../dataset';

export function isAbsentValue(v: GoldenValue): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return v === NOT_FOUND || v.trim() === '';
}

/** Case/punct/space fingerprint used for equality checks.
 *  Punctuation is stripped (not turned into spaces) so "RE-IGNITION" → "reignition".
 *  Leading bullets become empty after strip — final trim cleans residual spaces. */
export function normalizeStr(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

export const NEGATION_TOKENS = ['no', 'not', 'never', 'without'] as const;

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

/** Case/digit-boundary aware word split. */
export function tokenizeScalar(value: string): string[] {
  return tokenizeWords(value);
}

export function removeScalarNoise(tokens: string[]): string[] {
  return tokens.filter((token) => !SCALAR_STOP_WORDS.has(token));
}

export function stripFieldTokens(tokens: string[], fieldKey: string): string[] {
  const ignored = new Set(removeScalarNoise(tokenizeWords(fieldKey)));
  if (ignored.size === 0) return tokens;
  return tokens.filter((token) => !ignored.has(token));
}

export function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function sharedTokenCount(modelTokens: string[], goldenTokens: string[]): number {
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

export function sameTokenMultiset(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;

  const aCounts = countTokens(a);
  const bCounts = countTokens(b);
  if (aCounts.size !== bCounts.size) return false;

  for (const [token, count] of aCounts.entries()) {
    if (bCounts.get(token) !== count) return false;
  }

  return true;
}

export function sameNegationState(a: string[], b: string[]): boolean {
  const aSet = new Set(a);
  const bSet = new Set(b);
  return NEGATION_TOKENS.every((token) => aSet.has(token) === bSet.has(token));
}

export function overlapRatio(modelTokens: string[], goldenTokens: string[]): number {
  if (goldenTokens.length === 0) return 0;
  return sharedTokenCount(modelTokens, goldenTokens) / goldenTokens.length;
}

export function scalarTokens(value: string, fieldKey: string): string[] {
  return stripFieldTokens(removeScalarNoise(tokenizeWords(value)), fieldKey);
}

/** Split a golden/model value into comparable string items based on kind. */
export function toItems(v: GoldenValue, kind: 'string' | 'array' | 'object'): string[] {
  if (kind === 'array') {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === 'object' && v !== null) {
      return Object.entries(v).map(([k, val]) => `${k} ${val}`);
    }
    return [String(v)];
  }
  if (kind === 'object') {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return Object.entries(v).map(([k, val]) => `${k}\u0000${val}`);
    }
    if (Array.isArray(v)) {
      return v.map((x, i) => `${i}\u0000${String(x)}`);
    }
    return [`value\u0000${String(v)}`];
  }
  return [String(v)];
}
