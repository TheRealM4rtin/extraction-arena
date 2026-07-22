import type { RescueSheetV1 } from './schema';
import { SCHEMA_VERSION } from './schema';

/**
 * Structurally-valid rescue-sheet-ev-v1.1 fixture grounded in the Tesla
 * Cybertruck first-responder sheet (rich ISO-style domain body + app envelope).
 */
export const CYBERTRUCK_EXAMPLE: RescueSheetV1 = {
  schema_version: SCHEMA_VERSION,
  record_id: 'rs_tesla_cybertruck_2023_v02',
  lifecycle_status: 'reviewed',
  review: {
    review_required: true,
    review_status: 'approved',
    reviewed_by: 'demo',
    reviewed_at: '2026-07-16T16:06:00Z',
  },
  standard_reference: {
    standard_id: 'ISO 17840-1:2022',
    scope: 'passenger_car_or_light_commercial_vehicle_rescue_sheet',
    conformance_status: 'mapping_candidate_not_certified',
  },
  document: {
    document_type: 'rescue_sheet',
    document_id: 'TESLA-2023CA-001',
    document_version: '02',
    sheet_page_count: 4,
    source_pages: [
      { page_id: 'file:1', page_number: 1, sheet_page_number: 1 },
      { page_id: 'file:2', page_number: 2, sheet_page_number: 2 },
      { page_id: 'file:3', page_number: 3, sheet_page_number: 3 },
      { page_id: 'file:4', page_number: 4, sheet_page_number: 4 },
    ],
  },
  vehicle: {
    manufacturer: 'Tesla',
    model: 'Cybertruck',
    model_year_start: 2023,
    model_year_end: null,
    body_style: 'truck',
    door_count: 4,
    seating_capacity: 5,
    propulsion: {
      primary_energy_source: 'battery_electric',
      high_voltage_systems: [
        {
          nominal_voltage_v: 800,
          chemistry: 'lithium_ion',
          component_type: 'traction_battery',
          source_text: '800V Li-Ion',
        },
      ],
      low_voltage_systems: [
        {
          nominal_voltage_v: 48,
          chemistry: 'lithium_ion',
          component_type: 'low_voltage_battery',
          source_text: '48V Li-Ion',
        },
      ],
    },
  },
  responder_information: {
    immobilization: {
      ordered_steps: [
        { step_number: 1, action: 'chock_wheels', source_text: '1. CHOCK WHEELS' },
        { step_number: 2, action: 'place_vehicle_in_park', source_text: '2. PUT VEHICLE INTO PARK POSITION' },
      ],
    },
    disable_direct_hazards: {
      ordered_steps: [
        { step_number: 1, action: 'open_hood', source_text: 'Open the hood.' },
        {
          step_number: 2,
          action: 'double_cut_first_responder_loop',
          source_text: 'Double cut the first responder loop.',
        },
        {
          step_number: 3,
          action: 'double_cut_negative_cable_to_48v_battery',
          condition: 'only_if_necessary',
          source_text: 'Double cut negative cable to the 48V battery only if necessary.',
        },
      ],
      first_responder_loop: {
        action: 'double_cut',
        source_text: 'Always double cut the first responder loop.',
      },
    },
    fire: {
      monitoring_requirements: [
        {
          parameter: 'high_voltage_battery_temperature',
          minimum_duration_hours: 24,
          source_text: 'MONITOR HV BATTERY TEMPERATURE FOR AT LEAST 24 HOURS',
        },
      ],
      reignition_risk: {
        risk_present: true,
        source_text: 'POSSIBLE BATTERY RE-IGNITION!',
      },
    },
    submersion: {
      ordered_steps: [
        { step_number: 1, action: 'wear_appropriate_ppe_for_water_rescue' },
        { step_number: 2, action: 'remove_vehicle_from_water' },
        { step_number: 3, action: 'continue_normal_high_voltage_disabling' },
        {
          step_number: 4,
          action: 'raise_front_of_vehicle_to_drain_vehicle_and_battery_pack',
          lift_height_cm: 30,
        },
        { step_number: 5, action: 'store_vehicle_flat' },
      ],
    },
    towing_transport_storage: {
      transport_method: {
        required_method: 'flatbed_towing_truck',
        source_text: 'Use a towing truck with flatbed.',
      },
    },
  },
  vehicle_layout: {
    components: [
      {
        component_class: 'high_voltage_battery',
        location_descriptor: 'central_underfloor_area',
        location_confidence: 'direct_diagram_representation',
      },
      {
        component_class: 'gas_strut',
        location_descriptor: 'multiple_diagram-marked_positions',
        location_confidence: 'direct_diagram_representation',
      },
    ],
  },
  warnings: [
    {
      warning_id: 'battery_reignition',
      procedure_phase: 'fire',
      hazard_type: 'reignition',
      source_text: 'POSSIBLE BATTERY RE-IGNITION!',
    },
  ],
  evidence: [],
  provenance: {
    source_type: 'manual_authoring',
    source_format: 'tesla_cybertruck_golden',
    received_at: '2026-07-16T16:06:00Z',
  },
};
