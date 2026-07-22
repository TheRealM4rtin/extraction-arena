import type { LifecycleStatus, RescueSheetV1 } from './schema';

/**
 * Lifecycle state machine + publish gate.
 *
 * Per the architecture decision, lifecycle is METADATA + RULES only — there is
 * no review-queue UI. The gate ("cannot publish while a critical field is
 * human_review_required") is enforced here and surfaced via the validator.
 */

export const LIFECYCLE_ORDER: LifecycleStatus[] = [
  'raw',
  'draft',
  'validated',
  'reviewed',
  'published',
];

/** Legal forward transitions. `rejected`/`legacy` are terminal-ish. */
const TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  raw: ['draft', 'rejected'],
  draft: ['validated', 'reviewed', 'rejected'],
  validated: ['reviewed', 'published', 'rejected'],
  reviewed: ['published', 'rejected', 'validated'],
  published: ['reviewed', 'rejected'],
  rejected: ['draft'],
  legacy: ['draft'], // a migrated legacy record can be re-authored to draft
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Apply a lifecycle transition if legal. Returns the new record and a flag.
 * Does NOT itself run the publish gate — callers should pass `gateOk` when
 * transitioning to `published` so the gate is enforced at the call site.
 */
export function applyTransition(
  record: RescueSheetV1,
  to: LifecycleStatus,
  opts: { gateOk?: boolean; reviewedBy?: string } = {}
): { record: RescueSheetV1; ok: boolean; reason?: string } {
  if (to === 'published') {
    if (opts.gateOk === false) {
      return {
        record,
        ok: false,
        reason: 'Publish gate blocked: one or more critical fields are human_review_required.',
      };
    }
  }
  if (!canTransition(record.lifecycle_status, to)) {
    return {
      record,
      ok: false,
      reason: `Illegal transition ${record.lifecycle_status} -> ${to}.`,
    };
  }
  const now = new Date().toISOString();
  const review = { ...record.review };
  if (to === 'reviewed' || to === 'published') {
    review.review_status = to === 'published' ? 'approved' : 'approved';
    review.reviewed_at = now;
    if (opts.reviewedBy) review.reviewed_by = opts.reviewedBy;
  }
  return { record: { ...record, lifecycle_status: to, review }, ok: true };
}

/**
 * Promote a freshly-validated draft through the standard eval-pipeline path:
 * draft -> validated (when structurally/domain valid). Golden records created
 * via an adapter land here. Returns the record unchanged if not valid.
 */
export function markValidated(record: RescueSheetV1, valid: boolean): RescueSheetV1 {
  if (valid && canTransition(record.lifecycle_status, 'validated')) {
    return applyTransition(record, 'validated').record;
  }
  return record;
}
