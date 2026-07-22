import {
  type GoldenDataset,
  type GoldenValue,
  valueKind,
  humanLabel,
  NOT_FOUND,
} from '../dataset';
import type {
  DatasetEvaluation,
  FieldEvalConfig,
  FieldEvaluation,
  PRF,
} from './types';
import { resolveFieldConfig } from './defaults';
import { isAbsentValue, toItems } from './normalize';
import {
  alignSequence,
  alignSet,
  exactBagMatch,
  exactSequenceMatch,
  type AlignmentResult,
} from './align';
import { itemSimilarity, scalarGateMatch, scalarPartial } from './similarity';
import { extractionScore as extractionScoreFromSignals } from './score-compose';

function harmonicMean(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function prfFrom(numerator: number, modelCount: number, goldenCount: number): PRF {
  const precision = modelCount === 0 ? 1 : numerator / modelCount;
  const recall = goldenCount === 0 ? 1 : numerator / goldenCount;
  return { precision, recall, f1: harmonicMean(precision, recall) };
}

function evaluateAbsent(
  mAbsent: boolean,
  gAbsent: boolean
): Pick<
  FieldEvaluation,
  | 'match'
  | 'partial'
  | 'precision'
  | 'recall'
  | 'f1'
  | 'alignments'
  | 'modelExtraCount'
  | 'goldenCount'
  | 'modelCount'
> {
  if (mAbsent && gAbsent) {
    return {
      match: true,
      partial: 1,
      precision: 1,
      recall: 1,
      f1: 1,
      alignments: [],
      modelExtraCount: 0,
      goldenCount: 0,
      modelCount: 0,
    };
  }
  if (gAbsent && !mAbsent) {
    // All model items are false positives.
    return {
      match: false,
      partial: 0,
      precision: 0,
      recall: 1,
      f1: 0,
      alignments: [],
      modelExtraCount: 1,
      goldenCount: 0,
      modelCount: 1,
    };
  }
  // Model missing golden content.
  return {
    match: false,
    partial: 0,
    precision: 1,
    recall: 0,
    f1: 0,
    alignments: [],
    modelExtraCount: 0,
    goldenCount: 1,
    modelCount: 0,
  };
}

function evaluateScalar(
  model: string,
  golden: string,
  fieldKey: string,
  config: FieldEvalConfig
): Omit<FieldEvaluation, 'key' | 'label' | 'kind' | 'config'> {
  const match = scalarGateMatch(model, golden, fieldKey);
  const partial = match ? 1 : scalarPartial(model, golden, fieldKey);
  // Soft PRF uses strategy similarity on the single item.
  const sim = itemSimilarity(model, golden, config.matchStrategy);
  // For partial strategy, also allow high scalarPartial to contribute.
  const softSim =
    config.matchStrategy === 'partial' ? Math.max(sim, partial) : sim;
  const threshold = config.matchStrategy === 'exact' ? 1 : 0.5;
  const numerator = softSim >= threshold ? softSim : 0;
  const { precision, recall, f1 } = prfFrom(numerator, 1, 1);

  return {
    match,
    partial,
    precision,
    recall,
    f1,
    alignments: [
      {
        goldenIndex: 0,
        modelIndex: 0,
        similarity: softSim,
      },
    ],
    modelExtraCount: 0,
    goldenCount: 1,
    modelCount: 1,
  };
}

function evaluateItems(
  modelItems: string[],
  goldenItems: string[],
  config: FieldEvalConfig
): Omit<FieldEvaluation, 'key' | 'label' | 'kind' | 'config'> {
  const listMode = config.listMode;
  const aligned: AlignmentResult =
    listMode === 'sequence'
      ? alignSequence(modelItems, goldenItems, config.matchStrategy)
      : alignSet(modelItems, goldenItems, config.matchStrategy);

  const match =
    listMode === 'sequence'
      ? exactSequenceMatch(modelItems, goldenItems)
      : exactBagMatch(modelItems, goldenItems);

  // Partial: mean similarity of golden items (raw alignment sims, capped).
  let partialSum = 0;
  for (const a of aligned.alignments) {
    // For sequence gate partial, also count normalize-equal positional hits
    // consistently with historical MAIN (exact position fraction).
    partialSum += a.similarity;
  }
  const partial =
    goldenItems.length === 0 ? 0 : Math.min(1, partialSum / goldenItems.length);

  // Sequence + historical MAIN partial used exact-position fraction when
  // strategy is exact-ish; blend: use mean sim which equals that for exact
  // normalize equality (sim 0 or 1).

  const { precision, recall, f1 } = prfFrom(
    aligned.matchedSimilaritySum,
    modelItems.length,
    goldenItems.length
  );

  return {
    match,
    partial,
    precision,
    recall,
    f1,
    alignments: aligned.alignments,
    modelExtraCount: aligned.unmatchedModel.length,
    goldenCount: goldenItems.length,
    modelCount: modelItems.length,
  };
}

/**
 * Evaluate one field. `config` should already be fully resolved
 * (smart defaults + user override).
 */
export function evaluateField(
  modelValue: GoldenValue,
  goldenValue: GoldenValue,
  fieldKey: string,
  config: FieldEvalConfig
): FieldEvaluation {
  const kind = valueKind(goldenValue);
  const base = {
    key: fieldKey,
    label: humanLabel(fieldKey),
    kind,
    config,
  };

  const mAbsent = isAbsentValue(modelValue);
  const gAbsent = isAbsentValue(goldenValue);
  if (mAbsent || gAbsent) {
    return { ...base, ...evaluateAbsent(mAbsent, gAbsent) };
  }

  if (kind === 'string') {
    return {
      ...base,
      ...evaluateScalar(String(modelValue), String(goldenValue), fieldKey, config),
    };
  }

  // Objects default to set-of-pairs; listMode still respected if sequence.
  const modelItems = toItems(modelValue, kind);
  const goldenItems = toItems(goldenValue, kind);
  return {
    ...base,
    ...evaluateItems(modelItems, goldenItems, config),
  };
}

/**
 * Evaluate all golden fields for one model extraction.
 * `configMap` is optional per-field overrides (partial configs allowed).
 */
export function evaluateDataset(
  extracted: Record<string, GoldenValue>,
  golden: GoldenDataset,
  configMap: Record<string, Partial<FieldEvalConfig>> = {}
): DatasetEvaluation {
  const perField: FieldEvaluation[] = Object.entries(golden.golden_extraction).map(
    ([key, field]) => {
      const config = resolveFieldConfig(key, configMap[key]);
      const modelValue = extracted[key] ?? NOT_FOUND;
      return evaluateField(modelValue, field.value, key, config);
    }
  );

  return aggregateFieldEvaluations(perField);
}

export function aggregateFieldEvaluations(perField: FieldEvaluation[]): DatasetEvaluation {
  const matched = perField.filter((f) => f.match).length;
  const total = perField.length;
  const partialSum = perField.reduce((acc, f) => acc + f.partial, 0);
  const pSum = perField.reduce((acc, f) => acc + f.precision, 0);
  const rSum = perField.reduce((acc, f) => acc + f.recall, 0);
  const fSum = perField.reduce((acc, f) => acc + f.f1, 0);

  const accuracy = total === 0 ? 0 : Math.round((matched / total) * 100);
  const partialAccuracy = total === 0 ? 0 : Math.round((partialSum / total) * 100);
  const meanPrecision = total === 0 ? 0 : pSum / total;
  const meanRecall = total === 0 ? 0 : rSum / total;
  const meanF1 = total === 0 ? 0 : fSum / total;

  return {
    perField,
    matched,
    total,
    accuracy,
    partialAccuracy,
    meanPrecision,
    meanRecall,
    meanF1,
    extractionScore: extractionScoreFromSignals({ accuracy, partialAccuracy, meanF1 }),
    judgeUpliftCount: perField.filter((f) => f.judge?.upliftApplied).length,
    judgeReviewedCount: perField.filter((f) => f.judge != null).length,
  };
}

/** Mean PRF across fields that have data for a model view. */
export function meanPrf(fields: FieldEvaluation[]): PRF & { count: number } {
  if (fields.length === 0) return { precision: 0, recall: 0, f1: 0, count: 0 };
  let p = 0;
  let r = 0;
  let f = 0;
  for (const field of fields) {
    p += field.precision;
    r += field.recall;
    f += field.f1;
  }
  const n = fields.length;
  return { precision: p / n, recall: r / n, f1: f / n, count: n };
}

/** Color band for a 0..1 score: ≥0.95 green, ≥0.80 amber, else red. */
export function scoreBand(score: number): 'green' | 'amber' | 'red' {
  if (score >= 0.95) return 'green';
  if (score >= 0.8) return 'amber';
  return 'red';
}

/** Color band for 0–100 accuracy. */
export function accuracyBand(accuracy: number): 'red' | 'yellow' | 'green' {
  if (accuracy >= 80) return 'green';
  if (accuracy >= 50) return 'yellow';
  return 'red';
}

/** Group field keys by top-level path segment. */
export function sectionOfKey(key: string): string {
  if (!key.includes('.')) return key;
  return key.split('.')[0] ?? key;
}

export interface SectionAggregate {
  section: string;
  meanF1: number;
  meanPartial: number;
  accuracy: number;
  count: number;
}

export function aggregateBySection(fields: FieldEvaluation[]): SectionAggregate[] {
  const map = new Map<string, FieldEvaluation[]>();
  for (const f of fields) {
    const s = sectionOfKey(f.key);
    const list = map.get(s) ?? [];
    list.push(f);
    map.set(s, list);
  }
  return [...map.entries()]
    .map(([section, list]) => {
      const agg = aggregateFieldEvaluations(list);
      return {
        section,
        meanF1: agg.meanF1,
        meanPartial: agg.partialAccuracy / 100,
        accuracy: agg.accuracy,
        count: list.length,
      };
    })
    .sort((a, b) => a.section.localeCompare(b.section));
}

/** Histogram bins for a 0..1 score series. */
export function histogramBins(
  values: number[],
  binCount = 5
): Array<{ start: number; end: number; count: number; label: string }> {
  const bins = Array.from({ length: binCount }, (_, i) => {
    const start = i / binCount;
    const end = (i + 1) / binCount;
    return {
      start,
      end,
      count: 0,
      label: `${Math.round(start * 100)}–${Math.round(end * 100)}%`,
    };
  });
  for (const v of values) {
    const clamped = Math.min(0.9999, Math.max(0, v));
    const idx = Math.min(binCount - 1, Math.floor(clamped * binCount));
    bins[idx]!.count += 1;
  }
  return bins;
}

/** Sort fields worst-first by the config priority metric. */
export function sortByPriority(fields: FieldEvaluation[]): FieldEvaluation[] {
  return [...fields].sort((a, b) => {
    const metricA = a.config.priority === 'precision' ? a.precision : a.recall;
    const metricB = b.config.priority === 'precision' ? b.precision : b.recall;
    if (metricA !== metricB) return metricA - metricB;
    // Tie-break: lower F1 first, then key.
    if (a.f1 !== b.f1) return a.f1 - b.f1;
    return a.key.localeCompare(b.key);
  });
}
