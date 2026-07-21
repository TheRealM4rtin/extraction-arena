export type {
  ListMode,
  MatchStrategy,
  OptimizationPriority,
  FieldEvalConfig,
  FieldEvalConfigPatch,
  PRF,
  ItemAlignment,
  FieldEvaluation,
  DatasetEvaluation,
} from './types';

export {
  isAbsentValue,
  normalizeStr,
  tokenizeScalar,
  toItems,
} from './normalize';

export { itemSimilarity, scalarGateMatch, scalarPartial } from './similarity';

export {
  alignSequence,
  alignSet,
  exactBagMatch,
  exactSequenceMatch,
} from './align';

export {
  DEFAULT_FIELD_CONFIG,
  defaultConfigForField,
  resolveFieldConfig,
} from './defaults';

export {
  evaluateField,
  evaluateDataset,
  aggregateFieldEvaluations,
  meanPrf,
  scoreBand,
  accuracyBand,
  sectionOfKey,
  aggregateBySection,
  histogramBins,
  sortByPriority,
  type SectionAggregate,
} from './evaluate';
