import type { RescueSheetV1Draft, OrderedStep } from './schema';
import { SCHEMA_VERSION } from './schema';
import { isPlainObject, makeEnvelope, type SourceContext } from './adapters/types';
import { normalizeEnergySource } from './energy';

/**
 * Built-in normalizer for vision-language-model output. NOT a registry adapter.
 * The extraction prompt asks for the full empty v1.1 domain body; this wraps
 * the model JSON in the required envelope and passes domain sections through.
 */

const DOMAIN_SECTIONS = [
  'standard_reference',
  'vehicle',
  'responder_information',
  'vehicle_layout',
  'warnings',
  'evidence',
  'legacy_fields',
  // v1.0 compat
  'high_voltage_systems',
  'pyrotechnic_devices',
  'fire',
  'submersion',
  'towing_transport_storage',
] as const;

/** Coerce arbitrary parsed model JSON into a canonical draft. Never throws. */
export function normalizeVlmToDraft(modelJson: unknown, ctx: SourceContext): RescueSheetV1Draft {
  const src = isPlainObject(modelJson) ? modelJson : {};

  const draft: RescueSheetV1Draft = {
    ...makeEnvelope(ctx, {
      sourceType: 'vlm_extraction',
      lifecycleStatus: 'draft',
    }),
    vehicle: coerceVehicle(src.vehicle),
    responder_information: isPlainObject(src.responder_information)
      ? (src.responder_information as RescueSheetV1Draft['responder_information'])
      : {},
    evidence: Array.isArray(src.evidence) ? (src.evidence as RescueSheetV1Draft['evidence']) : [],
  };

  for (const section of DOMAIN_SECTIONS) {
    if (
      section === 'vehicle' ||
      section === 'responder_information' ||
      section === 'evidence'
    ) {
      continue;
    }
    const value = src[section];
    if (value !== undefined) {
      (draft as unknown as Record<string, unknown>)[section] = value;
    }
  }

  return draft;
}

function coerceVehicle(raw: unknown): RescueSheetV1Draft['vehicle'] {
  const v = isPlainObject(raw) ? raw : {};
  const propulsionRaw = isPlainObject(v.propulsion) ? v.propulsion : {};
  return {
    manufacturer:
      typeof v.manufacturer === 'string' && v.manufacturer.trim()
        ? v.manufacturer.trim()
        : 'Unknown',
    model: typeof v.model === 'string' && v.model.trim() ? v.model.trim() : 'Unknown',
    ...(v.model_year !== undefined ? { model_year: asStringOrNull(v.model_year) } : {}),
    ...(v.model_year_start !== undefined
      ? { model_year_start: asNumberOrNull(v.model_year_start) }
      : {}),
    ...(v.model_year_end !== undefined
      ? { model_year_end: asNumberOrNull(v.model_year_end) }
      : {}),
    ...(v.vehicle_class !== undefined ? { vehicle_class: asStringOrNull(v.vehicle_class) } : {}),
    ...(v.body_style !== undefined ? { body_style: asStringOrNull(v.body_style) } : {}),
    ...(v.door_count !== undefined ? { door_count: asNumberOrNull(v.door_count) } : {}),
    ...(v.seating_capacity !== undefined
      ? { seating_capacity: asNumberOrNull(v.seating_capacity) }
      : {}),
    propulsion: {
      primary_energy_source: normalizeEnergySource(propulsionRaw.primary_energy_source),
      ...(propulsionRaw.drivetrain !== undefined ? { drivetrain: propulsionRaw.drivetrain as string } : {}),
      ...(propulsionRaw.door_count !== undefined
        ? { door_count: asNumberOrNull(propulsionRaw.door_count) }
        : {}),
      ...(propulsionRaw.secondary_energy_sources !== undefined
        ? { secondary_energy_sources: asStringArray(propulsionRaw.secondary_energy_sources) }
        : {}),
      ...(Array.isArray(propulsionRaw.high_voltage_systems)
        ? { high_voltage_systems: propulsionRaw.high_voltage_systems as RescueSheetV1Draft['vehicle']['propulsion']['high_voltage_systems'] }
        : {}),
      ...(Array.isArray(propulsionRaw.low_voltage_systems)
        ? { low_voltage_systems: propulsionRaw.low_voltage_systems as RescueSheetV1Draft['vehicle']['propulsion']['low_voltage_systems'] }
        : {}),
    },
  };
}

