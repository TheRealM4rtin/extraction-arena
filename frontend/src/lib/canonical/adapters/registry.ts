import type { RescueSheetAdapter, SourceContext, NormalizeResult } from './types';
import { TeslaRescueSheetAdapter } from './tesla';

/**
 * Adapter registry. Per the architecture decision this holds a SINGLE adapter
 * (Tesla). Vision-model output does NOT go through the registry — it uses the
 * built-in `normalizeVlmToDraft()` in `../vlm.ts`.
 *
 * Adding a future OEM adapter = append it to this array + implement the
 * `RescueSheetAdapter` interface. Nothing else in the app changes.
 */
export const ADAPTERS: RescueSheetAdapter[] = [TeslaRescueSheetAdapter];

/** Find the first adapter that recognizes the source, or null. */
export function pickAdapter(input: unknown): RescueSheetAdapter | null {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.canHandle(input)) return adapter;
    } catch {
      // A throwing canHandle must never crash ingestion.
    }
  }
  return null;
}

/** Normalize via the registry; returns null when no adapter recognizes input. */
export function normalizeWithAdapter(
  input: unknown,
  context: SourceContext
): NormalizeResult | null {
  const adapter = pickAdapter(input);
  if (!adapter) return null;
  return adapter.normalize(input, context);
}

export { TeslaRescueSheetAdapter };
