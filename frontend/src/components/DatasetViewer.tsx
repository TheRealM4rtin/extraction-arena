import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Database } from 'lucide-react';
import { JsonTree } from '@/components/dataset-viewer/JsonTree';
import { useAppStore } from '@/store';
import { buildNestedPatch, type DatasetRecord } from '@/lib/dataset';
import { cn } from '@/lib/utils';

/**
 * Dataset Viewer (parent issue #9). A collapsible section below the main
 * content that renders the active dataset as a styled key-value tree
 * (sub-issue #10/#11) with inline editing that persists to IndexedDB
 * (sub-issue #12).
 */
export function DatasetViewer() {
  const active = useAppStore((s) => s.active);
  const updateActiveDataset = useAppStore((s) => s.updateActiveDataset);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

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
    model_evaluation_hints: active.golden.model_evaluation_hints,
    reasoning_log: active.golden.reasoning_log,
  };

  const saveMeta = (path: string[], value: unknown) =>
    updateActiveDataset(buildNestedPatch(path, value) as Partial<DatasetRecord>);
  const saveGolden = (path: string[], value: unknown) =>
    updateActiveDataset(buildNestedPatch(['golden', ...path], value) as Partial<DatasetRecord>);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-6">
      <div className="glass overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="dataset-viewer-body"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background/40"
        >
          <Database className="h-4 w-4 shrink-0 text-gt" />
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-sm font-bold">Dataset Viewer</span>
            <span className="truncate text-xs text-muted-foreground">
              {active.name} · {active.fieldCount} fields · {active.pageCount} pages · {active.dpi} DPI
            </span>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
              open ? 'bg-gt/15 text-gt' : 'bg-muted text-muted-foreground',
            )}
          >
            {open ? 'Open' : 'Collapsed'}
          </span>
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id="dataset-viewer-body"
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
                <section className="flex flex-col gap-2">
                  <SectionLabel title="Metadata" subtitle="Dataset record" />
                  <JsonTree data={meta} accent="#10B981" editablePaths={metaEditable} onSave={saveMeta} />
                </section>
                <section className="flex min-w-0 flex-col gap-2">
                  <SectionLabel title="Golden dataset" subtitle="Extraction ground truth · editable" />
                  <JsonTree data={goldenView} accent="#10B981" editablePaths={goldenEditable} onSave={saveGolden} />
                </section>
              </div>
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                Hover a row and click the pencil to edit. Changes persist to your browser (IndexedDB) and survive a refresh.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
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
