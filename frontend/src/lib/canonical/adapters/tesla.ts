import type {
  DocumentSourcePage,
  Evidence,
  ExtractionMethod,
  LegacyFields,
  PrimaryEnergySource,
  RescueSheetV1Draft,
  Drivetrain,
  VerificationStatus,
} from '../schema';
import {
  type NormalizeResult,
  type RescueSheetAdapter,
  type SourceContext,
  isPlainObject,
  makeEnvelope,
} from './types';

/**
 * TeslaRescueSheetAdapter — the SINGLE registry adapter.
 *
 * Maps the current free-form Tesla/Cybertruck golden shape
 *   `{ golden_extraction: { [key]: { value, difficulty?, source? } } }`
 * (and a flat `{ manufacturer, model, ... }` object) to `rescue-sheet-ev-v1.1`.
 *
 * A curated key table routes recognized fields to canonical sections; anything
 * unrecognized is preserved verbatim under `legacy_fields` so no data is lost.
 * Rich ISO-style domain gold is NOT handled here — ingest stamps that via
 * `stampRichEnvelope`.
 */

const TESLA_MARKERS = ['tesla', 'cybertruck', 'model s', 'model 3', 'model x', 'model y'];

const ENERGY_MAP: Array<[RegExp, PrimaryEnergySource]> = [
  [/battery|bev|\bev\b|electric/i, 'battery_electric'],
  [/plug[-_ ]?in|phev/i, 'plug_in_hybrid_electric'],
  [/^hybrid|hev/i, 'hybrid_electric'],
  [/gasoline|petrol|\bice\b/i, 'gasoline'],
  [/diesel/i, 'diesel'],
  [/hydrogen|fuel[-_ ]?cell|fcev/i, 'hydrogen_fuel_cell'],
  [/cng|compressed natural gas/i, 'compressed_natural_gas'],
];

const DRIVETRAIN_MAP: Array<[RegExp, Drivetrain]> = [
  [/awd|all[-_ ]?wheel/i, 'awd'],
  [/fwd|front[-_ ]?wheel/i, 'fwd'],
  [/rwd|rear[-_ ]?wheel/i, 'rwd'],
  [/4wd|four[-_ ]?wheel/i, '4wd'],
];

/** A normalized golden field as it appears in the source. */
interface GoldenField {
  value: unknown;
  difficulty?: string | null;
  source?: string | null;
}

