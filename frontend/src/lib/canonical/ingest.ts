import type { PageImage } from '../api';
import type { DatasetMeta, DatasetRecord, GoldenDataset, RawSourceRecord } from '../dataset';
import type {
  DocumentSourcePage,
  Provenance,
  RescueSheetV1,
  Review,
} from './schema';
import { SCHEMA_VERSION, SCHEMA_VERSION_V10 } from './schema';
import { normalizeWithAdapter } from './adapters/registry';
import { TeslaRescueSheetAdapter } from './adapters/tesla';
import type { SourceContext } from './adapters/types';
import { defaultReview, isPlainObject } from './adapters/types';
import { normalizeEnergySource } from './energy';
import { goldenProjection } from './project';
import { validate } from './validate';
import { applyTransition } from './lifecycle';

export { normalizeEnergySource } from './energy';

/**
 * Unified ingestion: paste/source JSON → canonical (v1.1) + golden projection
 * + rawSource audit copy.
 *
 * Rich domain gold (your Cybertruck dataset shape) is accepted via envelope
 * stamping — not a blind cast. Free-form Tesla golden_extraction uses the
 * adapter. Simplified v1.0 records are upgraded best-effort.
 */

export interface IngestInput {
  rawJson: unknown;
  pages: PageImage[];
  pdfName: string;
  recordId: string;
  sourceFormat?: string;
}

export interface IngestResult {
  canonical: RescueSheetV1;
  golden: GoldenDataset;
  rawSource: RawSourceRecord;
  issues: ReturnType<typeof validate>['issues'];
}

function pagesToSourcePages(pages: PageImage[], pdfName: string): DocumentSourcePage[] {
  return pages.map((p) => ({
    page_id: `file:${p.page}`,
    page_number: p.page,
    filename: pdfName,
    sheet_page_number: p.page,
  }));
}

/**
 * True when the payload looks like the rich ISO-style domain gold (even if it
 * still claims schema_version v1.0).
 */
export function isRichDomainShape(obj: Record<string, unknown>): boolean {
  if (obj.standard_reference != null) return true;
  if (Array.isArray(obj.warnings) && obj.warnings.length > 0) return true;
  const ri = obj.responder_information;
  if (isPlainObject(ri)) {
    if (ri.disable_direct_hazards != null) return true;
    if (ri.stabilization_lifting != null) return true;
    if (ri.occupant_access != null) return true;
    if (ri.stored_energy_fluids_gases_solids != null) return true;
    if (isPlainObject(ri.fire) && (ri.fire as Record<string, unknown>).suppression_cooling_actions != null) {
      return true;
    }
  }
  const vehicle = obj.vehicle;
  if (isPlainObject(vehicle) && isPlainObject(vehicle.propulsion)) {
    const prop = vehicle.propulsion as Record<string, unknown>;
    if (Array.isArray(prop.high_voltage_systems) || Array.isArray(prop.low_voltage_systems)) {
      return true;
    }
  }
  const layout = obj.vehicle_layout;
  if (isPlainObject(layout) && Array.isArray(layout.structural_zones)) return true;
  return false;
}

function isCanonicalVersion(v: unknown): boolean {
  return v === SCHEMA_VERSION || v === SCHEMA_VERSION_V10;
}

/**
 * Normalize source_pages from rich gold (sheet_page_number / attachment_id)
 * or from conversion context into the required page_id + page_number form.
 */
function stampSourcePages(
  rawPages: unknown,
  ctxPages: DocumentSourcePage[]
): DocumentSourcePage[] {
  if (Array.isArray(rawPages) && rawPages.length > 0) {
    return rawPages.map((p, i) => {
      const page = isPlainObject(p) ? p : {};
      const sheetNum =
        typeof page.sheet_page_number === 'number'
          ? page.sheet_page_number
          : typeof page.page_number === 'number'
            ? page.page_number
            : i + 1;
      const page_id =
        typeof page.page_id === 'string' && page.page_id
          ? page.page_id
          : typeof page.attachment_id === 'string' && page.attachment_id
            ? page.attachment_id
            : `file:${sheetNum}`;
      return {
        page_id,
        page_number: sheetNum,
        sheet_page_number:
          typeof page.sheet_page_number === 'number' ? page.sheet_page_number : sheetNum,
        filename: (page.filename as string | null | undefined) ?? ctxPages[i]?.filename ?? null,
        attachment_id: (page.attachment_id as string | null | undefined) ?? null,
        attachment_filename: (page.attachment_filename as string | null | undefined) ?? null,
        printed_page_number: (page.printed_page_number as string | null | undefined) ?? null,
        content_summary: (page.content_summary as string | null | undefined) ?? null,
      };
    });
  }
  return ctxPages.length ? ctxPages : [{ page_id: 'file:1', page_number: 1 }];
}

