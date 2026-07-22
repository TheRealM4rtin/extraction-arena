import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schemaJson from './schema.json';
import type {
  Evidence,
  OrderedStep,
  RescueSheetV1,
  RescueSheetV1Draft,
  VerificationStatus,
} from './schema';

/**
 * Two-level validation of a rescue-sheet draft.
 *
 *   1. STRUCTURAL — JSON Schema Draft 2020-12 (`schema.json`) via ajv
 *   2. DOMAIN — ordered-step sequencing, positive durations/voltages, dangling
 *      evidence refs, publish gate
 *
 * Validation NEVER blocks the eval pipeline — problems are returned as Issue[].
 */

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  issues: Issue[];
  valid: boolean;
  canPublish: boolean;
  publishBlockers: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const structuralValidate = ajv.compile(schemaJson);

function ajvPath(e: { instancePath?: string; propertyName?: string }): string {
  const p = (e.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
  const prop = e.propertyName ? `${p ? p + '.' : ''}${e.propertyName}` : p;
  return prop || '<root>';
}

function structuralIssues(): Issue[] {
  const errs = (structuralValidate.errors ?? []) as Array<{
    instancePath?: string;
    propertyName?: string;
    message?: string;
    keyword?: string;
  }>;
  return errs.map((e) => ({
    level: 'error' as const,
    path: ajvPath(e),
    code: e.keyword ?? 'schema',
    message: e.message ?? 'Fails schema validation.',
  }));
}

function isReviewRequired(v?: VerificationStatus | null): v is 'human_review_required' {
  return v === 'human_review_required';
}

function evidenceIndex(record: RescueSheetV1): Map<string, Evidence> {
  const idx = new Map<string, Evidence>();
  for (const e of record.evidence ?? []) idx.set(e.evidence_id, e);
  return idx;
}

function pageIdSet(record: RescueSheetV1): Set<string> {
  return new Set((record.document?.source_pages ?? []).map((p) => p.page_id));
}

function checkStepSequence(steps: OrderedStep[], path: string, issues: Issue[]): void {
  if (!steps.length) return;
  const seen = new Set<number>();
  let max = 0;
  steps.forEach((s, i) => {
    if (seen.has(s.step_number)) {
      issues.push({
        level: 'error',
        path: `${path}[${i}].step_number`,
        code: 'step_duplicate',
        message: `step_number ${s.step_number} is duplicated.`,
      });
    }
    seen.add(s.step_number);
    if (s.step_number > max) max = s.step_number;
  });
  if (steps.length !== max) {
    issues.push({
      level: 'error',
      path,
      code: 'step_sequence',
      message: `ordered_steps must be consecutive 1..${steps.length}.`,
    });
  }
}

function collectEvidenceRefs(
  record: RescueSheetV1
): Array<{ path: string; ids: string[] }> {
  const refs: Array<{ path: string; ids: string[] }> = [];
  const push = (path: string, ids: string[] | undefined) => {
    if (ids && ids.length > 0) refs.push({ path, ids });
  };

  const ri = record.responder_information;
  ri?.immobilization?.ordered_steps?.forEach((s, i) =>
    push(`responder_information.immobilization.ordered_steps[${i}].evidence_ids`, s.evidence_ids)
  );
  ri?.disable_direct_hazards?.ordered_steps?.forEach((s, i) =>
    push(
      `responder_information.disable_direct_hazards.ordered_steps[${i}].evidence_ids`,
      s.evidence_ids
    )
  );
  ri?.submersion?.ordered_steps?.forEach((s, i) =>
    push(`responder_information.submersion.ordered_steps[${i}].evidence_ids`, s.evidence_ids)
  );
  ri?.fire?.monitoring_requirements?.forEach((m, i) =>
    push(
      `responder_information.fire.monitoring_requirements[${i}].evidence_ids`,
      m.evidence_ids
    )
  );
  record.vehicle_layout?.components?.forEach((c, i) =>
    push(`vehicle_layout.components[${i}].evidence_ids`, c.evidence_ids)
  );
  // v1.0 top-level fallbacks
  record.high_voltage_systems?.cables?.forEach((c, i) =>
    push(`high_voltage_systems.cables[${i}].evidence_ids`, c.evidence_ids)
  );
  record.pyrotechnic_devices?.devices?.forEach((d, i) =>
    push(`pyrotechnic_devices.devices[${i}].evidence_ids`, d.evidence_ids)
  );
  record.fire?.monitoring_requirements?.forEach((m, i) =>
    push(`fire.monitoring_requirements[${i}].evidence_ids`, m.evidence_ids)
  );
  return refs;
}

function collectReviewRequiredPaths(record: RescueSheetV1): string[] {
  const paths: string[] = [];
  const note = (path: string, status?: VerificationStatus | null) => {
    if (isReviewRequired(status)) paths.push(path);
  };

  record.vehicle_layout?.components?.forEach((c, i) =>
    note(
      `vehicle_layout.components[${i}].location.verification_status`,
      c.location?.verification_status
    )
  );
  record.pyrotechnic_devices?.devices?.forEach((d, i) =>
    note(
      `pyrotechnic_devices.devices[${i}].location.verification_status`,
      d.location?.verification_status
    )
  );
  record.evidence?.forEach((e, i) =>
    note(`evidence[${i}].verification_status`, e.verification_status)
  );
  return paths;
}

function domainIssues(record: RescueSheetV1): Issue[] {
  const issues: Issue[] = [];
  const evIdx = evidenceIndex(record);
  const pageIds = pageIdSet(record);
  const ri = record.responder_information;

  checkStepSequence(
    ri?.immobilization?.ordered_steps ?? [],
    'responder_information.immobilization.ordered_steps',
    issues
  );
  checkStepSequence(
    ri?.disable_direct_hazards?.ordered_steps ?? [],
    'responder_information.disable_direct_hazards.ordered_steps',
    issues
  );
  checkStepSequence(
    ri?.submersion?.ordered_steps ?? [],
    'responder_information.submersion.ordered_steps',
    issues
  );

  // Positive durations on fire monitoring (nested + top-level)
  const mon =
    ri?.fire?.monitoring_requirements ?? record.fire?.monitoring_requirements ?? [];
  mon.forEach((m, i) => {
    if (m.minimum_duration_hours !== null && m.minimum_duration_hours !== undefined) {
      if (!(m.minimum_duration_hours > 0)) {
        issues.push({
          level: 'error',
          path: `responder_information.fire.monitoring_requirements[${i}].minimum_duration_hours`,
          code: 'non_positive_duration',
          message: 'minimum_duration_hours must be a positive number.',
        });
      }
    }
  });

  // Positive voltages on propulsion HV / LV systems
  const checkVoltage = (path: string, v: number | null | undefined) => {
    if (v !== null && v !== undefined && !(v > 0)) {
      issues.push({
        level: 'error',
        path,
        code: 'non_positive_voltage',
        message: 'nominal_voltage_v must be a positive number.',
      });
    }
  };
  record.vehicle?.propulsion?.high_voltage_systems?.forEach((s, i) =>
    checkVoltage(`vehicle.propulsion.high_voltage_systems[${i}].nominal_voltage_v`, s.nominal_voltage_v)
  );
  record.vehicle?.propulsion?.low_voltage_systems?.forEach((s, i) =>
    checkVoltage(`vehicle.propulsion.low_voltage_systems[${i}].nominal_voltage_v`, s.nominal_voltage_v)
  );
  checkVoltage(
    'high_voltage_systems.nominal_voltage_v',
    record.high_voltage_systems?.nominal_voltage_v
  );

  for (const { path, ids } of collectEvidenceRefs(record)) {
    for (const id of ids) {
      if (!evIdx.has(id)) {
        issues.push({
          level: 'error',
          path,
          code: 'dangling_evidence',
          message: `evidence_id "${id}" does not resolve to a top-level evidence record.`,
        });
      }
    }
  }

  (record.evidence ?? []).forEach((e, i) => {
    if (!pageIds.has(e.source_file_id)) {
      issues.push({
        level: 'error',
        path: `evidence[${i}].source_file_id`,
        code: 'unknown_source_page',
        message: `source_file_id "${e.source_file_id}" is not in document.source_pages.`,
      });
    }
  });

  // Missing evidence is WARNING only
  for (const { path, ids } of collectEvidenceRefs(record)) {
    if (ids.length === 0) {
      issues.push({
        level: 'warning',
        path,
        code: 'missing_evidence',
        message: 'Claim has no evidence_ids; consider linking a page-level evidence record.',
      });
    }
  }

  return issues;
}

export function validate(
  draft: RescueSheetV1Draft,
  opts: { publishIntent?: boolean } = {}
): ValidationResult {
  const issues: Issue[] = [];

  if (!structuralValidate(draft)) issues.push(...structuralIssues());

  const structurallyOk = issues.length === 0;
  if (structurallyOk) issues.push(...domainIssues(draft));

  const valid = issues.filter((i) => i.level === 'error').length === 0;

  let publishBlockers: string[] = [];
  if (opts.publishIntent) {
    publishBlockers = collectReviewRequiredPaths(draft);
    for (const p of publishBlockers) {
      issues.push({
        level: 'error',
        path: p,
        code: 'publish_blocked_review_required',
        message: 'Cannot publish: this critical field is marked human_review_required.',
      });
    }
  }

  return {
    issues,
    valid,
    canPublish: valid && publishBlockers.length === 0,
    publishBlockers,
  };
}

export { schemaJson, structuralValidate };
export type { RescueSheetV1, RescueSheetV1Draft };
