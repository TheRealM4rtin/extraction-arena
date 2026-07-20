import type { RescueSheetV1 } from './schema';
import { SCHEMA_VERSION } from './schema';

/**
 * Vision-model extraction prompt for the rich v1.1 contract.
 *
 * Policy (product decision): ALWAYS send the full empty nested schema —
 * never gold-gated field lists, never golden values, never field-by-field
 * multi-calls. Scoring still compares only paths present on the gold
 * projection; extra model leaves are ignored by the scorer.
 */

/** Full empty nested skeleton matching rescue-sheet-ev-v1.1 domain body. */
export const EMPTY_RICH_SKELETON = {
  vehicle: {
    manufacturer: '<string>',
    model: '<string>',
    model_year_start: '<integer or null>',
    model_year_end: '<integer or null>',
    vehicle_class: '<string>',
    body_style: '<string>',
    door_count: '<integer>',
    seating_capacity: '<integer>',
    propulsion: {
      primary_energy_source:
        '<one of: battery_electric, plug_in_hybrid_electric, hybrid_electric, gasoline, diesel, hydrogen_fuel_cell, compressed_natural_gas, other — use battery_electric for pure EV / "electricity">',
      high_voltage_systems: [
        {
          nominal_voltage_v: '<number>',
          chemistry: '<string>',
          component_type: '<string>',
          source_text: '<verbatim quote or null>',
        },
      ],
      low_voltage_systems: [
        {
          nominal_voltage_v: '<number>',
          chemistry: '<string>',
          component_type: '<string>',
          source_text: '<verbatim quote or null>',
        },
      ],
    },
  },
  responder_information: {
    identification_recognition: {
      vehicle_recognition: {
        exterior_model_badge_note: '<string>',
        tri_motor_identifier_note: '<string>',
      },
      silent_vehicle_warning: {
        hazard_type: '<string>',
        source_text: '<verbatim quote>',
      },
    },
    immobilization: {
      ordered_steps: [
        { step_number: 1, action: '<snake_or_short_action_id>', source_text: '<verbatim>' },
      ],
    },
    stabilization_lifting: {
      lift_areas: [{ color_code: '<string>', meaning: '<string>' }],
      stabilization_points: [{ color_code: '<string>', meaning: '<string>' }],
      no_contact_zones: [
        { color_code: '<string>', component_class: '<string>', source_text: '<verbatim>' },
      ],
    },
    disable_direct_hazards: {
      ordered_steps: [
        {
          step_number: 1,
          action: '<snake_or_short_action_id>',
          condition: '<optional string>',
          source_text: '<verbatim>',
        },
      ],
      first_responder_loop: { action: '<string>', source_text: '<verbatim>' },
      low_voltage_isolation: {
        battery_voltage_v: '<number>',
        action: '<string>',
        condition: '<string>',
      },
      high_voltage_isolation: {
        warning: '<string>',
        prohibited_action: '<string>',
        ppe_required: '<boolean>',
        source_text: '<verbatim>',
      },
    },
    occupant_access: {
      access_methods: [
        {
          access_target: '<string>',
          access_direction: '<string>',
          power_state: '<string>',
          procedure_availability: '<string>',
          action: '<optional>',
          source_text: '<verbatim>',
          ordered_steps: [
            { step_number: 1, action: '<string>', source_text: '<verbatim>' },
          ],
        },
      ],
      extrication_constraints: [{ hazard_type: '<string>', source_text: '<verbatim>' }],
    },
    stored_energy_fluids_gases_solids: {
      energy_sources: [
        {
          component_class: '<string>',
          nominal_voltage_v: '<number>',
          chemistry: '<string>',
          energy_type: '<string>',
          source_text: '<verbatim>',
        },
      ],
      high_voltage_cables: [
        {
          cable_type: '<string>',
          insulation_color: '<string>',
          source_text: '<verbatim>',
        },
      ],
      fluids: [{ fluid_type: '<string>', color: ['<string>'], source_text: '<verbatim>' }],
      pyrotechnic_devices: [
        { component_class: '<string>', presence_indicated_by: '<string>' },
      ],
      prohibited_actions: [{ action: '<string>', source_text: '<verbatim>' }],
    },
    fire: {
      prohibitions: [{ action: '<string>', source_text: '<verbatim>' }],
      suppression_cooling_actions: [
        {
          action: '<string>',
          target: '<string>',
          application_direction: '<string>',
          source_text: '<verbatim>',
        },
      ],
      monitoring_requirements: [
        {
          parameter: '<string>',
          minimum_duration_hours: '<number>',
          source_text: '<verbatim>',
        },
      ],
      reignition_risk: { risk_present: '<boolean>', source_text: '<verbatim>' },
    },
    submersion: {
      ordered_steps: [
        {
          step_number: 1,
          action: '<string>',
          lift_height_cm: '<number optional>',
          source_equivalent_imperial: '<string optional>',
        },
      ],
      drainage_lift_requirement: {
        vehicle_end_to_raise: '<string>',
        approximate_lift_height_cm: '<number>',
        source_equivalent_imperial: '<string>',
        purpose: '<string>',
      },
      hazard_note: '<string>',
    },
    towing_transport_storage: {
      transport_method: { required_method: '<string>', source_text: '<verbatim>' },
      prohibited_methods: [{ action: '<string>', source_text: '<verbatim>' }],
      pre_transport_checks: [{ parameter: '<string>', source_text: '<verbatim>' }],
      post_incident_storage: {
        applies_after: '<string>',
        storage_location: '<string>',
        minimum_separation_m: '<number>',
        source_equivalent_imperial: '<string>',
        separate_from: ['<string>'],
        hazard_note: '<string>',
      },
    },
  },
  vehicle_layout: {
    components: [
      {
        component_class: '<string>',
        system: '<string optional>',
        location_descriptor: '<textual location, no coordinates>',
        diagram_views: ['<string>'],
        location_confidence: '<string>',
        note: '<optional>',
      },
    ],
    structural_zones: [
      {
        zone_class: '<string>',
        location_descriptor: '<string>',
        source_text: '<verbatim>',
      },
    ],
    glazing: [
      {
        glazing_locations: ['<string>'],
        glazing_type: '<string>',
        source_text: '<verbatim>',
      },
    ],
  },
  warnings: [
    {
      warning_id: '<stable_id>',
      procedure_phase: '<string>',
      hazard_type: '<string>',
      source_text: '<verbatim>',
    },
  ],
} as const;

