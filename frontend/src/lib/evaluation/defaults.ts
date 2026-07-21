import type { FieldEvalConfig, ListMode, MatchStrategy, OptimizationPriority } from './types';

/** Fallback when no smart rule matches. */
export const DEFAULT_FIELD_CONFIG: FieldEvalConfig = {
  matchStrategy: 'partial',
  listMode: 'set',
  priority: 'recall',
};

interface Rule {
  test: (key: string) => boolean;
  matchStrategy?: MatchStrategy;
  listMode?: ListMode;
  priority?: OptimizationPriority;
}

const RULES: Rule[] = [
  // Ordered procedures — sequence is part of truth.
  {
    test: (k) => k.endsWith('.ordered_steps') || k.endsWith('ordered_steps'),
    listMode: 'sequence',
    matchStrategy: 'exact',
    priority: 'recall',
  },
  // Warnings inventory — set of hazards; order secondary.
  {
    test: (k) => k === 'warnings' || k.endsWith('.warnings'),
    listMode: 'set',
    matchStrategy: 'partial',
    priority: 'recall',
  },
  // Prohibitions — inventing is costly.
  {
    test: (k) =>
      k.includes('prohibition') ||
      k.includes('prohibited_') ||
      k.endsWith('.prohibitions') ||
      k.endsWith('.prohibited_methods') ||
      k.endsWith('.prohibited_actions'),
    listMode: 'set',
    matchStrategy: 'partial',
    priority: 'precision',
  },
  // Identity / enum-like scalars.
  {
    test: (k) =>
      k === 'vehicle.manufacturer' ||
      k === 'vehicle.model' ||
      k === 'vehicle.model_year' ||
      k === 'vehicle.model_year_start' ||
      k === 'vehicle.body_style' ||
      k === 'vehicle.door_count' ||
      k === 'vehicle.seating_capacity' ||
      k.endsWith('.primary_energy_source') ||
      k.endsWith('.drivetrain'),
    matchStrategy: 'exact',
    priority: 'precision',
  },
  // Layout / inventory bags.
  {
    test: (k) =>
      k.includes('vehicle_layout') ||
      k.includes('lift_areas') ||
      k.includes('stabilization_points') ||
      k.includes('no_contact_zones') ||
      k.includes('structural_zones') ||
      k.includes('glazing') ||
      k.includes('high_voltage') ||
      k.includes('low_voltage') ||
      k.includes('stored_energy') ||
      k.includes('components') ||
      k.includes('fluids') ||
      k.includes('cables') ||
      k.includes('pyrotechnic'),
    listMode: 'set',
    matchStrategy: 'partial',
    priority: 'recall',
  },
];

/**
 * Resolve smart defaults for a field path. Scalars ignore listMode in the
 * evaluator; it is still set so the UI can show a stable config object.
 */
export function defaultConfigForField(fieldKey: string): FieldEvalConfig {
  let matchStrategy: MatchStrategy = DEFAULT_FIELD_CONFIG.matchStrategy;
  let listMode: ListMode = DEFAULT_FIELD_CONFIG.listMode;
  let priority: OptimizationPriority = DEFAULT_FIELD_CONFIG.priority;

  for (const rule of RULES) {
    if (!rule.test(fieldKey)) continue;
    if (rule.matchStrategy) matchStrategy = rule.matchStrategy;
    if (rule.listMode) listMode = rule.listMode;
    if (rule.priority) priority = rule.priority;
    // First matching rule wins for specificity order in RULES.
    break;
  }

  return { matchStrategy, listMode, priority };
}

/** Merge a partial user override onto smart defaults. */
export function resolveFieldConfig(
  fieldKey: string,
  override?: Partial<FieldEvalConfig> | null
): FieldEvalConfig {
  const base = defaultConfigForField(fieldKey);
  if (!override) return base;
  return {
    matchStrategy: override.matchStrategy ?? base.matchStrategy,
    listMode: override.listMode ?? base.listMode,
    priority: override.priority ?? base.priority,
  };
}
