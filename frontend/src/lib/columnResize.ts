/**
 * Pure helpers for pairwise column-width transfer during resize drags.
 * Widths are unitless flex fractions; only the adjacent pair is adjusted.
 */

export const MIN_COLUMN_FRACTION = 0.4;

/**
 * Transfer width from the right column to the left (positive delta grows left).
 * Clamps so both sides stay ≥ min and the pair sum is conserved.
 */
export function transferColumnWidth(
  startLeft: number,
  startRight: number,
  delta: number,
  min: number = MIN_COLUMN_FRACTION
): { left: number; right: number } {
  const maxGrowLeft = startRight - min;
  const maxShrinkLeft = startLeft - min;
  const transfer = Math.min(Math.max(delta, -maxShrinkLeft), maxGrowLeft);
  return {
    left: startLeft + transfer,
    right: startRight - transfer,
  };
}

/**
 * Convert a pixel drag delta into a fraction transfer for a left/right pair,
 * relative to the usable container width (after gaps).
 */
export function pixelDeltaToFraction(
  deltaPx: number,
  usableWidthPx: number,
  pairSum: number
): number {
  if (usableWidthPx <= 0 || pairSum <= 0) return 0;
  return (deltaPx / usableWidthPx) * pairSum;
}
