import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyJudgeUplift,
  extractionScore,
  needsJudge,
  parseJudgeResponse,
  selectJudgeCandidates,
  evaluateField,
  evaluateDataset,
  reapplyJudgeResults,
  clearJudgeCache,
  DEFAULT_SCORE_WEIGHTS,
  type FieldEvaluation,
  type FieldEvalConfig,
} from './index';
import type { GoldenDataset } from '../dataset';

const baseConfig: FieldEvalConfig = {
  matchStrategy: 'partial',
  listMode: 'set',
  priority: 'recall',
};

function field(partial: Partial<FieldEvaluation> & Pick<FieldEvaluation, 'key'>): FieldEvaluation {
  return {
    label: partial.key,
    kind: 'string',
    config: baseConfig,
    match: false,
    partial: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    alignments: [],
    modelExtraCount: 0,
    goldenCount: 1,
    modelCount: 1,
    ...partial,
  };
}

describe('extractionScore', () => {
  it('returns 100 when all signals are perfect', () => {
    expect(
      extractionScore({ accuracy: 100, partialAccuracy: 100, meanF1: 1 }, DEFAULT_SCORE_WEIGHTS)
    ).toBe(100);
  });

  it('weights gate, partial, and F1', () => {
    // 0.25*0.5 + 0.35*0.8 + 0.40*0.7 = 0.125 + 0.28 + 0.28 = 0.685 → 69
    expect(
      extractionScore({ accuracy: 50, partialAccuracy: 80, meanF1: 0.7 }, DEFAULT_SCORE_WEIGHTS)
    ).toBe(69);
  });

  it('returns 0 when empty signals are zero', () => {
    expect(extractionScore({ accuracy: 0, partialAccuracy: 0, meanF1: 0 })).toBe(0);
  });
});

describe('applyJudgeUplift', () => {
  const det = field({
    key: 'vehicle.body_style',
    match: false,
    partial: 0.4,
    precision: 0.4,
    recall: 0.4,
    f1: 0.4,
  });

  it('grants full credit on equivalent', () => {
    const up = applyJudgeUplift(det, {
      id: det.key,
      verdict: 'equivalent',
      rationale: 'Same body class.',
    });
    expect(up.match).toBe(true);
    expect(up.partial).toBe(1);
    expect(up.f1).toBe(1);
    expect(up.judge?.upliftApplied).toBe(true);
    expect(up.judge?.det.partial).toBe(0.4);
  });

  it('grants full credit on exact', () => {
    const up = applyJudgeUplift(det, {
      id: det.key,
      verdict: 'exact',
      rationale: 'Same.',
    });
    expect(up.match).toBe(true);
    expect(up.partial).toBe(1);
  });

  it('applies soft floor on partial verdict', () => {
    const up = applyJudgeUplift(det, {
      id: det.key,
      verdict: 'partial',
      rationale: 'Related.',
    });
    expect(up.match).toBe(false);
    expect(up.partial).toBe(0.5);
    expect(up.precision).toBe(0.5);
    expect(up.recall).toBe(0.5);
    expect(up.judge?.upliftApplied).toBe(true);
  });

  it('does not lower scores already above partial floor', () => {
    const strong = field({
      key: 'x',
      match: false,
      partial: 0.8,
      precision: 0.8,
      recall: 0.8,
      f1: 0.8,
    });
    const up = applyJudgeUplift(strong, {
      id: 'x',
      verdict: 'partial',
      rationale: 'ok',
    });
    expect(up.partial).toBe(0.8);
    expect(up.judge?.upliftApplied).toBe(false);
  });

  it('keeps det scores on different', () => {
    const up = applyJudgeUplift(det, {
      id: det.key,
      verdict: 'different',
      rationale: 'Wrong class.',
    });
    expect(up.match).toBe(false);
    expect(up.partial).toBe(0.4);
    expect(up.judge?.upliftApplied).toBe(false);
  });

  it('keeps det scores on unknown', () => {
    const up = applyJudgeUplift(det, {
      id: det.key,
      verdict: 'unknown',
      rationale: '?',
    });
    expect(up.partial).toBe(0.4);
    expect(up.judge?.verdict).toBe('unknown');
  });
});

describe('needsJudge / candidates', () => {
  it('skips perfect fields', () => {
    expect(
      needsJudge(
        field({
          key: 'a',
          match: true,
          partial: 1,
          goldenCount: 1,
          modelCount: 1,
        })
      )
    ).toBe(false);
  });

  it('skips both-absent fields', () => {
    expect(
      needsJudge(
        field({
          key: 'a',
          match: true,
          partial: 1,
          goldenCount: 0,
          modelCount: 0,
        })
      )
    ).toBe(false);
  });

  it('selects weak scalars', () => {
    const golden: GoldenDataset = {
      golden_extraction: {
        'vehicle.body_style': { value: 'truck' },
        'vehicle.model': { value: 'Cybertruck' },
      },
    };
    const model = {
      'vehicle.body_style': 'pickup truck',
      'vehicle.model': 'Cybertruck',
    };
    const ev = evaluateDataset(model, golden, {});
    const cands = selectJudgeCandidates(ev, golden, model);
    expect(cands.some((c) => c.id === 'vehicle.body_style')).toBe(true);
    expect(cands.some((c) => c.id === 'vehicle.model')).toBe(false);
  });
});

describe('parseJudgeResponse', () => {
  it('parses valid results', () => {
    const map = parseJudgeResponse(
      {
        results: [
          { id: 'vehicle.body_style', verdict: 'equivalent', rationale: 'pickup ≈ truck' },
        ],
      },
      ['vehicle.body_style']
    );
    expect(map['vehicle.body_style']?.verdict).toBe('equivalent');
  });

  it('maps invalid verdict to unknown', () => {
    const map = parseJudgeResponse(
      { results: [{ id: 'a', verdict: 'maybe', rationale: 'x' }] },
      ['a']
    );
    expect(map.a?.verdict).toBe('unknown');
  });

  it('fills missing ids as unknown', () => {
    const map = parseJudgeResponse({ results: [] }, ['missing.field']);
    expect(map['missing.field']?.verdict).toBe('unknown');
  });
});

describe('reapplyJudgeResults', () => {
  beforeEach(() => clearJudgeCache());

  it('raises aggregate accuracy after equivalent uplift', () => {
    const golden: GoldenDataset = {
      golden_extraction: {
        'vehicle.body_style': { value: 'truck' },
      },
    };
    const model = { 'vehicle.body_style': 'pickup truck' };
    const det = evaluateDataset(model, golden, {});
    expect(det.perField[0]?.match).toBe(false);

    const up = reapplyJudgeResults(det, {
      'vehicle.body_style': {
        id: 'vehicle.body_style',
        verdict: 'equivalent',
        rationale: 'same',
      },
    });
    expect(up.perField[0]?.match).toBe(true);
    expect(up.accuracy).toBe(100);
    expect(up.extractionScore).toBe(100);
    expect(up.judgeUpliftCount).toBe(1);
    expect(up.detAccuracy).toBe(det.accuracy);
  });
});

describe('evaluateDataset extractionScore', () => {
  it('always attaches extractionScore', () => {
    const r = evaluateField('a', 'a', 'k', baseConfig);
    expect(r.match).toBe(true);
    const golden: GoldenDataset = { golden_extraction: { k: { value: 'a' } } };
    const ev = evaluateDataset({ k: 'a' }, golden, {});
    expect(ev.extractionScore).toBe(100);
  });
});
