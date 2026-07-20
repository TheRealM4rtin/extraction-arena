import type { GoldenDataset, GoldenExtraction, GoldenValue } from '../dataset';
import type {
  EnergySystemEntry,
  FireMonitoringRequirement,
  LayoutComponent,
  OrderedStep,
  RescueSheetV1,
  StoredEnergyItem,
  WarningEntry,
  Evidence,
} from './schema';

/**
 * Project a rich v1.1 canonical record into the flat `path -> GoldenValue` map
 * that scoring / metrics / GT UI consume.
 *
 * Policy: procedure-level and inventory-level paths (~30–50), not every leaf.
 * Arrays preserve document order (scoring is order-sensitive).
 */

export interface ProjectedField {
  value: GoldenValue;
}

export type Projection = Record<string, ProjectedField>;

function pushScalar(out: Projection, path: string, v: string | number | boolean | null | undefined): void {
  if (v === null || v === undefined || v === '') return;
  out[path] = { value: String(v) };
}

function pushArray(out: Projection, path: string, v: string[] | null | undefined): void {
  if (v === null || v === undefined) return;
  out[path] = { value: v };
}

function stepActions(steps: OrderedStep[] | null | undefined): string[] | undefined {
  if (!steps || steps.length === 0) return undefined;
  return steps.map((s) => s.action).filter(Boolean);
}

function energySystemSummaries(systems: EnergySystemEntry[] | null | undefined): string[] | undefined {
  if (!systems || systems.length === 0) return undefined;
  return systems.map((s) => {
    const parts: string[] = [];
    if (s.nominal_voltage_v != null) parts.push(`${s.nominal_voltage_v}V`);
    if (s.chemistry) parts.push(s.chemistry);
    if (s.component_type) parts.push(s.component_type);
    if (s.component_class) parts.push(s.component_class);
    if (s.energy_type) parts.push(s.energy_type);
    if (parts.length === 0 && s.source_text) return s.source_text;
    return parts.join(' ') || s.source_text || 'unknown';
  });
}

function componentStrings(comps: LayoutComponent[] | null | undefined): string[] | undefined {
  if (!comps || comps.length === 0) return undefined;
  return comps.map((c) => {
    const loc =
      c.location_descriptor ??
      c.location?.value ??
      null;
    return loc ? `${c.component_class} @ ${loc}` : c.component_class;
  });
}

function storedItemSummaries(items: StoredEnergyItem[] | null | undefined): string[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((it) => {
    if (it.source_text) return it.source_text;
    const parts: string[] = [];
    if (it.component_class) parts.push(it.component_class);
    if (it.cable_type) parts.push(it.cable_type);
    if (it.fluid_type) parts.push(it.fluid_type);
    if (it.nominal_voltage_v != null) parts.push(`${it.nominal_voltage_v}V`);
    if (it.chemistry) parts.push(it.chemistry);
    if (it.insulation_color) parts.push(it.insulation_color);
    if (it.action) parts.push(it.action);
    if (Array.isArray(it.color)) parts.push(it.color.join('/'));
    else if (it.color) parts.push(String(it.color));
    return parts.join(' ') || 'item';
  });
}

function monitoringSummaries(
  items: FireMonitoringRequirement[] | null | undefined
): string[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((m) => {
    if (m.source_text) return m.source_text;
    if (m.description) {
      return m.minimum_duration_hours != null
        ? `${m.description} (${m.minimum_duration_hours}h)`
        : m.description;
    }
    if (m.parameter) {
      return m.minimum_duration_hours != null
        ? `${m.parameter} (${m.minimum_duration_hours}h)`
        : m.parameter;
    }
    return 'monitoring';
  });
}

function actionOrTextList(
  items: Array<{ action?: string | null; source_text?: string | null }> | null | undefined
): string[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((it) => it.source_text || it.action || 'item').filter(Boolean);
}

