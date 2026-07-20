import type { PrimaryEnergySource } from './schema';

/** Normalize free-form energy labels to the closed scoring vocabulary. */
export function normalizeEnergySource(raw: unknown): PrimaryEnergySource {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'other';
  if (s === 'battery_electric' || s === 'bev') return 'battery_electric';
  if (s === 'electricity' || s === 'electric' || s === 'ev') return 'battery_electric';
  if (s.includes('plug') || s === 'phev') return 'plug_in_hybrid_electric';
  if (s === 'hybrid' || s === 'hev' || s.includes('hybrid')) return 'hybrid_electric';
  if (s.includes('gasoline') || s.includes('petrol')) return 'gasoline';
  if (s.includes('diesel')) return 'diesel';
  if (s.includes('hydrogen') || s.includes('fuel_cell') || s.includes('fuel-cell')) {
    return 'hydrogen_fuel_cell';
  }
  if (s.includes('cng') || s.includes('natural gas')) return 'compressed_natural_gas';
  if (
    (
      [
        'battery_electric',
        'plug_in_hybrid_electric',
        'hybrid_electric',
        'gasoline',
        'diesel',
        'hydrogen_fuel_cell',
        'compressed_natural_gas',
        'other',
      ] as string[]
    ).includes(s)
  ) {
    return s as PrimaryEnergySource;
  }
  return 'other';
}
