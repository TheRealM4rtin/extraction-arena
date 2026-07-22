import type { ValueKind } from '../dataset';

/** How array (and object-as-items) values are aligned. */
export type ListMode = 'sequence' | 'set';

/** Softness of per-item similarity used for partial credit and PRF. */
export type MatchStrategy = 'exact' | 'partial';

/** Which error mode to emphasize in the UI (sort / highlight). */
export type OptimizationPriority = 'precision' | 'recall';

/** Per-field evaluation configuration. */
export interface FieldEvalConfig {
  matchStrategy: MatchStrategy;
  listMode: ListMode;
  priority: OptimizationPriority;
}

export interface PRF {
  precision: number;
  recall: number;
  f1: number;
}

/** One golden item aligned to a model item (or unmatched). */
export interface ItemAlignment {
  goldenIndex: number;
  /** null when the golden item has no partner (false negative). */
  modelIndex: number | null;
  similarity: number;
}

/** Closed vocabulary from the LLM-as-judge. */
export type JudgeVerdict = 'exact' | 'equivalent' | 'partial' | 'different' | 'unknown';

/** One judge decision for a field (or list item). */
export interface JudgeFieldResult {
  /** Field path, or `path#goldenIndex` for list items. */
  id: string;
  verdict: JudgeVerdict;
  rationale: string;
}

/** Snapshot of deterministic scores + judge decision applied (if any). */
export interface JudgeOverlay {
  verdict: JudgeVerdict;
  rationale: string;
  judgeModel: string;
  promptVersion: string;
  /** True when scores were raised above the deterministic baseline. */
  upliftApplied: boolean;
  /** Deterministic metrics before uplift. */
  det: { match: boolean; partial: number; f1: number };
}

export interface FieldEvaluation {
  key: string;
  label: string;
  kind: ValueKind;
  config: FieldEvalConfig;
  /** Gate: field-level exact under listMode + item equality rules. */
  match: boolean;
  /** 0..1 partial credit from the same alignments. */
  partial: number;
  precision: number;
  recall: number;
  f1: number;
  alignments: ItemAlignment[];
  /** Unmatched model items (false positives). */
  modelExtraCount: number;
  goldenCount: number;
  modelCount: number;
  /** Present when this field was reviewed by the semantic judge. */
  judge?: JudgeOverlay;
}

export interface DatasetEvaluation {
  perField: FieldEvaluation[];
  matched: number;
  total: number;
  /** 0–100 exact field-match rate (gate). */
  accuracy: number;
  /** 0–100 mean partial credit. */
  partialAccuracy: number;
  meanPrecision: number;
  meanRecall: number;
  meanF1: number;
  /**
   * 0–100 composed extraction score (gate + partial + F1).
   * Primary UI gauge; computed on post-uplift metrics when judge ran.
   */
  extractionScore: number;
  /** Gate accuracy before any judge uplift (same as accuracy when no judge). */
  detAccuracy?: number;
  /** Number of fields whose scores were raised by the judge. */
  judgeUpliftCount?: number;
  /** Number of fields sent to / reviewed by the judge. */
  judgeReviewedCount?: number;
}

/** Partial override when the user edits config; missing keys use smart defaults. */
export type FieldEvalConfigPatch = Partial<FieldEvalConfig>;
