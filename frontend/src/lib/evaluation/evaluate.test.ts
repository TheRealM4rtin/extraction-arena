import { describe, expect, it } from 'vitest';
import {
  defaultConfigForField,
  evaluateDataset,
  evaluateField,
  exactBagMatch,
  exactSequenceMatch,
  histogramBins,
  normalizeStr,
  resolveFieldConfig,
  sortByPriority,
  type FieldEvalConfig,
} from './index';
import type { GoldenDataset } from '../dataset';

const sequenceExact: FieldEvalConfig = {
  matchStrategy: 'exact',
  listMode: 'sequence',
  priority: 'recall',
};

const setPartial: FieldEvalConfig = {
  matchStrategy: 'partial',
  listMode: 'set',
  priority: 'recall',
};

describe('normalizeStr', () => {
  it('ignores case, punctuation, and extra spaces', () => {
    expect(normalizeStr('Do not push on HV Battery.')).toBe(
      normalizeStr('do not push on hv battery')
    );
    expect(normalizeStr('• POSSIBLE BATTERY RE-IGNITION!')).toBe(
      normalizeStr('possible battery reignition')
    );
  });
});

describe('scalar evaluation', () => {
  it('matches case-insensitive scalars', () => {
    const r = evaluateField('Cybertruck', 'cybertruck', 'vehicle.model', {
      matchStrategy: 'exact',
      listMode: 'set',
      priority: 'precision',
    });
    expect(r.match).toBe(true);
    expect(r.partial).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('matches multiset scalars with field boilerplate', () => {
    const r = evaluateField(
      'blue or orange',
      'Coolant is blue or orange.',
      'coolant_color',
      { matchStrategy: 'partial', listMode: 'set', priority: 'recall' }
    );
    expect(r.match).toBe(true);
    expect(r.partial).toBe(1);
  });

  it('fails on negation flip', () => {
    const r = evaluateField(
      'not battery electric',
      'battery electric',
      'vehicle.propulsion.primary_energy_source',
      { matchStrategy: 'partial', listMode: 'set', priority: 'precision' }
    );
    expect(r.match).toBe(false);
  });
});

describe('array sequence vs set', () => {
  const gold = ['A', 'B', 'C'];
  const reordered = ['A', 'C', 'B'];

  it('sequence: reorder fails exact match', () => {
    const r = evaluateField(reordered, gold, 'steps.ordered_steps', sequenceExact);
    expect(exactSequenceMatch(reordered, gold)).toBe(false);
    expect(r.match).toBe(false);
    expect(r.partial).toBeCloseTo(1 / 3, 5);
  });

  it('set: reorder matches as bag', () => {
    const r = evaluateField(reordered, gold, 'warnings', setPartial);
    expect(exactBagMatch(reordered, gold)).toBe(true);
    expect(r.match).toBe(true);
    expect(r.partial).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('merged blob fails set exact bag but may get partial credit', () => {
    const merged = ['A B C extra words here'];
    const r = evaluateField(merged, gold, 'warnings', setPartial);
    expect(r.match).toBe(false);
    expect(r.goldenCount).toBe(3);
    expect(r.modelCount).toBe(1);
  });
});

describe('absence', () => {
  it('both absent is perfect', () => {
    const r = evaluateField([], [], 'x', setPartial);
    expect(r.match).toBe(true);
    expect(r.f1).toBe(1);
  });

  it('model missing golden content is FN', () => {
    const r = evaluateField('not_found', 'present', 'x', setPartial);
    expect(r.match).toBe(false);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0);
  });
});

describe('smart defaults', () => {
  it('ordered_steps → sequence + exact', () => {
    const c = defaultConfigForField(
      'responder_information.disable_direct_hazards.ordered_steps'
    );
    expect(c.listMode).toBe('sequence');
    expect(c.matchStrategy).toBe('exact');
  });

  it('warnings → set + partial + recall', () => {
    const c = defaultConfigForField('warnings');
    expect(c.listMode).toBe('set');
    expect(c.matchStrategy).toBe('partial');
    expect(c.priority).toBe('recall');
  });

  it('manufacturer → exact + precision', () => {
    const c = defaultConfigForField('vehicle.manufacturer');
    expect(c.matchStrategy).toBe('exact');
    expect(c.priority).toBe('precision');
  });

  it('user override wins', () => {
    const c = resolveFieldConfig('warnings', { listMode: 'sequence' });
    expect(c.listMode).toBe('sequence');
    expect(c.matchStrategy).toBe('partial');
  });
});

describe('evaluateDataset', () => {
  const golden: GoldenDataset = {
    golden_extraction: {
      'vehicle.model': { value: 'Cybertruck' },
      warnings: {
        value: ['Do not push on HV Battery.', 'POSSIBLE BATTERY RE-IGNITION!'],
      },
      'responder_information.disable_direct_hazards.ordered_steps': {
        value: ['cut_frl', 'wait_60s'],
      },
    },
  };

  it('aggregates accuracy from field matches', () => {
    const extracted = {
      'vehicle.model': 'cybertruck',
      warnings: ['POSSIBLE BATTERY RE-IGNITION!', 'Do not push on HV Battery.'],
      'responder_information.disable_direct_hazards.ordered_steps': [
        'cut_frl',
        'wait_60s',
      ],
    };
    const ev = evaluateDataset(extracted, golden);
    // model ok, warnings set-reorder ok, steps sequence ok
    expect(ev.matched).toBe(3);
    expect(ev.accuracy).toBe(100);
    expect(ev.total).toBe(3);
  });

  it('sequence steps fail on reorder while warnings set succeeds', () => {
    const extracted = {
      'vehicle.model': 'Cybertruck',
      warnings: ['POSSIBLE BATTERY RE-IGNITION!', 'Do not push on HV Battery.'],
      'responder_information.disable_direct_hazards.ordered_steps': [
        'wait_60s',
        'cut_frl',
      ],
    };
    const ev = evaluateDataset(extracted, golden);
    expect(ev.matched).toBe(2);
    const steps = ev.perField.find((f) => f.key.includes('ordered_steps'));
    const warns = ev.perField.find((f) => f.key === 'warnings');
    expect(steps?.match).toBe(false);
    expect(warns?.match).toBe(true);
  });
});

describe('helpers', () => {
  it('histogram bins sum to value count', () => {
    const bins = histogramBins([0, 0.25, 0.5, 0.75, 1], 5);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(5);
  });

  it('sortByPriority puts low recall first when priority is recall', () => {
    const fields = [
      evaluateField(['a', 'b'], ['a', 'b'], 'w', {
        ...setPartial,
        priority: 'recall',
      }),
      evaluateField([], ['a', 'b'], 'x', { ...setPartial, priority: 'recall' }),
    ];
    const sorted = sortByPriority(fields);
    expect(sorted[0]!.key).toBe('x');
  });
});