/**
 * Build the vision extraction prompt. `record` is accepted for API stability
 * but does NOT gate the field list — the full empty skeleton is always used.
 */
export function buildCanonicalPrompt(_record: RescueSheetV1, documentContext = ''): string {
  const ctx = documentContext.trim();
  const contextClause = ctx ? `The document is: ${ctx}.` : '';
  const skeleton = JSON.stringify(EMPTY_RICH_SKELETON, null, 2);

  return `You are a rescue-sheet data-extraction engine. ${contextClause} Analyze the provided rescue-sheet images and return a single valid JSON object matching schema "${SCHEMA_VERSION}".

Return ONLY the domain body below (do not invent envelope fields like record_id, lifecycle_status, review, or evidence — those are stamped server-side). Fill every leaf you can support from the images; use the exact nested structure.

Empty nested skeleton (placeholders only — replace with real extracted values; never copy placeholder angle-bracket text into the output):
${skeleton}

Rules:
- Extract ONLY what is explicitly visible in the document (text or clear diagram labels). Do not infer or hallucinate.
- Absent scalar leaf → "not_found" (or null when the schema example uses null). Absent array leaf → [].
- Prefer snake_case action ids for ordered_steps.action when the sheet uses short labels; keep source_text as the verbatim printed phrase when present.
- primary_energy_source for a pure battery EV should be "battery_electric" (not free-form "electricity").
- Locations are textual (location_descriptor). Never invent pixel coordinates or bounding boxes.
- Order matters: return array entries in EXACT document order (top-to-bottom, left-to-right). Number ordered_steps 1, 2, 3… in document sequence.
- Casing matters: preserve EXACT source capitalization in source_text fields.
- Preserve exact wording, spelling, and punctuation in source_text.
- Return ONLY valid JSON with no markdown fences and no commentary.`;
}