function warningSummaries(warnings: WarningEntry[] | null | undefined): string[] | undefined {
  if (!warnings || warnings.length === 0) return undefined;
  return warnings.map((w) => w.source_text || w.warning_id || w.hazard_type || 'warning');
}

function accessMethodSummaries(
  methods: Array<{
    source_text?: string | null;
    access_target?: string | null;
    access_direction?: string | null;
    power_state?: string | null;
    action?: string | null;
  }> | null | undefined
): string[] | undefined {
  if (!methods || methods.length === 0) return undefined;
  return methods.map((m) => {
    if (m.source_text) return m.source_text;
    if (m.action) return m.action;
    const parts = [m.access_target, m.access_direction, m.power_state].filter(Boolean);
    return parts.join(' / ') || 'access';
  });
}

function zoneSummaries(
  zones: Array<{ color_code?: string | null; meaning?: string | null; source_text?: string | null; component_class?: string | null }> | null | undefined
): string[] | undefined {
  if (!zones || zones.length === 0) return undefined;
  return zones.map((z) => {
    if (z.source_text) return z.source_text;
    if (z.meaning) return z.color_code ? `${z.color_code}: ${z.meaning}` : z.meaning;
    return z.component_class || z.color_code || 'zone';
  });
}

export function project(record: RescueSheetV1): Projection {
  const out: Projection = {};
  const v = record.vehicle;
  const p = v?.propulsion;
  const ri = record.responder_information ?? {};

  // Vehicle identity
  pushScalar(out, 'vehicle.manufacturer', v?.manufacturer);
  pushScalar(out, 'vehicle.model', v?.model);
  pushScalar(out, 'vehicle.model_year', v?.model_year);
  pushScalar(out, 'vehicle.model_year_start', v?.model_year_start);
  pushScalar(out, 'vehicle.body_style', v?.body_style);
  pushScalar(out, 'vehicle.door_count', v?.door_count ?? p?.door_count);
  pushScalar(out, 'vehicle.seating_capacity', v?.seating_capacity);
  pushScalar(out, 'vehicle.propulsion.primary_energy_source', p?.primary_energy_source);
  pushScalar(out, 'vehicle.propulsion.drivetrain', p?.drivetrain ?? undefined);
  pushArray(out, 'vehicle.propulsion.high_voltage_systems', energySystemSummaries(p?.high_voltage_systems));
  pushArray(out, 'vehicle.propulsion.low_voltage_systems', energySystemSummaries(p?.low_voltage_systems));

  // Immobilization
  pushArray(
    out,
    'responder_information.immobilization.ordered_steps',
    stepActions(ri.immobilization?.ordered_steps)
  );

  // Stabilization / lifting
  const stab = ri.stabilization_lifting;
  if (stab) {
    pushArray(out, 'responder_information.stabilization_lifting.lift_areas', zoneSummaries(stab.lift_areas));
    pushArray(
      out,
      'responder_information.stabilization_lifting.stabilization_points',
      zoneSummaries(stab.stabilization_points)
    );
    pushArray(
      out,
      'responder_information.stabilization_lifting.no_contact_zones',
      zoneSummaries(stab.no_contact_zones)
    );
  }

  // Disable direct hazards
  const disable = ri.disable_direct_hazards;
  if (disable) {
    pushArray(
      out,
      'responder_information.disable_direct_hazards.ordered_steps',
      stepActions(disable.ordered_steps)
    );
    const frl = disable.first_responder_loop as { action?: string; source_text?: string } | null | undefined;
    if (frl?.source_text || frl?.action) {
      pushScalar(
        out,
        'responder_information.disable_direct_hazards.first_responder_loop',
        frl.source_text || frl.action
      );
    }
  }

  // Occupant access
  const access = ri.occupant_access;
  if (access) {
    pushArray(
      out,
      'responder_information.occupant_access.access_methods',
      accessMethodSummaries(access.access_methods)
    );
    pushArray(
      out,
      'responder_information.occupant_access.extrication_constraints',
      actionOrTextList(access.extrication_constraints)
    );
  }
  // Legacy v1.0 free-form access
  pushArray(out, 'responder_information.access', ri.access ?? undefined);

  // Stored energy / fluids
  const stored = ri.stored_energy_fluids_gases_solids;
  if (stored) {
    pushArray(
      out,
      'responder_information.stored_energy_fluids_gases_solids.energy_sources',
      storedItemSummaries(stored.energy_sources)
    );
    pushArray(
      out,
      'responder_information.stored_energy_fluids_gases_solids.high_voltage_cables',
      storedItemSummaries(stored.high_voltage_cables)
    );
    pushArray(
      out,
      'responder_information.stored_energy_fluids_gases_solids.fluids',
      storedItemSummaries(stored.fluids)
    );
    pushArray(
      out,
      'responder_information.stored_energy_fluids_gases_solids.pyrotechnic_devices',
      storedItemSummaries(stored.pyrotechnic_devices)
    );
    pushArray(
      out,
      'responder_information.stored_energy_fluids_gases_solids.prohibited_actions',
      actionOrTextList(stored.prohibited_actions)
    );
  }

  // Fire (prefer nested under responder_information; fall back to top-level v1.0)
  const fire = ri.fire ?? record.fire;
  if (fire) {
    pushArray(
      out,
      'responder_information.fire.prohibitions',
      actionOrTextList(fire.prohibitions)
    );
    {
      const suppression = (fire.suppression_cooling_actions ?? [])
        .map(
          (a) =>
            a.source_text ||
            [a.action, a.target, a.application_direction].filter(Boolean).join(' ')
        )
        .filter((s): s is string => Boolean(s));
      pushArray(out, 'responder_information.fire.suppression_cooling_actions', suppression);
    }
    pushArray(
      out,
      'responder_information.fire.monitoring_requirements',
      monitoringSummaries(fire.monitoring_requirements)
    );
    if (fire.reignition_risk?.source_text != null || fire.reignition_risk?.risk_present != null) {
      pushScalar(
        out,
        'responder_information.fire.reignition_risk',
        fire.reignition_risk.source_text ??
          (fire.reignition_risk.risk_present ? 'true' : 'false')
      );
    }
    pushArray(out, 'responder_information.fire.extinguishing_agents', fire.extinguishing_agents ?? undefined);
  }

  // Submersion
  const sub = ri.submersion ?? record.submersion;
  if (sub) {
    pushArray(out, 'responder_information.submersion.ordered_steps', stepActions(sub.ordered_steps));
    pushArray(out, 'responder_information.submersion.guidance', sub.guidance ?? undefined);
    if (sub.hazard_note) pushScalar(out, 'responder_information.submersion.hazard_note', sub.hazard_note);
    const drain = sub.drainage_lift_requirement as
      | { purpose?: string; approximate_lift_height_cm?: number; vehicle_end_to_raise?: string }
      | null
      | undefined;
    if (drain) {
      const parts = [
        drain.vehicle_end_to_raise,
        drain.approximate_lift_height_cm != null ? `${drain.approximate_lift_height_cm}cm` : null,
        drain.purpose,
      ].filter(Boolean);
      if (parts.length) {
        pushScalar(out, 'responder_information.submersion.drainage_lift_requirement', parts.join(' '));
      }
    }
  }

  // Towing / transport / storage
  const tow = ri.towing_transport_storage ?? record.towing_transport_storage;
  if (tow) {
    pushArray(out, 'responder_information.towing_transport_storage.guidance', tow.guidance ?? undefined);
    const method = tow.transport_method as { required_method?: string; source_text?: string } | null | undefined;
    if (method?.source_text || method?.required_method) {
      pushScalar(
        out,
        'responder_information.towing_transport_storage.transport_method',
        method.source_text || method.required_method
      );
    }
    pushArray(
      out,
      'responder_information.towing_transport_storage.prohibited_methods',
      actionOrTextList(tow.prohibited_methods)
    );
    const storage = tow.post_incident_storage as
      | { storage_location?: string; minimum_separation_m?: number; hazard_note?: string; source_equivalent_imperial?: string }
      | null
      | undefined;
    if (storage) {
      const parts = [
        storage.storage_location,
        storage.minimum_separation_m != null ? `${storage.minimum_separation_m}m` : null,
        storage.hazard_note,
      ].filter(Boolean);
      if (parts.length) {
        pushScalar(
          out,
          'responder_information.towing_transport_storage.post_incident_storage',
          parts.join(' ')
        );
      }
    }
  }

  // Silent vehicle / identification
  const silent = ri.identification_recognition?.silent_vehicle_warning;
  if (silent?.source_text || silent?.hazard_type) {
    pushScalar(
      out,
      'responder_information.identification_recognition.silent_vehicle_warning',
      silent.source_text || silent.hazard_type
    );
  }

  // Vehicle layout
  const layout = record.vehicle_layout;
  if (layout) {
    pushArray(out, 'vehicle_layout.components', componentStrings(layout.components));
    pushArray(
      out,
      'vehicle_layout.structural_zones',
      (layout.structural_zones ?? []).map(
        (z) => z.source_text || [z.zone_class, z.location_descriptor].filter(Boolean).join(' @ ')
      ).filter(Boolean) as string[]
    );
    pushArray(
      out,
      'vehicle_layout.glazing',
      (layout.glazing ?? []).map((g) => {
        if (g.source_text) return g.source_text;
        const locs = (g.glazing_locations ?? []).join(', ');
        return g.glazing_type ? `${locs}: ${g.glazing_type}` : locs;
      }).filter(Boolean) as string[]
    );
  }

  // Warnings
  pushArray(out, 'warnings', warningSummaries(record.warnings));

  // v1.0 top-level HV / pyrotechnic fallbacks (if rich paths empty)
  if (!out['vehicle.propulsion.high_voltage_systems'] && record.high_voltage_systems) {
    const hv = record.high_voltage_systems;
    pushScalar(out, 'high_voltage_systems.nominal_voltage_v', hv.nominal_voltage_v);
    pushArray(out, 'high_voltage_systems.disconnect', hv.disconnect ?? undefined);
    pushArray(
      out,
      'high_voltage_systems.cables',
      hv.cables?.map((c) => c.description)
    );
  }
  if (!out['vehicle_layout.components'] && record.pyrotechnic_devices?.devices?.length) {
    pushArray(
      out,
      'pyrotechnic_devices.devices',
      componentStrings(
        record.pyrotechnic_devices.devices.map((d) => ({
          component_class: d.component_class,
          location: d.location,
          evidence_ids: d.evidence_ids,
        }))
      )
    );
  }

  // Drop empty arrays that were pushed with length 0 from map expressions
  for (const [k, field] of Object.entries(out)) {
    if (Array.isArray(field.value) && field.value.length === 0) {
      delete out[k];
    }
  }

  return out;
}

export function projectedPaths(record: RescueSheetV1): string[] {
  return Object.keys(project(record));
}

export function projectionToGoldenExtraction(proj: Projection): Record<string, ProjectedField> {
  return proj;
}

export function goldenProjection(record: RescueSheetV1): GoldenDataset {
  const proj = project(record);
  const golden_extraction: GoldenExtraction = {};
  for (const [path, field] of Object.entries(proj)) {
    golden_extraction[path] = { value: field.value };
  }
  return { golden_extraction };
}

export function evidenceById(record: RescueSheetV1): Map<string, Evidence> {
  const m = new Map<string, Evidence>();
  for (const e of record.evidence ?? []) m.set(e.evidence_id, e);
  return m;
}
