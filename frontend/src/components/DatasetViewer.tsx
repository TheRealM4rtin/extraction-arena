import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Database, Maximize2, X } from 'lucide-react';
import { JsonTree } from '@/components/dataset-viewer/JsonTree';
import { useAppStore } from '@/store';
import { buildNestedPatch, type DatasetRecord } from '@/lib/dataset';

const ACCENT = '#10B981';

/**
 * Sidebar Dataset Viewer. Renders as a compact metadata panel that fills
 * the remaining sidebar height below Datasets + Pages. Hovering reveals an
 * "Open fullscreen" pill (same pattern as PageViewer); clicking opens a
 * scrollable modal with the full Metadata + Golden tree (editable, same
 * design as the previous collapsible band).
 */
export function DatasetViewer() {
  const active = useAppStore((s) => s.active);
  const updateActiveDataset = useAppStore((s) => s.updateActiveDataset);
  const [fullscreen, setFullscreen] = useState(false);

  // Lock body scroll while the fullscreen modal is open.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // Escape closes the modal.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const metaEditable = useMemo(() => new Set<string>(['name']), []);
  const goldenEditable = useMemo(() => {
    const set = new Set<string>();
    if (active) {
      for (const key of Object.keys(active.golden.golden_extraction)) {
        set.add(`golden_extraction.${key}.value`);
        set.add(`golden_extraction.${key}.difficulty`);
        set.add(`golden_extraction.${key}.source`);
      }
    }
    return set;
  }, [active]);

  if (!active) return null;

  const meta = {
    name: active.name,
    pdfName: active.pdfName,
    dpi: active.dpi,
    pageCount: active.pageCount,
    fieldCount: active.fieldCount,
    createdAt: new Date(active.createdAt).toISOString(),
  };
  const goldenView = {
    golden_extraction: active.golden.golden_extraction,
    ...(active.golden.model_evaluation_hints
      ? { model_evaluation_hints: active.golden.model_evaluation_hints }
      : {}),
    ...(active.golden.reasoning_log ? { reasoning_log: active.golden.reasoning_log } : {}),
  };

  const saveMeta = (path: string[], value: unknown) =>
    updateActiveDataset(buildNestedPatch(path, value) as Partial<DatasetRecord>);
  const saveGolden = (path: string[], value: unknown) =>
    updateActiveDataset(buildNestedPatch(['golden', ...path], value) as Partial<DatasetRecord>);

  return (
    <>
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        title="Open dataset viewer in fullscreen"
        className="group relative flex w-full flex-col overflow-hidden rounded-2xl glass text-left transition-colors hover:border-gt/60 lg:min-h-0 lg:flex-1"
        style={{ borderColor: `${ACCENT}40` }}
      >
        <div
          className="flex shrink-0 items-center gap-2 rounded-t-2xl px-3 py-3"
          style={{ background: `${ACCENT}14` }}
        >
          <Database className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: ACCENT }}>
            Dataset Viewer
          </h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {active.fieldCount}f · {active.pageCount}p
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <CompactMetadata meta={meta} />
        </div>

        {/* Hover overlay (matches PageViewer pattern) */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-lg">
            <Maximize2 className="h-3.5 w-3.5" />
            Open fullscreen
          </span>
        </span>
      </button>

      <DatasetFullscreenModal
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        meta={meta}
        goldenView={goldenView}
        metaEditable={metaEditable}
        goldenEditable={goldenEditable}
        onSaveMeta={saveMeta}
        onSaveGolden={saveGolden}
        datasetName={active.name}
      />
    </>
  );
}

/** Compact key/value list for the sidebar panel (read-only). */
function CompactMetadata({ meta }: { meta: Record<string, string | number> }) {
  const entries = Object.entries(meta);
  return (
    <dl className="flex flex-col gap-px">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline gap-2 border-b border-border/30 py-1 last:border-b-0"
        >
          <dt className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {k}
          </dt>
          <dd className="min-w-0 flex-1 truncate text-right font-mono text-xs text-foreground">
            {String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface DatasetFullscreenModalProps {
  open: boolean;
  onClose: () => void;
  meta: Record<string, unknown>;
  goldenView: Record<string, unknown>;
  metaEditable: Set<string>;
  goldenEditable: Set<string>;
  onSaveMeta: (path: string[], value: unknown) => Promise<void>;
  onSaveGolden: (path: string[], value: unknown) => Promise<void>;
  datasetName: string;
}

function DatasetFullscreenModal({
  open,
  onClose,
  meta,
  goldenView,
  metaEditable,
  goldenEditable,
  onSaveMeta,
  onSaveGolden,
  datasetName,
}: DatasetFullscreenModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 p-4 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Dataset viewer: ${datasetName}`}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="glass flex max-h-[88vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl"
            style={{ borderColor: `${ACCENT}40` }}
          >
            {/* Top bar */}
            <div
              className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"
              style={{ background: `${ACCENT}14` }}
            >
              <Database className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: ACCENT }}>
                Dataset Viewer
              </h2>
              <span className="truncate font-mono text-xs text-muted-foreground">{datasetName}</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dataset viewer"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-gt/20 hover:text-gt"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
                <section className="flex flex-col gap-2">
                  <SectionLabel title="Metadata" subtitle="Dataset record" />
                  <JsonTree data={meta} accent={ACCENT} editablePaths={metaEditable} onSave={onSaveMeta} />
                </section>
                <section className="flex min-w-0 flex-col gap-2">
                  <SectionLabel title="Golden dataset" subtitle="Extraction ground truth · editable" />
                  <JsonTree data={goldenView} accent={ACCENT} editablePaths={goldenEditable} onSave={onSaveGolden} />
                </section>
              </div>
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                Hover a row and click the pencil to edit. Changes persist to your browser (IndexedDB) and survive a refresh.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SectionLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</h4>
      <span className="text-[10px] text-muted-foreground">{subtitle}</span>
    </div>
  );
}
