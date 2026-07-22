import { describe, expect, it } from 'vitest';
import {
  MIN_COLUMN_FRACTION,
  pixelDeltaToFraction,
  transferColumnWidth,
} from './columnResize';

describe('transferColumnWidth', () => {
  it('grows left and shrinks right for positive delta (drag right)', () => {
    const { left, right } = transferColumnWidth(1, 1, 0.25);
    expect(left).toBeCloseTo(1.25);
    expect(right).toBeCloseTo(0.75);
    expect(left + right).toBeCloseTo(2);
  });

  it('shrinks left and grows right for negative delta (drag left)', () => {
    const { left, right } = transferColumnWidth(1, 1, -0.3);
    expect(left).toBeCloseTo(0.7);
    expect(right).toBeCloseTo(1.3);
    expect(left + right).toBeCloseTo(2);
  });

  it('is identity for zero delta', () => {
    expect(transferColumnWidth(1.2, 0.8, 0)).toEqual({ left: 1.2, right: 0.8 });
  });

  it('clamps so left cannot go below min', () => {
    const { left, right } = transferColumnWidth(1, 1, -10, MIN_COLUMN_FRACTION);
    expect(left).toBeCloseTo(MIN_COLUMN_FRACTION);
    expect(right).toBeCloseTo(2 - MIN_COLUMN_FRACTION);
    expect(left + right).toBeCloseTo(2);
  });

  it('clamps so right cannot go below min', () => {
    const { left, right } = transferColumnWidth(1, 1, 10, MIN_COLUMN_FRACTION);
    expect(right).toBeCloseTo(MIN_COLUMN_FRACTION);
    expect(left).toBeCloseTo(2 - MIN_COLUMN_FRACTION);
    expect(left + right).toBeCloseTo(2);
  });

  it('conserves sum at every intermediate clamp boundary', () => {
    const startL = 1.5;
    const startR = 0.6;
    const sum = startL + startR;
    for (const d of [-2, -0.5, 0, 0.1, 0.5, 5]) {
      const { left, right } = transferColumnWidth(startL, startR, d, 0.4);
      expect(left + right).toBeCloseTo(sum);
      expect(left).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(right).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });
});

describe('pixelDeltaToFraction', () => {
  it('maps full usable width to full pair sum', () => {
    expect(pixelDeltaToFraction(200, 200, 2)).toBeCloseTo(2);
  });

  it('returns 0 for non-positive usable width', () => {
    expect(pixelDeltaToFraction(50, 0, 2)).toBe(0);
    expect(pixelDeltaToFraction(50, -10, 2)).toBe(0);
  });

  it('scales proportionally', () => {
    expect(pixelDeltaToFraction(50, 200, 2)).toBeCloseTo(0.5);
  });
});