interface FieldBag {
  [key: string]: GoldenField;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[-\s]+/g, '_');
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${String(val).trim()}`)
      .filter((s) => s.replace(/^.*:\s*$/, '').length > 0);
  }
  if (v === null || v === undefined) return [];
  const s = String(v).trim();
  return s ? [s] : [];
}

function toScalar(v: unknown): string | null {
  const arr = toStringArray(v);
  return arr.length ? arr.join(' ') : null;
}

function parsePage(source?: string | null): number | null {
  if (!source) return null;
  const m = source.match(/page\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function extractionMethodFor(source?: string | null): ExtractionMethod {
  return /diagram|figure|layout|illustration/i.test(source ?? '')
    ? 'diagram_inference'
    : 'direct_text';
}

function parseHours(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  return m ? Number(m[1]) : null;
}

function normalizeEnergy(v: string): PrimaryEnergySource {
  for (const [re, out] of ENERGY_MAP) if (re.test(v)) return out;
  return 'other';
}

function normalizeDrivetrain(v: string): Drivetrain | undefined {
  for (const [re, out] of DRIVETRAIN_MAP) if (re.test(v)) return out;
  return undefined;
}

function pageIdFor(page: number, pages: DocumentSourcePage[]): string {
  return pages.find((p) => p.page_number === page)?.page_id ?? `file:${page}`;
}

/**
 * Mint one evidence record per referenced page across the whole field bag.
 * Golden-authored evidence is treated as human_verified (curated). Returns the
 * evidence list and a page→evidence_id lookup.
 */
function buildEvidence(bag: FieldBag, pages: DocumentSourcePage[]): {
  evidence: Evidence[];
  pageToId: Map<number, string>;
} {
  const evidence: Evidence[] = [];
  const pageToId = new Map<number, string>();
  let n = 1;
  for (const field of Object.values(bag)) {
    const page = parsePage(field.source);
    if (page !== null && !pageToId.has(page)) {
      const id = `ev_${String(n).padStart(3, '0')}`;
      n += 1;
      pageToId.set(page, id);
      evidence.push({
        evidence_id: id,
        source_file_id: pageIdFor(page, pages),
        sheet_page_number: page,
        source_text: null,
        extraction_method: extractionMethodFor(field.source),
        verification_status: 'human_verified',
      });
    }
  }
  return { evidence, pageToId };
}

function evidenceIdsFor(source: string | null | undefined, pageToId: Map<number, string>): string[] {
  const page = parsePage(source);
  if (page === null) return [];
  const id = pageToId.get(page);
  return id ? [id] : [];
}

/** Curated known-key table → canonical target kind. */
const SCALAR_ROUTES: Array<{ keys: string[]; apply: (b: Builder, s: string) => void }> = [
  {
    keys: ['manufacturer', 'make', 'oem', 'brand'],
    apply: (b, s) => {
      b.vehicle.manufacturer = s;
    },
  },
  {
    keys: ['model', 'vehicle_model', 'car_model'],
    apply: (b, s) => {
      b.vehicle.model = s;
    },
  },
  {
    keys: ['model_year', 'year'],
    apply: (b, s) => {
      b.vehicle.model_year = s;
    },
  },
  {
    keys: ['primary_energy_source', 'energy_source', 'propulsion', 'fuel_type', 'powertrain'],
    apply: (b, s) => {
      b.vehicle.propulsion.primary_energy_source = normalizeEnergy(s);
    },
  },
  {
    keys: ['drivetrain', 'drive'],
    apply: (b, s) => {
      const d = normalizeDrivetrain(s);
      if (d) b.vehicle.propulsion.drivetrain = d;
    },
  },
  {
    keys: ['door_count', 'doors', 'number_of_doors'],
    apply: (b, s) => {
      const m = s.match(/\d+/);
      if (m) b.vehicle.propulsion.door_count = Number(m[0]);
    },
  },
];

const LOCATION_VERIFIED: VerificationStatus = 'human_verified';

interface Builder {
  vehicle: {
    manufacturer?: string;
    model?: string;
    model_year?: string;
    propulsion: {
      primary_energy_source?: PrimaryEnergySource;
      drivetrain?: Drivetrain;
      door_count?: number;
    };
  };
  immobilizationSteps: Array<{ action: string; evidence_ids: string[] }>;
  hv: {
    present?: boolean;
    nominal_voltage_v?: number;
    disconnect?: string[];
    cables?: Array<{ description: string; evidence_ids: string[] }>;
  };
  monitoring: Array<{ description: string; minimum_duration_hours?: number; evidence_ids: string[] }>;
  components: Array<{
    component_class: string;
    location: { value: string; precision: 'non_specific'; verification_status: VerificationStatus };
    evidence_ids: string[];
  }>;
  towing: string[];
  submersion: string[];
  access: string[];
}

function emptyBuilder(): Builder {
  return {
    vehicle: { propulsion: {} },
    immobilizationSteps: [],
    hv: {},
    monitoring: [],
    components: [],
    towing: [],
    submersion: [],
    access: [],
  };
}

export const TeslaRescueSheetAdapter: RescueSheetAdapter = {
  id: 'tesla',

  canHandle(input: unknown): boolean {
    // Already-canonical / rich domain → ingest identity or stamp path.
    if (isPlainObject(input)) {
      const sv = (input as Record<string, unknown>).schema_version;
      if (sv === 'rescue-sheet-ev-v1.0' || sv === 'rescue-sheet-ev-v1.1') return false;
    }
    const json = JSON.stringify(input ?? '').toLowerCase();
    if (TESLA_MARKERS.some((m) => json.includes(m))) return true;
    // The free-form golden envelope counts as Tesla-shaped for this app.
    if (isPlainObject(input) && 'golden_extraction' in input) return true;
    return false;
  },

  normalize(input: unknown, ctx: SourceContext): NormalizeResult {
    const warnings: string[] = [];
    const bag = extractFieldBag(input);
    const { evidence, pageToId } = buildEvidence(bag, ctx.sourcePages);

    const b = emptyBuilder();
    const legacy: LegacyFields = {};

    for (const [rawKey, field] of Object.entries(bag)) {
      const key = normalizeKey(rawKey);
      const routed = routeField(key, field, b, pageToId);
      if (!routed) {
        legacy[rawKey] = {
          value: field.value,
          ...(field.difficulty !== undefined ? { difficulty: field.difficulty } : {}),
          ...(field.source !== undefined ? { source: field.source } : {}),
        };
      }
    }

    if (Object.keys(b.vehicle.manufacturer ?? '').length === 0 && b.vehicle.model === undefined) {
      b.vehicle.manufacturer = b.vehicle.manufacturer ?? 'Tesla';
    }

    // Emit rich v1.1 nesting so projection + prompt share one contract.
    const draft: RescueSheetV1Draft = {
      ...makeEnvelope(ctx, {
        adapterId: 'tesla',
        sourceType: 'oem_json',
        lifecycleStatus: 'draft',
      }),
      vehicle: {
        manufacturer: b.vehicle.manufacturer ?? 'Tesla',
        model: b.vehicle.model ?? 'Unknown',
        ...(b.vehicle.model_year !== undefined ? { model_year: b.vehicle.model_year } : {}),
        ...(b.vehicle.propulsion.door_count !== undefined
          ? { door_count: b.vehicle.propulsion.door_count }
          : {}),
        propulsion: {
          primary_energy_source: b.vehicle.propulsion.primary_energy_source ?? 'other',
          ...(b.vehicle.propulsion.drivetrain !== undefined
            ? { drivetrain: b.vehicle.propulsion.drivetrain }
            : {}),
          ...(b.vehicle.propulsion.door_count !== undefined
            ? { door_count: b.vehicle.propulsion.door_count }
            : {}),
          ...(b.hv.nominal_voltage_v !== undefined
            ? {
                high_voltage_systems: [
                  {
                    nominal_voltage_v: b.hv.nominal_voltage_v,
                    component_type: 'traction_battery',
                    source_text:
                      b.hv.cables?.[0]?.description ??
                      (b.hv.nominal_voltage_v != null ? `${b.hv.nominal_voltage_v}V` : null),
                  },
                ],
              }
            : {}),
        },
      },
      responder_information: {
        ...(b.immobilizationSteps.length
          ? {
              immobilization: {
                ordered_steps: b.immobilizationSteps.map((s, i) => ({
                  step_number: i + 1,
                  action: s.action,
                  evidence_ids: s.evidence_ids,
                })),
              },
            }
          : {}),
        ...(b.access.length
          ? {
              access: b.access,
              occupant_access: {
                access_methods: b.access.map((source_text) => ({
                  source_text,
                })),
              },
            }
          : {}),
        ...(b.monitoring.length
          ? {
              fire: {
                monitoring_requirements: b.monitoring.map((m) => ({
                  description: m.description,
                  minimum_duration_hours: m.minimum_duration_hours,
                  source_text: m.description,
                  evidence_ids: m.evidence_ids,
                })),
              },
            }
          : {}),
        ...(b.submersion.length ? { submersion: { guidance: b.submersion } } : {}),
        ...(b.towing.length
          ? { towing_transport_storage: { guidance: b.towing } }
          : {}),
      },
      ...(b.components.length
        ? {
            vehicle_layout: {
              components: b.components.map((c) => ({
                component_class: c.component_class,
                location_descriptor: c.location.value,
                location: c.location,
                evidence_ids: c.evidence_ids,
              })),
            },
          }
        : {}),
      // Keep v1.0 top-level HV for any legacy consumers / dual projection path
      ...(Object.keys(b.hv).length
        ? {
            high_voltage_systems: {
              present: b.hv.present ?? null,
              ...(b.hv.nominal_voltage_v !== undefined
                ? { nominal_voltage_v: b.hv.nominal_voltage_v }
                : {}),
              ...(b.hv.disconnect ? { disconnect: b.hv.disconnect } : {}),
              ...(b.hv.cables ? { cables: b.hv.cables } : {}),
            },
          }
        : {}),
      evidence,
      ...(Object.keys(legacy).length ? { legacy_fields: legacy } : {}),
    };

    return { draft, adapterId: 'tesla', warnings };
  },
};

/** Extract a flat `{ key: GoldenField }` bag from the source. */
function extractFieldBag(input: unknown): FieldBag {
  const bag: FieldBag = {};
  if (!isPlainObject(input)) return bag;
  const ge = (input as Record<string, unknown>).golden_extraction;
  const sourceBag: Record<string, unknown> =
    ge && typeof ge === 'object' && !Array.isArray(ge)
      ? (ge as Record<string, unknown>)
      : input;

  for (const [k, raw] of Object.entries(sourceBag)) {
    if (['schema_version', 'model_evaluation_hints', 'reasoning_log', 'golden_extraction'].includes(k)) {
      continue;
    }
    if (isPlainObject(raw) && ('value' in raw || 'difficulty' in raw || 'source' in raw)) {
      const f = raw as Record<string, unknown>;
      bag[k] = {
        value: f.value,
        ...(typeof f.difficulty === 'string' ? { difficulty: f.difficulty } : {}),
        ...(typeof f.source === 'string' ? { source: f.source } : {}),
      };
    } else {
      bag[k] = { value: raw };
    }
  }
  return bag;
}

function routeField(
  key: string,
  field: GoldenField,
  b: Builder,
  pageToId: Map<number, string>
): boolean {
  const evidence_ids = evidenceIdsFor(field.source, pageToId);

  // Scalar routes.
  for (const route of SCALAR_ROUTES) {
    if (route.keys.includes(key)) {
      const s = toScalar(field.value);
      if (s) route.apply(b, s);
      return true;
    }
  }

  // Immobilization steps.
  if (/immobili[sz]|power[_ ]?down|shut[_ ]?down|disable/.test(key)) {
    for (const action of toStringArray(field.value)) {
      b.immobilizationSteps.push({ action, evidence_ids });
    }
    return true;
  }

  // High voltage.
  if (/nominal[_ ]?voltage|hv[_ ]?voltage|high[_ ]?voltage[_ ]?nominal/.test(key)) {
    const m = toScalar(field.value)?.match(/(\d+(?:\.\d+)?)/);
    if (m) b.hv.nominal_voltage_v = Number(m[1]);
    return true;
  }
  if (/disconnect|first[_ ]?responder[_ ]?cutoff|cutoff|loop/.test(key) && /hv|high|voltage|disconnect|cutoff/.test(key)) {
    b.hv.disconnect = toStringArray(field.value);
    return true;
  }
  if (/hv[_ ]?cables?|high[_ ]?voltage[_ ]?cables?/.test(key)) {
    b.hv.cables = toStringArray(field.value).map((description) => ({ description, evidence_ids }));
    return true;
  }
  if (/hv[_ ]?present|high[_ ]?voltage[_ ]?present/.test(key)) {
    const s = (toScalar(field.value) ?? '').toLowerCase();
    b.hv.present = /^(true|yes|present|1)$/.test(s) || !/^(false|no|absent|0)$/.test(s) && s.length > 0;
    return true;
  }

  // Fire / battery monitoring.
  if (/monitor|battery.*temperature|thermal/.test(key)) {
    for (const desc of toStringArray(field.value)) {
      const hours = parseHours(desc);
      b.monitoring.push({
        description: desc,
        ...(hours !== null ? { minimum_duration_hours: hours } : {}),
        evidence_ids,
      });
    }
    return true;
  }

  // Layout components (diagram-derived positions; precision non_specific).
  if (/gas[_ ]?strut|strut/.test(key)) {
    for (const loc of toStringArray(field.value)) {
      b.components.push({
        component_class: 'gas_strut',
        location: { value: loc, precision: 'non_specific', verification_status: LOCATION_VERIFIED },
        evidence_ids,
      });
    }
    return true;
  }
  if (/airbag|srs|pretensioner|pyrotechnic/.test(key)) {
    for (const loc of toStringArray(field.value)) {
      b.components.push({
        component_class: /pretensioner/.test(key) ? 'seatbelt_pretensioner' : 'airbag',
        location: { value: loc, precision: 'non_specific', verification_status: LOCATION_VERIFIED },
        evidence_ids,
      });
    }
    return true;
  }

  // Towing / submersion / access guidance.
  if (/tow|transport|storage|recovery/.test(key)) {
    b.towing.push(...toStringArray(field.value));
    return true;
  }
  if (/submer[sz]|water|flood/.test(key)) {
    b.submersion.push(...toStringArray(field.value));
    return true;
  }
  if (/access|door|egress|extricat/.test(key)) {
    b.access.push(...toStringArray(field.value));
    return true;
  }

  // Unrecognized → legacy. Caller will see the warning count via legacy size.
  return false;
}
