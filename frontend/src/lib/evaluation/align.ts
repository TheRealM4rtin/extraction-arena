import type { ItemAlignment, MatchStrategy } from './types';
import { itemSimilarity, similarityThreshold } from './similarity';
import { normalizeStr } from './normalize';

export interface AlignmentResult {
  alignments: ItemAlignment[];
  /** Model indices not paired to any golden item. */
  unmatchedModel: number[];
  /** Sum of similarities for pairs kept above threshold (PRF numerator). */
  matchedSimilaritySum: number;
  /** Count of golden positions with sim === 1 partner. */
  exactGoldHits: number;
}

/**
 * Position-by-position alignment. Order is part of the answer.
 * Unmatched model positions (when model longer) are tracked as extras.
 */
export function alignSequence(
  modelItems: string[],
  goldenItems: string[],
  strategy: MatchStrategy
): AlignmentResult {
  const threshold = similarityThreshold(strategy);
  const alignments: ItemAlignment[] = [];
  let matchedSimilaritySum = 0;
  let exactGoldHits = 0;

  const maxLen = Math.max(modelItems.length, goldenItems.length);
  const usedModel = new Set<number>();

  for (let i = 0; i < goldenItems.length; i++) {
    if (i < modelItems.length) {
      const sim = itemSimilarity(modelItems[i]!, goldenItems[i]!, strategy);
      const kept = sim >= threshold;
      alignments.push({
        goldenIndex: i,
        modelIndex: i,
        similarity: kept ? sim : sim, // always record raw sim; PRF uses threshold
      });
      if (kept) matchedSimilaritySum += sim;
      if (sim === 1) exactGoldHits += 1;
      usedModel.add(i);
    } else {
      alignments.push({ goldenIndex: i, modelIndex: null, similarity: 0 });
    }
  }

  const unmatchedModel: number[] = [];
  for (let j = 0; j < modelItems.length; j++) {
    if (!usedModel.has(j) && j >= goldenItems.length) unmatchedModel.push(j);
  }

  // Positions where model has items but we already paired by index are "used".
  // Extra tail is unmatched. Also if golden is longer, those are FNs above.
  void maxLen;

  return { alignments, unmatchedModel, matchedSimilaritySum, exactGoldHits };
}

/**
 * Greedy best-match (order-free). Each golden item pairs with the unused model
 * item of highest similarity if it crosses the strategy threshold.
 */
export function alignSet(
  modelItems: string[],
  goldenItems: string[],
  strategy: MatchStrategy
): AlignmentResult {
  const threshold = similarityThreshold(strategy);
  const usedModel = new Set<number>();
  const alignments: ItemAlignment[] = [];
  let matchedSimilaritySum = 0;
  let exactGoldHits = 0;

  for (let gi = 0; gi < goldenItems.length; gi++) {
    let bestJ = -1;
    let bestSim = 0;
    for (let j = 0; j < modelItems.length; j++) {
      if (usedModel.has(j)) continue;
      const sim = itemSimilarity(modelItems[j]!, goldenItems[gi]!, strategy);
      if (sim > bestSim) {
        bestSim = sim;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestSim >= threshold) {
      usedModel.add(bestJ);
      alignments.push({
        goldenIndex: gi,
        modelIndex: bestJ,
        similarity: bestSim,
      });
      matchedSimilaritySum += bestSim;
      if (bestSim === 1) exactGoldHits += 1;
    } else {
      alignments.push({
        goldenIndex: gi,
        modelIndex: null,
        similarity: bestJ >= 0 ? bestSim : 0,
      });
    }
  }

  const unmatchedModel: number[] = [];
  for (let j = 0; j < modelItems.length; j++) {
    if (!usedModel.has(j)) unmatchedModel.push(j);
  }

  return { alignments, unmatchedModel, matchedSimilaritySum, exactGoldHits };
}

/** True when both sides have the same multiset of normalized item strings. */
export function exactBagMatch(modelItems: string[], goldenItems: string[]): boolean {
  if (modelItems.length !== goldenItems.length) return false;
  const counts = new Map<string, number>();
  for (const g of goldenItems) {
    const k = normalizeStr(g);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const m of modelItems) {
    const k = normalizeStr(m);
    const left = counts.get(k) ?? 0;
    if (left <= 0) return false;
    counts.set(k, left - 1);
  }
  return true;
}

/** Positional exact: same length and every index normalize-equal. */
export function exactSequenceMatch(modelItems: string[], goldenItems: string[]): boolean {
  if (modelItems.length !== goldenItems.length) return false;
  for (let i = 0; i < goldenItems.length; i++) {
    if (normalizeStr(modelItems[i]!) !== normalizeStr(goldenItems[i]!)) return false;
  }
  return true;
}
