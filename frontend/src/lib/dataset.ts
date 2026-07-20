import type { PageImage } from './api';
import type { RescueSheetV1 } from './canonical/schema';

/** Sentinel string for an absent scalar field. */
export const NOT_FOUND = 'not_found';

/** A golden (or model-extracted) value can be a scalar, a list, or a map. */
export type GoldenValue = string | string[] | Record<string, string>;

export interface GoldenField {
  value: GoldenValue;
  difficulty?: string;
  source?: string;
}

export type GoldenExtraction = Record<string, GoldenField>;

export interface EvalHints {
  fields_most_likely_to_fail?: string[];
  why_they_fail?: string;
  partial_credit_rubric?: Record<string, string>;
}

export interface GoldenDataset {
  golden_extraction: GoldenExtraction;
  model_evaluation_hints?: EvalHints;
  reasoning_log?: string[];
}

/** Lightweight record used for the dataset selector list. */
export interface DatasetMeta {
  id: string;
  name: string;
  pdfName: string;
  dpi: number;
  pageCount: number;
  fieldCount: number;
  createdAt: number;
}

/**
 * Raw source record — the unmodified original payload (pasted golden JSON, OEM
 * JSON, etc.) preserved verbatim for auditability and reprocessing. The app
 * never reads from this directly; it reads the normalized `canonical` record.
 */
export interface RawSourceRecord {
  ingestion_id: string;
  source_type: 'oem_json' | 'vlm_extraction' | 'ocr' | 'pdf' | 'image' | 'manual_authoring' | 'legacy_golden';
  source_format: string;
  received_at: string; // ISO 8601
  raw_payload: unknown;
}

/**
 * Full dataset loaded into memory when selected.
 *
 * `canonical` is the source of truth (rescue-sheet-ev-v1.0). `golden` is a
 * DERIVED projection (`GoldenDataset`) kept so the existing scoring engine,
 * metrics, and golden-facing UI run unchanged. `rawSource` preserves the
 * unmodified input for audit.
 */
export interface DatasetRecord extends DatasetMeta {
  pages: PageImage[];
  canonical: RescueSheetV1;
  golden: GoldenDataset; // derived from `canonical` via goldenProjection()
  rawSource?: RawSourceRecord;
}

export type ValueKind = 'string' | 'array' | 'object';

export function valueKind(v: unknown): ValueKind {
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'string';
}

/**
 * Build a deeply-nested partial object that sets `value` at the given path.
 * Used by the Dataset Viewer editor to produce a patch for `updateDataset`.
 * e.g. buildNestedPatch(['canonical', 'vehicle', 'manufacturer'], 'Tesla')
 *   -> { canonical: { vehicle: { manufacturer: 'Tesla' } } }
 */
export function buildNestedPatch(path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) throw new Error('buildNestedPatch: path must be non-empty');
  const [head, ...rest] = path;
  return { [head]: rest.length === 0 ? value : buildNestedPatch(rest, value) };
}

/** Path segments that are too generic alone — include the parent for clarity. */
const GENERIC_TAIL = new Set([
  'ordered_steps',
  'components',
  'guidance',
  'devices',
  'access_methods',
  'prohibitions',
  'energy_sources',
  'high_voltage_cables',
  'fluids',
  'pyrotechnic_devices',
  'prohibited_actions',
  'prohibited_methods',
  'monitoring_requirements',
  'suppression_cooling_actions',
  'extrication_constraints',
  'lift_areas',
  'stabilization_points',
  'no_contact_zones',
  'structural_zones',
  'glazing',
  'warnings',
]);

function titleCaseSegment(seg: string): string {
  return seg
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHv\b/g, 'HV')
    .replace(/\bSrs\b/g, 'SRS');
}

export function humanLabel(key: string): string {
  // Canonical paths are dotted. Use last two segments when the tail is generic
  // (e.g. multiple "ordered_steps" under different procedures).
  if (!key.includes('.')) return titleCaseSegment(key);
  const parts = key.split('.');
  const last = parts[parts.length - 1] ?? key;
  if (GENERIC_TAIL.has(last) && parts.length >= 2) {
    const parent = parts[parts.length - 2] ?? '';
    return `${titleCaseSegment(parent)} · ${titleCaseSegment(last)}`;
  }
  return titleCaseSegment(last);
}
