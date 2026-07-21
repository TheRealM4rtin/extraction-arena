import type { MatchStrategy } from './types';
import {
  normalizeStr,
  overlapRatio,
  removeScalarNoise,
  sameNegationState,
  sameTokenMultiset,
  scalarTokens,
  tokenizeScalar,
} from './normalize';

/**
 * Per-item similarity in [0, 1].
 * - exact: 1 iff normalized strings equal, else 0.
 * - partial: 1 on equality or substring containment, else set-token overlap.
 */
export function itemSimilarity(
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

  const sa = new Set(tokenizeScalar(model));
  const sb = new Set(tokenizeScalar(golden));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / Math.max(sa.size, sb.size);
}

/**
 * Gate-level scalar exactness (MAIN-compatible):
 * normalized equality OR token multiset match (stop words / field-name stripped,
 * negation must agree). Independent of matchStrategy so the comparison UI stays
 * stable for "blue or orange" vs "Coolant is blue or orange" style fields.
 */
export function scalarGateMatch(model: string, golden: string, fieldKey: string): boolean {
  const normalizedModel = normalizeStr(model);
  const normalizedGolden = normalizeStr(golden);
  if (normalizedModel === normalizedGolden) return true;

  const generalModelTokens = removeScalarNoise(tokenizeScalar(model));
  const generalGoldenTokens = removeScalarNoise(tokenizeScalar(golden));
  const coreModelTokens = scalarTokens(model, fieldKey);
  const coreGoldenTokens = scalarTokens(golden, fieldKey);

  return (
    sameNegationState(generalModelTokens, generalGoldenTokens) &&
    (sameTokenMultiset(generalModelTokens, generalGoldenTokens) ||
      sameTokenMultiset(coreModelTokens, coreGoldenTokens))
  );
}

/** Soft partial credit for a scalar (token overlap / containment). */
export function scalarPartial(model: string, golden: string, fieldKey: string): number {
  const nm = normalizeStr(model);
  const ng = normalizeStr(golden);
  if (nm === ng) return 1;
  if (nm !== '' && ng !== '' && (nm.includes(ng) || ng.includes(nm))) return 1;

  const generalModelTokens = removeScalarNoise(tokenizeScalar(model));
  const generalGoldenTokens = removeScalarNoise(tokenizeScalar(golden));
  const coreModelTokens = scalarTokens(model, fieldKey);
  const coreGoldenTokens = scalarTokens(golden, fieldKey);

  return Math.max(
    overlapRatio(generalModelTokens, generalGoldenTokens),
    overlapRatio(coreModelTokens, coreGoldenTokens),
    itemSimilarity(model, golden, 'partial')
  );
}

export function similarityThreshold(strategy: MatchStrategy): number {
  return strategy === 'exact' ? 1 : 0.5;
}
