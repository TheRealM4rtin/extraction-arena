import { create } from 'zustand';
import {
  type DatasetMeta,
  type DatasetRecord,
  type GoldenDataset,
  type GoldenValue,
  buildExtractionPrompt,
  expectedKinds,
} from './lib/dataset';
import {
  deleteDataset,
  deepMerge,
  listDatasets,
  loadDataset,
  saveDataset,
  updateDataset,
} from './lib/db';
import { type DoclingDocumentPayload, type ModelResult, type PageImage } from './lib/api';
import { NOT_FOUND } from './lib/dataset';

export type ConvertStatus = 'idle' | 'converting' | 'ready' | 'error';

export interface DoclingResult {
  rawText: string;
  extracted: Record<string, GoldenValue>;
  document: DoclingDocumentPayload | null;
  model: string;
  elapsedMs: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
}

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

  // Model results (re-scored against the active dataset's golden)
  glm: ModelResult;
  gpt: ModelResult;
  docling: DoclingResult;

  // Catalog actions
  loadCatalog: () => Promise<void>;
  createDataset: (input: {
    name: string;
    pdfName: string;
    dpi: number;
    pages: PageImage[];
    golden: GoldenDataset;
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

  // Results
  setGlm: (r: ModelResult) => void;
  setGpt: (r: ModelResult) => void;
  setDocling: (r: Partial<DoclingResult>) => void;
  resetResults: () => void;
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

const idleDocling: DoclingResult = {
  rawText: '',
  extracted: {},
  document: null,
  model: '',
  elapsedMs: 0,
  status: 'idle',
};

export const useAppStore = create<AppState>((set, get) => ({
  datasets: [],
  catalogLoading: false,
  active: null,

  zaiKey: import.meta.env.VITE_ZAI_API_KEY ?? '',
  openaiKey: import.meta.env.VITE_OPENAI_API_KEY ?? '',

  customContexts: {},

  glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
  gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
  docling: { ...idleDocling },

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
    const record: DatasetRecord = {
      id,
      name: input.name.trim() || 'Untitled dataset',
      pdfName: input.pdfName,
      dpi: input.dpi,
      pageCount: input.pages.length,
      fieldCount: Object.keys(input.golden.golden_extraction).length,
      createdAt: Date.now(),
      pages: input.pages,
      golden: input.golden,
    };
    await saveDataset(record);
    await get().loadCatalog();
    await get().selectDataset(id);
    return id;
  },

  removeDataset: async (id) => {
    await deleteDataset(id);
    set((s) => {
      const { [id]: _omit, ...rest } = s.customContexts;
      return {
        active: s.active?.id === id ? null : s.active,
        customContexts: rest,
      };
    });
    await get().loadCatalog();
  },

  selectDataset: async (id) => {
    const record = await loadDataset(id);
    set({
      active: record ?? null,
      glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
      gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
      docling: { ...idleDocling },
    });
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

  setGlm: (glm) => set({ glm }),
  setGpt: (gpt) => set({ gpt }),
  setDocling: (patch) => set((s) => ({ docling: { ...s.docling, ...patch } })),
  resetResults: () =>
    set({
      glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
      gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
      docling: { ...idleDocling },
    }),
}));

/** Convenience selectors derived from the active dataset. */
export function useActivePrompt(): string | null {
  const active = useAppStore((s) => s.active);
  const customContexts = useAppStore((s) => s.customContexts);
  if (!active) return null;
  const ctx = customContexts[active.id] ?? active.pdfName;
  return buildExtractionPrompt(active.golden, ctx);
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
  return active ? expectedKinds(active.golden) : {};
}

export { NOT_FOUND };