function stampProvenance(
  raw: unknown,
  ctx: SourceContext,
  adapterId?: string
): Provenance {
  const p = isPlainObject(raw) ? raw : {};
  return {
    source_type: (p.source_type as Provenance['source_type']) ?? 'oem_json',
    source_format: (p.source_format as string) ?? ctx.sourceFormat,
    received_at: (p.received_at as string) ?? ctx.receivedAt,
    ...(adapterId || p.adapter_id
      ? { adapter_id: (adapterId ?? p.adapter_id) as string }
      : {}),
    ...(p.source_document != null ? { source_document: p.source_document as Record<string, unknown> } : {}),
    ...(p.validation_policy != null
      ? { validation_policy: p.validation_policy as Record<string, unknown> }
      : {}),
    ...(p.page_to_attachment_mapping != null
      ? {
          page_to_attachment_mapping: p.page_to_attachment_mapping as Record<string, string>,
        }
      : {}),
  };
}

/**
 * Stamp required envelope onto a rich domain body without discarding nested
 * content. Normalizes energy enum and source_pages.
 */
export function stampRichEnvelope(
  raw: Record<string, unknown>,
  ctx: SourceContext,
  opts: { adapterId?: string; lifecycleStatus?: RescueSheetV1['lifecycle_status'] } = {}
): RescueSheetV1 {
  const rawDoc = isPlainObject(raw.document) ? raw.document : {};
  const rawVehicle = isPlainObject(raw.vehicle) ? raw.vehicle : {};
  const rawProp = isPlainObject(rawVehicle.propulsion) ? rawVehicle.propulsion : {};

  const review: Review =
    isPlainObject(raw.review) &&
    typeof (raw.review as { review_required?: unknown }).review_required === 'boolean'
      ? (raw.review as unknown as Review)
      : defaultReview();

  const energy = normalizeEnergySource(rawProp.primary_energy_source);

  const vehicle: RescueSheetV1['vehicle'] = {
    manufacturer:
      typeof rawVehicle.manufacturer === 'string' && rawVehicle.manufacturer.trim()
        ? rawVehicle.manufacturer.trim()
        : 'Unknown',
    model:
      typeof rawVehicle.model === 'string' && rawVehicle.model.trim()
        ? rawVehicle.model.trim()
        : 'Unknown',
    ...(rawVehicle.model_year !== undefined
      ? { model_year: rawVehicle.model_year as string | null }
      : {}),
    ...(rawVehicle.model_year_start !== undefined
      ? { model_year_start: rawVehicle.model_year_start as number | null }
      : {}),
    ...(rawVehicle.model_year_end !== undefined
      ? { model_year_end: rawVehicle.model_year_end as number | null }
      : {}),
    ...(rawVehicle.vehicle_class !== undefined
      ? { vehicle_class: rawVehicle.vehicle_class as string | null }
      : {}),
    ...(rawVehicle.body_style !== undefined
      ? { body_style: rawVehicle.body_style as string | null }
      : {}),
    ...(rawVehicle.door_count !== undefined
      ? { door_count: rawVehicle.door_count as number | null }
      : {}),
    ...(rawVehicle.seating_capacity !== undefined
      ? { seating_capacity: rawVehicle.seating_capacity as number | null }
      : {}),
    propulsion: {
      ...rawProp,
      primary_energy_source: energy,
    } as RescueSheetV1['vehicle']['propulsion'],
  };

  const canonical: RescueSheetV1 = {
    // Preserve extra top-level domain keys (warnings, layout, standard_reference…)
    ...(raw as unknown as RescueSheetV1),
    schema_version: SCHEMA_VERSION,
    record_id:
      typeof raw.record_id === 'string' && raw.record_id
        ? raw.record_id
        : ctx.recordId,
    lifecycle_status:
      opts.lifecycleStatus ??
      (typeof raw.lifecycle_status === 'string'
        ? (raw.lifecycle_status as RescueSheetV1['lifecycle_status'])
        : 'draft'),
    review,
    document: {
      document_type: 'rescue_sheet',
      ...(typeof rawDoc.document_id === 'string' ? { document_id: rawDoc.document_id } : {}),
      ...(typeof rawDoc.document_version === 'string'
        ? { document_version: rawDoc.document_version }
        : {}),
      ...(typeof rawDoc.sheet_page_count === 'number'
        ? { sheet_page_count: rawDoc.sheet_page_count }
        : {}),
      source_pages: stampSourcePages(rawDoc.source_pages, ctx.sourcePages),
    },
    vehicle,
    responder_information: isPlainObject(raw.responder_information)
      ? (raw.responder_information as RescueSheetV1['responder_information'])
      : {},
    evidence: Array.isArray(raw.evidence) ? (raw.evidence as RescueSheetV1['evidence']) : [],
    provenance: stampProvenance(raw.provenance, ctx, opts.adapterId ?? 'identity_rich'),
  };

  return canonical;
}

