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
  JudgeVerdict,
  JudgeFieldResult,
  JudgeOverlay,
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

export {
  DEFAULT_SCORE_WEIGHTS,
  extractionScore,
  normalizeWeights,
  type ExtractionScoreWeights,
} from './score-compose';

export {
  applyJudgeUplift,
  applyJudgeMap,
  resolveFieldJudge,
  countUplifts,
  countReviewed,
  type JudgeResultMap,
} from './uplift';

export {
  JUDGE_PROMPT_VERSION,
  JUDGE_MODEL_ID,
  JUDGE_ENDPOINT,
  JUDGE_VERDICTS,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
  type JudgeCandidate,
} from './judgePrompt';

export {
  JUDGE_PARTIAL_THRESHOLD,
  JUDGE_MAX_CANDIDATES,
  JUDGE_BATCH_SIZE,
  needsJudge,
  selectJudgeCandidates,
  parseJudgeResponse,
  isJudgeVerdict,
  judgeCacheKey,
  clearJudgeCache,
  getCachedJudge,
  setCachedJudge,
  runSemanticJudgeAndUplift,
  reapplyJudgeResults,
  type JudgeRunOptions,
  type JudgeRunOutcome,
} from './judge';
