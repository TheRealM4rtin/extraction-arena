import { create } from 'zustand';
import { type DatasetMeta, type DatasetRecord, NOT_FOUND } from './lib/dataset';
import { buildCanonicalPrompt } from './lib/canonical/prompt';
import { ingestToCanonical } from './lib/canonical/ingest';
import {
  deleteDataset,
  deepMerge,
  listDatasets,
  loadDataset,
  saveDataset,
  updateDataset,
} from './lib/db';
import { type ModelResult, type PageImage } from './lib/api';
import { type FieldEvalConfig, resolveFieldConfig } from './lib/metrics';

export type ConvertStatus = 'idle' | 'converting' | 'ready' | 'error';

/** Model keys that participate in the comparison (Ground Truth has no toggle). */
export type ModelKey = 'glm' | 'gpt';

/**
 * All comparable column keys (Ground Truth + the two models). The default
 * render order is fixed (see DEFAULT_COLUMN_ORDER) but the user can drag-and-drop
 * to reorder for the duration of the session.
 */
export type ColumnKey = 'gt' | ModelKey;

/** Canonical default order: Ground Truth · GLM · GPT. */
export const DEFAULT_COLUMN_ORDER: ColumnKey[] = ['gt', 'glm', 'gpt'];

interface AppState {
  // Dataset catalog
  datasets: DatasetMeta[];
  catalogLoading: boolean;
  active: DatasetRecord | null;

  // API keys (seeded from VITE_ env, editable from settings)
  zaiKey: string;
  openaiKey: string;

  // Per-dataset custom prompt context (keyed by dataset id). When unset for
  // the active dataset, the prompt falls back to the dataset's PDF filename.
  customContexts: Record<string, string>;

  /**
   * Per-dataset, per-field evaluation config overrides (match strategy, list
   * mode, priority). Keyed by dataset id, then field key. Mirrored from
   * `active.fieldEvalConfigs` and persisted with the dataset on edit.
   */
  metricConfigs: Record<string, Record<string, Partial<FieldEvalConfig>>>;

  // Model results (re-scored against the active dataset's golden)
  glm: ModelResult;
  gpt: ModelResult;

  /**
   * Per-model enabled flag. All models default to OFF — the user must
   * explicitly toggle on the models they want to run for a comparison.
   * Ground Truth has no toggle (always shown).
   */
  enabledModels: Record<ModelKey, boolean>;

  /**
   * Current display order of the comparison columns (session-scoped, in-memory).
   * Defaults to DEFAULT_COLUMN_ORDER and is mutated only by drag-and-drop
   * reordering in the ComparisonGrid.
   */
  columnOrder: ColumnKey[];
  setColumnOrder: (order: ColumnKey[]) => void;

  /**
   * Per-field refcount of how many model columns currently have that field's
   * diff pane open. A Ground Truth cell stays highlighted while its refcount
   * is > 0 and resets to neutral once the last column closes the pane.
   */
  openFieldRefs: Record<string, number>;
  /**
   * The field most recently opened (refcount transitioned 0 → 1) plus a nonce
   * that bumps on every such transition. GoldenColumn watches the nonce to
   * scroll the matching Ground Truth cell into view when a pane is opened.
   */
  expandedField: { key: string | null; nonce: number };
  /** Register that a field's diff pane was opened (true) or closed (false). */
  setFieldOpen: (key: string, open: boolean) => void;

  // Catalog actions
  loadCatalog: () => Promise<void>;
  createDataset: (input: {
    name: string;
    pdfName: string;
    dpi: number;
    pages: PageImage[];
    rawJson: unknown;
  }) => Promise<string>;
  removeDataset: (id: string) => Promise<void>;
  selectDataset: (id: string) => Promise<void>;
  clearActive: () => void;

  /** Apply a deep partial patch to the active dataset and persist it. */
  updateActiveDataset: (patch: Partial<DatasetRecord>) => Promise<void>;

  // Keys / UI
  setZaiKey: (k: string) => void;
  setOpenaiKey: (k: string) => void;