function asStringOrNull(v: unknown): string | null {
  if (v === null) return null;
  return typeof v === 'string' ? v : String(v);
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/**
 * Merge several per-chunk canonical drafts (HTTP 413 page-split fallback).
 * Rich sections deep-merge: arrays concatenate; objects merge shallowly;
 * vehicle scalars prefer non-Unknown / non-other.
 */
export function mergeDrafts(drafts: RescueSheetV1Draft[]): RescueSheetV1Draft {
  if (drafts.length === 0) {
    throw new Error('mergeDrafts: nothing to merge');
  }
  if (drafts.length === 1) return drafts[0];

  const [base, ...rest] = drafts;
  const merged: RescueSheetV1Draft = structuredClone(base);
  merged.schema_version = SCHEMA_VERSION;

  const concatArr = <T>(a: T[] | null | undefined, b: T[] | null | undefined): T[] => [
    ...(a ?? []),
    ...(b ?? []),
  ];

  for (const d of rest) {
    if (merged.vehicle.manufacturer === 'Unknown' && d.vehicle.manufacturer !== 'Unknown') {
      merged.vehicle.manufacturer = d.vehicle.manufacturer;
    }
    if (merged.vehicle.model === 'Unknown' && d.vehicle.model !== 'Unknown') {
      merged.vehicle.model = d.vehicle.model;
    }
    if (merged.vehicle.model_year == null && d.vehicle.model_year != null) {
      merged.vehicle.model_year = d.vehicle.model_year;
    }
    if (merged.vehicle.model_year_start == null && d.vehicle.model_year_start != null) {
      merged.vehicle.model_year_start = d.vehicle.model_year_start;
    }
    if (merged.vehicle.model_year_end == null && d.vehicle.model_year_end != null) {
      merged.vehicle.model_year_end = d.vehicle.model_year_end;
    }
    if (merged.vehicle.vehicle_class == null && d.vehicle.vehicle_class != null) {
      merged.vehicle.vehicle_class = d.vehicle.vehicle_class;
    }
    if (merged.vehicle.body_style == null && d.vehicle.body_style != null) {
      merged.vehicle.body_style = d.vehicle.body_style;
    }
    if (merged.vehicle.door_count == null && d.vehicle.door_count != null) {
      merged.vehicle.door_count = d.vehicle.door_count;
    }
    if (merged.vehicle.seating_capacity == null && d.vehicle.seating_capacity != null) {
      merged.vehicle.seating_capacity = d.vehicle.seating_capacity;
    }

    if (
      merged.vehicle.propulsion.primary_energy_source === 'other' &&
      d.vehicle.propulsion.primary_energy_source !== 'other'
    ) {
      merged.vehicle.propulsion.primary_energy_source = d.vehicle.propulsion.primary_energy_source;
    }
    merged.vehicle.propulsion.high_voltage_systems = concatArr(
      merged.vehicle.propulsion.high_voltage_systems,
      d.vehicle.propulsion.high_voltage_systems
    );
    merged.vehicle.propulsion.low_voltage_systems = concatArr(
      merged.vehicle.propulsion.low_voltage_systems,
      d.vehicle.propulsion.low_voltage_systems
    );

    // Responder sections: merge known keys
    const riA = merged.responder_information ?? {};
    const riB = d.responder_information ?? {};
    const mergeSteps = (
      a: OrderedStep[] | null | undefined,
      b: OrderedStep[] | null | undefined
    ): OrderedStep[] => {
      const steps = concatArr(a, b);
      return steps.map((s, i) => ({ ...s, step_number: i + 1 }));
    };

    if (riA.immobilization || riB.immobilization) {
      riA.immobilization = {
        ordered_steps: mergeSteps(
          riA.immobilization?.ordered_steps,
          riB.immobilization?.ordered_steps
        ),
      };
    }
    if (riA.disable_direct_hazards || riB.disable_direct_hazards) {
      riA.disable_direct_hazards = {
        ...(riA.disable_direct_hazards ?? {}),
        ...(riB.disable_direct_hazards ?? {}),
        ordered_steps: mergeSteps(
          riA.disable_direct_hazards?.ordered_steps,
          riB.disable_direct_hazards?.ordered_steps
        ),
      };
    }
    if (riA.submersion || riB.submersion) {
      riA.submersion = {
        ...(riA.submersion ?? {}),
        ...(riB.submersion ?? {}),
        ordered_steps: mergeSteps(
          riA.submersion?.ordered_steps,
          riB.submersion?.ordered_steps
        ),
        guidance: concatArr(riA.submersion?.guidance, riB.submersion?.guidance),
      };
    }
    if (riA.occupant_access || riB.occupant_access) {
      riA.occupant_access = {
        access_methods: concatArr(
          riA.occupant_access?.access_methods,
          riB.occupant_access?.access_methods
        ),
        extrication_constraints: concatArr(
          riA.occupant_access?.extrication_constraints,
          riB.occupant_access?.extrication_constraints
        ),
      };
    }
    if (riA.fire || riB.fire) {
      riA.fire = {
        ...(riA.fire ?? {}),
        ...(riB.fire ?? {}),
        prohibitions: concatArr(riA.fire?.prohibitions, riB.fire?.prohibitions),
        suppression_cooling_actions: concatArr(
          riA.fire?.suppression_cooling_actions,
          riB.fire?.suppression_cooling_actions
        ),
        monitoring_requirements: concatArr(
          riA.fire?.monitoring_requirements,
          riB.fire?.monitoring_requirements
        ),
      };
    }
    if (riA.stabilization_lifting || riB.stabilization_lifting) {
      riA.stabilization_lifting = {
        lift_areas: concatArr(
          riA.stabilization_lifting?.lift_areas,
          riB.stabilization_lifting?.lift_areas
        ),
        stabilization_points: concatArr(
          riA.stabilization_lifting?.stabilization_points,
          riB.stabilization_lifting?.stabilization_points
        ),
        no_contact_zones: concatArr(
          riA.stabilization_lifting?.no_contact_zones,
          riB.stabilization_lifting?.no_contact_zones
        ),
      };
    }
    if (riA.stored_energy_fluids_gases_solids || riB.stored_energy_fluids_gases_solids) {
      const a = riA.stored_energy_fluids_gases_solids ?? {};
      const b = riB.stored_energy_fluids_gases_solids ?? {};
      riA.stored_energy_fluids_gases_solids = {
        energy_sources: concatArr(a.energy_sources, b.energy_sources),
        high_voltage_cables: concatArr(a.high_voltage_cables, b.high_voltage_cables),
        fluids: concatArr(a.fluids, b.fluids),
        pyrotechnic_devices: concatArr(a.pyrotechnic_devices, b.pyrotechnic_devices),
        prohibited_actions: concatArr(a.prohibited_actions, b.prohibited_actions),
      };
    }
    if (riA.towing_transport_storage || riB.towing_transport_storage) {
      riA.towing_transport_storage = {
        ...(riA.towing_transport_storage ?? {}),
        ...(riB.towing_transport_storage ?? {}),
        guidance: concatArr(
          riA.towing_transport_storage?.guidance,
          riB.towing_transport_storage?.guidance
        ),
        prohibited_methods: concatArr(
          riA.towing_transport_storage?.prohibited_methods,
          riB.towing_transport_storage?.prohibited_methods
        ),
      };
    }
    if (riA.identification_recognition || riB.identification_recognition) {
      riA.identification_recognition = {
        ...(riA.identification_recognition ?? {}),
        ...(riB.identification_recognition ?? {}),
      };
    }
    riA.access = concatArr(riA.access, riB.access);
    riA.notes = concatArr(riA.notes, riB.notes);
    merged.responder_information = riA;

    // Layout
    if (merged.vehicle_layout || d.vehicle_layout) {
      merged.vehicle_layout = {
        components: concatArr(merged.vehicle_layout?.components, d.vehicle_layout?.components),
        structural_zones: concatArr(
          merged.vehicle_layout?.structural_zones,
          d.vehicle_layout?.structural_zones
        ),
        glazing: concatArr(merged.vehicle_layout?.glazing, d.vehicle_layout?.glazing),
      };
    }

    merged.warnings = concatArr(merged.warnings, d.warnings);
    merged.evidence = concatArr(merged.evidence, d.evidence);

    // Preserve first non-null standard_reference
    if (!merged.standard_reference && d.standard_reference) {
      merged.standard_reference = d.standard_reference;
    }
  }

  return merged;
}
