/**
 * rescue-sheet-ev-v1.1 — the canonical rescue-sheet contract.
 *
 * Domain body mirrors the rich ISO-17840-style gold used for Cybertruck-class
 * first-responder sheets (see fixtures/cybertruck-rich-source.json). Envelope
 * fields (record_id, lifecycle, review, evidence, app provenance) support
 * audit + lifecycle. Arbitrary source JSON must pass through ingest stamping
 * or an adapter / VLM normalizer before scoring.
 *
 * Design constraint: NO coordinates. Evidence is page-level + source text +
 * confidence; locations are textual descriptors, not bounding boxes.
 */

export const SCHEMA_VERSION = 'rescue-sheet-ev-v1.1' as const;
/** Prior simplified contract version — still recognized on migration. */
export const SCHEMA_VERSION_V10 = 'rescue-sheet-ev-v1.0' as const;

export type AdapterId = string;

export type LifecycleStatus =
  | 'raw'
  | 'draft'
  | 'validated'
  | 'reviewed'
  | 'published'
  | 'rejected'
  | 'legacy';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface Review {
  review_required: boolean;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

/**
 * Closed energy enum for models/scoring. Ingest normalizes free-form values
 * such as "electricity" → battery_electric.
 */
export type PrimaryEnergySource =
  | 'battery_electric'
  | 'plug_in_hybrid_electric'
  | 'hybrid_electric'
  | 'gasoline'
  | 'diesel'
  | 'hydrogen_fuel_cell'
  | 'compressed_natural_gas'
  | 'electricity' // accepted on wire; prefer battery_electric after normalize
  | 'other';

export type Drivetrain = 'awd' | 'fwd' | 'rwd' | '4wd' | 'other';

export type ExtractionMethod =
  | 'direct_text'
  | 'diagram_inference'
  | 'inferred'
  | 'manual';

export type VerificationStatus =
  | 'human_verified'
  | 'human_review_required'
  | 'auto_extracted'
  | 'unverified';

// ── Shared building blocks ──────────────────────────────────────────────────

export interface DocumentSourcePage {
  page_id: string;
  page_number: number;
  filename?: string | null;
  /** Rich-gold aliases (ISO-style page mapping). */
  sheet_page_number?: number | null;
  attachment_id?: string | null;
  attachment_filename?: string | null;
  printed_page_number?: string | null;
  content_summary?: string | null;
}

export interface Document {
  document_type: 'rescue_sheet';
  document_id?: string | null;
  document_version?: string | null;
  sheet_page_count?: number | null;
  source_pages: DocumentSourcePage[];
}

export interface Evidence {
  evidence_id: string;
  source_file_id: string;
  sheet_page_number: number;
  source_text?: string | null;
  extraction_method?: ExtractionMethod;
  confidence?: number | null;
  verification_status?: VerificationStatus;
}

export interface OrderedStep {
  step_number: number;
  action: string;
  condition?: string | null;
  source_text?: string | null;
  lift_height_cm?: number | null;
  source_equivalent_imperial?: string | null;
  evidence_ids?: string[];
}

export interface EnergySystemEntry {
  nominal_voltage_v?: number | null;
  chemistry?: string | null;
  component_type?: string | null;
  component_class?: string | null;
  energy_type?: string | null;
  source_text?: string | null;
}

export interface Propulsion {
  primary_energy_source: PrimaryEnergySource | string;
  secondary_energy_sources?: string[];
  drivetrain?: Drivetrain | string | null;
  door_count?: number | null;
  high_voltage_systems?: EnergySystemEntry[] | null;
  low_voltage_systems?: EnergySystemEntry[] | null;
}

export interface Vehicle {
  manufacturer: string;
  model: string;
  model_year?: string | null;
  model_year_start?: number | null;
  model_year_end?: number | null;
  vehicle_class?: string | null;
  body_style?: string | null;
  door_count?: number | null;
  seating_capacity?: number | null;
  propulsion: Propulsion;
}

export interface StandardReference {
  standard_id?: string | null;
  scope?: string | null;
  conformance_status?: string | null;
}

// ── Responder information (rich) ────────────────────────────────────────────

export interface ColorCodedZone {
  color_code?: string | null;
  meaning?: string | null;
  component_class?: string | null;
  source_text?: string | null;
}

export interface AccessMethod {
  access_target?: string | null;
  access_direction?: string | null;
  power_state?: string | null;
  procedure_availability?: string | null;
  action?: string | null;
  source_text?: string | null;
  ordered_steps?: OrderedStep[] | null;
}

export interface ExtricationConstraint {
  hazard_type?: string | null;
  source_text?: string | null;
}

export interface StoredEnergyItem {
  component_class?: string | null;
  nominal_voltage_v?: number | null;
  chemistry?: string | null;
  energy_type?: string | null;
  source_text?: string | null;
  cable_type?: string | null;
  insulation_color?: string | null;
  fluid_type?: string | null;
  color?: string | string[] | null;
  presence_indicated_by?: string | null;
  action?: string | null;
}

export interface FireProhibition {
  action?: string | null;
  source_text?: string | null;
}

export interface FireSuppressionAction {
  action?: string | null;
  target?: string | null;
  application_direction?: string | null;
  source_text?: string | null;
}

export interface FireMonitoringRequirement {
  parameter?: string | null;
  description?: string | null;
  minimum_duration_hours?: number | null;
  source_text?: string | null;
  evidence_ids?: string[];
}

export interface ResponderInformation {
  identification_recognition?: {
    vehicle_recognition?: Record<string, string | null | undefined> | null;
    silent_vehicle_warning?: {
      hazard_type?: string | null;
      source_text?: string | null;
    } | null;
  } | null;
  immobilization?: {
    ordered_steps?: OrderedStep[] | null;
  } | null;
  stabilization_lifting?: {
    lift_areas?: ColorCodedZone[] | null;
    stabilization_points?: ColorCodedZone[] | null;
    no_contact_zones?: ColorCodedZone[] | null;
  } | null;
  disable_direct_hazards?: {
    ordered_steps?: OrderedStep[] | null;
    first_responder_loop?: Record<string, unknown> | null;
    low_voltage_isolation?: Record<string, unknown> | null;
    high_voltage_isolation?: Record<string, unknown> | null;
  } | null;
  occupant_access?: {
    access_methods?: AccessMethod[] | null;
    extrication_constraints?: ExtricationConstraint[] | null;
  } | null;
  stored_energy_fluids_gases_solids?: {
    energy_sources?: StoredEnergyItem[] | null;
    high_voltage_cables?: StoredEnergyItem[] | null;
    fluids?: StoredEnergyItem[] | null;
    pyrotechnic_devices?: StoredEnergyItem[] | null;
    prohibited_actions?: FireProhibition[] | null;
  } | null;
  fire?: {
    prohibitions?: FireProhibition[] | null;
    suppression_cooling_actions?: FireSuppressionAction[] | null;
    monitoring_requirements?: FireMonitoringRequirement[] | null;
    reignition_risk?: {
      risk_present?: boolean | null;
      source_text?: string | null;
    } | null;
    extinguishing_agents?: string[] | null;
  } | null;
  submersion?: {
    ordered_steps?: OrderedStep[] | null;
    drainage_lift_requirement?: Record<string, unknown> | null;
    hazard_note?: string | null;
    guidance?: string[] | null;
  } | null;
  towing_transport_storage?: {
    transport_method?: Record<string, unknown> | null;
    prohibited_methods?: FireProhibition[] | null;
    pre_transport_checks?: Array<Record<string, unknown>> | null;
    post_incident_storage?: Record<string, unknown> | null;
    guidance?: string[] | null;
  } | null;
  /** Legacy v1.0 free-form access strings. */
  access?: string[] | null;
  notes?: string[] | null;
}

// ── Vehicle layout ──────────────────────────────────────────────────────────

export interface LayoutComponent {
  component_class: string;
  system?: string | null;
  location_descriptor?: string | null;
  diagram_views?: string[] | null;
  location_confidence?: string | null;
  note?: string | null;
  /** Legacy v1.0 location object. */
  location?: {
    value: string;
    precision?: 'exact' | 'approximate' | 'non_specific' | string;
    confidence?: number | null;
    verification_status?: VerificationStatus;
  } | null;
  evidence_ids?: string[];
}

export interface StructuralZone {
  zone_class?: string | null;
  location_descriptor?: string | null;
  source_text?: string | null;
}

export interface GlazingEntry {
  glazing_locations?: string[] | null;
  glazing_type?: string | null;
  source_text?: string | null;
}

export interface VehicleLayout {
  components?: LayoutComponent[] | null;
  structural_zones?: StructuralZone[] | null;
  glazing?: GlazingEntry[] | null;
}

export interface WarningEntry {
  warning_id?: string | null;
  procedure_phase?: string | null;
  hazard_type?: string | null;
  source_text?: string | null;
}

// ── Provenance (app audit + OEM dual) ───────────────────────────────────────

export type SourceType =
  | 'vlm_extraction'
  | 'oem_json'
  | 'ocr'
  | 'pdf'
  | 'image'
  | 'manual_authoring'
  | 'legacy_golden';

export type SourceFormat = string;

export interface Provenance {
  source_type?: SourceType | string;
  source_format?: SourceFormat;
  received_at?: string;
  adapter_id?: AdapterId;
  source_document?: Record<string, unknown> | null;
  validation_policy?: Record<string, unknown> | null;
  page_to_attachment_mapping?: Record<string, string> | null;
}

export interface LegacyField {
  value: unknown;
  difficulty?: string | null;
  source?: string | null;
}
export type LegacyFields = Record<string, LegacyField>;

/**
 * Full canonical record (v1.1 rich domain + envelope).
 *
 * Optional top-level sections from the simplified v1.0 contract
 * (`high_voltage_systems`, top-level `fire`, etc.) are retained for
 * migration/adapters but new gold should nest under `responder_information`
 * and `vehicle.propulsion`.
 */
export interface RescueSheetV1 {
  schema_version: typeof SCHEMA_VERSION | typeof SCHEMA_VERSION_V10 | string;
  record_id: string;
  lifecycle_status: LifecycleStatus;
  review: Review;
  document: Document;
  vehicle: Vehicle;
  responder_information: ResponderInformation;
  standard_reference?: StandardReference | null;
  vehicle_layout?: VehicleLayout | null;
  warnings?: WarningEntry[] | null;
  evidence: Evidence[];
  provenance: Provenance;
  legacy_fields?: LegacyFields;

  // ── v1.0 compatibility (optional; prefer rich nesting) ───────────────────
  high_voltage_systems?: {
    present?: boolean | null;
    nominal_voltage_v?: number | null;
    disconnect?: string[] | null;
    cables?: Array<{ description: string; evidence_ids?: string[] }> | null;
  } | null;
  pyrotechnic_devices?: {
    devices?: Array<{
      component_class: string;
      location?: LayoutComponent['location'];
      evidence_ids?: string[];
    }> | null;
  } | null;
  fire?: ResponderInformation['fire'];
  submersion?: ResponderInformation['submersion'];
  towing_transport_storage?: ResponderInformation['towing_transport_storage'];
}

export type RescueSheetV1Draft = RescueSheetV1;