export function ingestToCanonical(input: IngestInput): IngestResult {
  const receivedAt = new Date().toISOString();
  const ctx: SourceContext = {
    recordId: input.recordId,
    receivedAt,
    sourcePages: pagesToSourcePages(input.pages, input.pdfName),
    sourceFormat: input.sourceFormat ?? 'arbitrary_json',
  };

  let canonical: RescueSheetV1;
  let adapterId: string | undefined;

  const rawObj = isPlainObject(input.rawJson) ? input.rawJson : null;

  if (rawObj && (isCanonicalVersion(rawObj.schema_version) || isRichDomainShape(rawObj))) {
    // Rich domain gold OR already-canonical: stamp envelope, never blind-cast.
    if (isRichDomainShape(rawObj) || isCanonicalVersion(rawObj.schema_version)) {
      // Simplified v1.0 (no rich markers) still gets stamp so required fields exist.
      canonical = stampRichEnvelope(rawObj, ctx, {
        adapterId: isRichDomainShape(rawObj) ? 'identity_rich' : 'identity',
      });
      adapterId = isRichDomainShape(rawObj) ? 'identity_rich' : 'identity';
    } else {
      canonical = stampRichEnvelope(rawObj, ctx);
      adapterId = 'identity';
    }
  } else {
    const result = normalizeWithAdapter(input.rawJson, ctx);
    if (result) {
      canonical = result.draft;
      adapterId = result.adapterId;
    } else if (rawObj) {
      const fallback = TeslaRescueSheetAdapter.normalize(input.rawJson, ctx);
      canonical = fallback.draft;
      adapterId = fallback.adapterId;
    } else {
      canonical = {
        schema_version: SCHEMA_VERSION,
        record_id: input.recordId,
        lifecycle_status: 'legacy',
        review: defaultReview(),
        document: {
          document_type: 'rescue_sheet',
          source_pages: ctx.sourcePages.length
            ? ctx.sourcePages
            : [{ page_id: 'file:1', page_number: 1 }],
        },
        vehicle: {
          manufacturer: 'Unknown',
          model: 'Unknown',
          propulsion: { primary_energy_source: 'other' },
        },
        responder_information: {},
        evidence: [],
        provenance: {
          source_type: 'legacy_golden',
          source_format: ctx.sourceFormat,
          received_at: receivedAt,
        },
        legacy_fields: { raw: { value: input.rawJson } },
      };
    }
  }

  const validation = validate(canonical);
  if (validation.valid) {
    const v = applyTransition(canonical, 'validated').record;
    canonical = applyTransition(v, 'reviewed').record;
  }

  const rawSource: RawSourceRecord = {
    ingestion_id: `ing_${input.recordId}`,
    source_type: adapterId ? 'oem_json' : 'legacy_golden',
    source_format: ctx.sourceFormat,
    received_at: receivedAt,
    raw_payload: input.rawJson,
  };

  return {
    canonical,
    golden: goldenProjection(canonical),
    rawSource,
    issues: validation.issues,
  };
}

/**
 * Migrate a pre-v1 dataset record (no `canonical`) to the new shape.
 * Non-destructive: original `golden` is preserved for legacy records.
 */
export function migrateLegacyDataset(
  rec: DatasetMeta & { pages: PageImage[]; golden: GoldenDataset } & Record<string, unknown>
): DatasetRecord {
  const ingested = ingestToCanonical({
    rawJson: { golden_extraction: rec.golden.golden_extraction },
    pages: rec.pages,
    pdfName: rec.pdfName,
    recordId: rec.id,
    sourceFormat: 'legacy_golden',
  });
  return {
    ...rec,
    canonical: ingested.canonical,
    golden: rec.golden,
    rawSource: ingested.rawSource,
  };
}
