import { create } from 'zustand';
import {
  type DatasetMeta,
  type DatasetRecord,
  type GoldenDataset,
  type GoldenValue,
  buildExtractionPrompt,
  expectedKinds,
} from './lib/dataset';
import { deleteDataset, listDatasets, loadDataset, saveDataset } from './lib/db';
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

  // Model results (re-scored against the active dataset's golden)
  glm: ModelResult;
  gpt: ModelResult;
  docling: DoclingResult;

  // UI
  recordingMode: boolean;

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

  // Keys / UI
  setZaiKey: (k: string) => void;
  setOpenaiKey: (k: string) => void;
  setRecordingMode: (on: boolean) => void;

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

  glm: idleModel('glm-5v-turbo', 'GLM-5V-Turbo'),
  gpt: idleModel('gpt-5.4-mini', 'GPT-5.4 mini'),
  docling: { ...idleDocling },

  recordingMode: false,

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
    if (get().active?.id === id) set({ active: null });
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

  setZaiKey: (zaiKey) => set({ zaiKey }),
  setOpenaiKey: (openaiKey) => set({ openaiKey }),
  setRecordingMode: (recordingMode) => set({ recordingMode }),

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
  return active ? buildExtractionPrompt(active.golden) : null;
}

export function useActiveKinds(): Record<string, import('./lib/dataset').ValueKind> {
  const active = useAppStore((s) => s.active);
  return active ? expectedKinds(active.golden) : {};
}

export { NOT_FOUND };
