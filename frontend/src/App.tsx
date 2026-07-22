import { useCallback, useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MeshBackground } from '@/components/MeshBackground';
import { Header } from '@/components/Header';
import { PageViewer } from '@/components/PageViewer';
import { ComparisonGrid } from '@/components/ComparisonGrid';
import { BottomDock } from '@/components/BottomDock';
import { SettingsPanel } from '@/components/SettingsPanel';
import { DatasetManager } from '@/components/DatasetManager';
import { CreateDatasetDialog } from '@/components/CreateDatasetDialog';
import { DatasetViewer } from '@/components/DatasetViewer';
import { PromptContextPanel } from '@/components/PromptContextPanel';
import { MetricsDashboard } from '@/components/metrics-dashboard/MetricsDashboard';
import { motion } from 'framer-motion';
import { Database } from 'lucide-react';
import { useExtraction } from '@/hooks/useExtraction';
import { useAppStore } from '@/store';
import { scoreDataset } from '@/lib/scoring';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const active = useAppStore((s) => s.active);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const resetResults = useAppStore((s) => s.resetResults);
  const enabledModels = useAppStore((s) => s.enabledModels);

  const extraction = useExtraction();

  // Per-run abort controller. Created when a run starts, aborted by the cancel
  // button, and cleared once every spawned call has settled. Holds the in-flight
  // signal so the BottomDock's rotate button can cancel a run in progress.
  const runControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const anyEnabled =
    enabledModels.glm || enabledModels.gpt || enabledModels.grok;

  const handleRun = useCallback(async () => {
    if (!anyEnabled) return;
    // Abort any lingering run first (defensive — shouldn't normally happen).
    runControllerRef.current?.abort();
    const controller = new AbortController();
    runControllerRef.current = controller;
    setRunning(true);
    try {
      await extraction.run(controller.signal);
    } finally {
      setRunning(false);
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
      }
    }
  }, [anyEnabled, extraction]);

  const handleCancel = useCallback(() => {
    runControllerRef.current?.abort();
  }, []);

  const handleReset = useCallback(() => {
    resetResults();
  }, [resetResults]);

  const handleExport = useCallback(() => {
    const state = useAppStore.getState();
    const golden = state.active?.golden;
    if (!golden) return;
    const configMap =
      (state.active && state.metricConfigs[state.active.id]) ||
      state.active?.fieldEvalConfigs ||
      {};
    const payload = {
      generatedAt: new Date().toISOString(),
      dataset: state.active?.name,
      dpi: state.active?.dpi,
      golden,
      glm: { ...state.glm, score: scoreDataset(state.glm.data, golden, configMap) },
      gpt: { ...state.gpt, score: scoreDataset(state.gpt.data, golden, configMap) },
      grok: { ...state.grok, score: scoreDataset(state.grok.data, golden, configMap) },
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
      <div className="min-h-screen">
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenMetrics={() => setMetricsOpen(true)}
        />

        <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-28 pt-4 lg:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
            <DatasetManager onNew={() => setCreateOpen(true)} />
            {active && <PromptContextPanel />}
            {active && <PageViewer />}
            {active && <DatasetViewer />}
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
          onCancel={handleCancel}
          onExport={handleExport}
          running={running}
          canRun={active !== null && anyEnabled}
        />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreateDatasetDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <MetricsDashboard open={metricsOpen} onClose={() => setMetricsOpen(false)} />
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
          Create a dataset by uploading a PDF and its golden extraction JSON. Then run GLM-5V-Turbo,
          GPT-5.4 mini, and Grok 4.5 against it. Everything is saved locally and re-usable after restart.
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
