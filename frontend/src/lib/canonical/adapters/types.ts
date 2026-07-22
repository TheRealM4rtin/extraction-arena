import type {
  AdapterId,
  DocumentSourcePage,
  RescueSheetV1Draft,
  Review,
} from '../schema';
import { SCHEMA_VERSION } from '../schema';

/**
 * Adapter contract. Each adapter maps ONE source shape (e.g. Tesla's golden
 * JSON, a Euro NCAP payload, an OEM PDF parse) to the canonical
 * `rescue-sheet-ev-v1.1` draft. Adapters are tolerant of a source's
 * inconsistent key names but must always emit the same canonical structure.
 *
 * Per the architecture decision, the registry holds a SINGLE adapter today
 * (Tesla). Vision-model output does NOT use a registered adapter — it goes
 * through the built-in `normalizeVlmToDraft()` in `../vlm.ts`.
 */

export interface SourceContext {
  /** Stable record id for the produced draft (e.g. the dataset id). */
  recordId: string;
  /** ISO 8601 timestamp the source was received. */
  receivedAt: string;
  /** Pages derived from the converted PDF; used to mint evidence references. */
  sourcePages: DocumentSourcePage[];
  /** Free-form descriptor of the source format (e.g. "tesla_cybertruck_golden"). */
  sourceFormat: string;
}

export interface NormalizeResult {
  draft: RescueSheetV1Draft;
  adapterId: AdapterId;
  /** Non-fatal notes about unmapped/lossy conversions. */
  warnings: string[];
}

export interface RescueSheetAdapter {
  /** Stable adapter id, stamped into provenance.adapter_id. */
  readonly id: AdapterId;
  /** True if this adapter recognizes the source shape. */
  canHandle(input: unknown): boolean;
  /** Map the source to a canonical draft. Must not throw on shape quirks. */
  normalize(input: unknown, context: SourceContext): NormalizeResult;
}

/** Default review block for a freshly-normalized draft. */
export function defaultReview(): Review {
  return {
    review_required: true,
    review_status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
  };
}

/**
 * Build the required canonical envelope shared by every adapter / normalizer:
 * schema_version, record_id, lifecycle, review, document, provenance. Sections
 * default to absent so the adapter only fills what the source provides.
 */
export function makeEnvelope(
  ctx: SourceContext,
  opts: {
    adapterId?: AdapterId;
    sourceType: RescueSheetV1Draft['provenance']['source_type'];
    lifecycleStatus: RescueSheetV1Draft['lifecycle_status'];
  }
): Pick<
  RescueSheetV1Draft,
  'schema_version' | 'record_id' | 'lifecycle_status' | 'review' | 'document' | 'evidence' | 'provenance'
> {
  return {
    schema_version: SCHEMA_VERSION,
    record_id: ctx.recordId,
    lifecycle_status: opts.lifecycleStatus,
    review: defaultReview(),
    document: {
      document_type: 'rescue_sheet',
      source_pages: ctx.sourcePages.length
        ? ctx.sourcePages
        : [{ page_id: 'file:1', page_number: 1 }],
    },
    evidence: [],
    provenance: {
      source_type: opts.sourceType,
      source_format: ctx.sourceFormat,
      received_at: ctx.receivedAt,
      ...(opts.adapterId ? { adapter_id: opts.adapterId } : {}),
    },
  };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