  /** Set the prompt context for the active dataset (persisted in-memory only). */
  setDocumentContext: (value: string) => void;

  /** Patch the evaluation config for one field of the active dataset (persisted). */
  setFieldMetricConfig: (
    fieldKey: string,
    patch: Partial<FieldEvalConfig>
  ) => void;

  // Results
  setGlm: (r: ModelResult) => void;
  setGpt: (r: ModelResult) => void;
  resetResults: () => void;

  /** Toggle a model column's enabled state (defaults: all off). */
  toggleModel: (key: ModelKey) => void;
}

function idleModel(id: string, label: string): ModelResult {
  return {
    modelId: id,
    label,
    data: {},
    rawText: '',
    elapsedMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    status: 'idle',
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  datasets: [],
  catalogLoading: false,
  active: null,

  zaiKey: import.meta.env.VITE_ZAI_API_KEY ?? '',
  openaiKey: import.meta.env.VITE_OPENAI_API_KEY ?? '',

  customContexts: {},

  metricConfigs: {},

  glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
  gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),

  enabledModels: { glm: false, gpt: false },

  columnOrder: [...DEFAULT_COLUMN_ORDER],
  setColumnOrder: (columnOrder) => set({ columnOrder }),

  openFieldRefs: {},
  expandedField: { key: null, nonce: 0 },
  setFieldOpen: (key, open) =>
    set((s) => {
      const prev = s.openFieldRefs[key] ?? 0;
      const next = Math.max(0, prev + (open ? 1 : -1));
      const openFieldRefs = { ...s.openFieldRefs };
      if (next <= 0) delete openFieldRefs[key];
      else openFieldRefs[key] = next;
      // Only emit a scroll trigger on a fresh open (refcount 0 → 1) so the
      // matching Ground Truth cell scrolls into view once when first revealed.
      if (open && prev === 0) {
        return {
          openFieldRefs,
          expandedField: { key, nonce: s.expandedField.nonce + 1 },
        };
      }
      return { openFieldRefs };
    }),

  loadCatalog: async () => {
    set({ catalogLoading: true });
    try {
      const datasets = await listDatasets();
      set({ datasets });
    } finally {
      set({ catalogLoading: false });
    }
  },

  createDataset: async (input) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ds-${Date.now()}`;
    const ingested = ingestToCanonical({
      rawJson: input.rawJson,
      pages: input.pages,
      pdfName: input.pdfName,
      recordId: id,
      sourceFormat: input.pdfName || 'arbitrary_json',
    });
    const record: DatasetRecord = {
      id,
      name: input.name.trim() || 'Untitled dataset',
      pdfName: input.pdfName,
      dpi: input.dpi,
      pageCount: input.pages.length,
      fieldCount: Object.keys(ingested.golden.golden_extraction).length,
      createdAt: Date.now(),
      pages: input.pages,
      canonical: ingested.canonical,
      golden: ingested.golden,
      rawSource: ingested.rawSource,
    };
    await saveDataset(record);
    await get().loadCatalog();
    await get().selectDataset(id);
    return id;
  },

  removeDataset: async (id) => {
    await deleteDataset(id);
    set((s) => {
      const { [id]: _omitCtx, ...restCtx } = s.customContexts;
      const { [id]: _omitCfg, ...restCfg } = s.metricConfigs;
      return {
        active: s.active?.id === id ? null : s.active,
        customContexts: restCtx,
        metricConfigs: restCfg,
      };
    });
    await get().loadCatalog();
  },

  selectDataset: async (id) => {
    const record = await loadDataset(id);
    set((s) => ({
      active: record ?? null,
      glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
      gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
      // Hydrate in-memory overrides from the persisted dataset record.
      metricConfigs: record
        ? {
            ...s.metricConfigs,
            [id]: { ...(record.fieldEvalConfigs ?? {}) },
          }
        : s.metricConfigs,
    }));
  },

  clearActive: () => set({ active: null }),

  updateActiveDataset: async (patch) => {
    const current = get().active;
    if (!current) throw new Error('No active dataset to update');
    const previous = current;
    // Optimistic: deep-merge locally so the UI updates instantly.
    set({ active: deepMerge(previous, patch) });
    try {
      const merged = await updateDataset(previous.id, patch);
      set({ active: merged });
      // Refresh the sidebar meta (name / fieldCount may have changed).
      await get().loadCatalog();
    } catch (e) {
      // Roll back to the pre-edit snapshot on failure.
      set({ active: previous });
      throw e;
    }
  },

  setZaiKey: (zaiKey) => set({ zaiKey }),
  setOpenaiKey: (openaiKey) => set({ openaiKey }),

  setDocumentContext: (value) => {
    const active = get().active;
    if (!active) return;
    const trimmed = value.trim();
    set((s) => ({
      customContexts: {
        ...s.customContexts,
        [active.id]: trimmed,
      },
    }));
  },

  setFieldMetricConfig: (fieldKey, patch) => {
    const active = get().active;
    if (!active) return;
    const perDs = get().metricConfigs[active.id] ?? {};
    const prev = perDs[fieldKey] ?? {};
    const nextField = { ...prev, ...patch };
    const nextMap = { ...perDs, [fieldKey]: nextField };
    set((s) => ({
      metricConfigs: {
        ...s.metricConfigs,
        [active.id]: nextMap,
      },
      active: s.active
        ? { ...s.active, fieldEvalConfigs: nextMap }
        : s.active,
    }));
    // Persist with the dataset (fire-and-forget; UI already updated).
    void updateDataset(active.id, { fieldEvalConfigs: nextMap }).catch(() => {
      /* keep in-memory state; next select will re-hydrate from disk if save failed */
    });
  },

  setGlm: (glm) => set({ glm }),
  setGpt: (gpt) => set({ gpt }),
  resetResults: () =>
    set({
      glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
      gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
    }),

  toggleModel: (key) =>
    set((s) => ({
      enabledModels: { ...s.enabledModels, [key]: !s.enabledModels[key] },
    })),
}));

/** Convenience selectors derived from the active dataset. */
export function useActivePrompt(): string | null {
  const active = useAppStore((s) => s.active);
  const customContexts = useAppStore((s) => s.customContexts);
  if (!active) return null;
  const ctx = customContexts[active.id] ?? active.pdfName;
  return buildCanonicalPrompt(active.canonical, ctx);
}

/**
 * Effective prompt context for the active dataset: the user-set value if any,
 * otherwise the active PDF filename. Empty string when no dataset is active.
 */
export function useDocumentContext(): { value: string; isCustom: boolean } {
  const active = useAppStore((s) => s.active);
  const customContexts = useAppStore((s) => s.customContexts);
  if (!active) return { value: '', isCustom: false };
  const custom = customContexts[active.id];
  return { value: custom ?? active.pdfName, isCustom: custom !== undefined };
}

export function useActiveKinds(): Record<string, import('./lib/dataset').ValueKind> {
  const active = useAppStore((s) => s.active);
  if (!active) return {};
  const out: Record<string, import('./lib/dataset').ValueKind> = {};
  for (const [key, field] of Object.entries(active.golden.golden_extraction)) {
    const v = field.value;
    out[key] = Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'string';
  }
  return out;
}

/**
 * Resolved evaluation config (smart defaults + user override) for one field
 * of the active dataset. Re-renders when the config or active dataset changes.
 */
export function useFieldMetricConfig(fieldKey: string): FieldEvalConfig {
  const override = useAppStore((s) => {
    const activeId = s.active?.id;
    return activeId ? s.metricConfigs[activeId]?.[fieldKey] : undefined;
  });
  return resolveFieldConfig(fieldKey, override);
}

/** All per-field overrides for the active dataset (for evaluateDataset). */
export function useActiveEvalConfigMap(): Record<string, Partial<FieldEvalConfig>> {
  const activeId = useAppStore((s) => s.active?.id);
  return useAppStore((s) =>
    activeId ? (s.metricConfigs[activeId] ?? {}) : {}
  );
}

export { NOT_FOUND };
