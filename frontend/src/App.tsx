import { useCallback, useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MeshBackground } from '@/components/MeshBackground';
import { Header } from '@/components/Header';
import { PageViewer } from '@/components/PageViewer';
import { ComparisonGrid } from '@/components/ComparisonGrid';
import { BottomDock } from '@/components/BottomDock';
import { SettingsPanel } from '@/components/SettingsPanel';
import { DatasetManager } from '@/components/DatasetManager';
import { CreateDatasetDialog } from '@/components/CreateDatasetDialog';
import { motion } from 'framer-motion';
import { Database } from 'lucide-react';
import { useExtraction } from '@/hooks/useExtraction';
import { useDocling } from '@/hooks/useDocling';
import { useAppStore } from '@/store';
import { scoreDataset } from '@/lib/scoring';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const active = useAppStore((s) => s.active);
  const recordingMode = useAppStore((s) => s.recordingMode);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const resetResults = useAppStore((s) => s.resetResults);

  const extraction = useExtraction();
  const docling = useDocling();

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      await Promise.allSettled([extraction.run(), docling.run()]);
    } finally {
      setRunning(false);
    }
  }, [docling, extraction]);

  const handleReset = useCallback(() => {
    resetResults();
  }, [resetResults]);

  const handleExport = useCallback(() => {
    const state = useAppStore.getState();
    const golden = state.active?.golden;
    if (!golden) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      dataset: state.active?.name,
      dpi: state.active?.dpi,
      golden,
      glm: { ...state.glm, score: scoreDataset(state.glm.data, golden) },
      gpt: { ...state.gpt, score: scoreDataset(state.gpt.data, golden) },
      docling: { ...state.docling, score: scoreDataset(state.docling.extracted, golden) },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.active?.name ?? 'dataset'}-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <MeshBackground />
      <div className={recordingMode ? 'min-h-screen recording-safe' : 'min-h-screen'}>
        <Header onOpenSettings={() => setSettingsOpen(true)} />

        <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-28 pt-4 lg:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
            <DatasetManager onNew={() => setCreateOpen(true)} />
            {active && <PageViewer />}
          </aside>

          <section className="min-w-0 flex-1">
            {active ? (
              <ComparisonGrid />
            ) : (
              <EmptyState onCreate={() => setCreateOpen(true)} />
            )}
          </section>
        </main>

        <BottomDock
          onRun={handleRun}
          onReset={handleReset}
          onExport={handleExport}
          running={running}
          canRun={active !== null}
        />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreateDatasetDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </TooltipProvider>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass flex h-full min-h-[560px] flex-col items-center justify-center gap-4 rounded-2xl p-10 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20">
        <Database className="h-8 w-8 text-cyan-300" />
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-tight">No dataset selected</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Create a dataset by uploading a PDF and its golden extraction JSON. Then run GLM-5V-Turbo, GPT-5.4 mini,
          and a local Docling MLX baseline against it. Everything is saved locally and re-usable after restart.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        + Create dataset
      </button>
    </motion.div>
  );
}
