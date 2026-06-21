import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';

/**
 * Left viewer for the active dataset: main page + vertical filmstrip. Page
 * images come from the selected dataset (no upload here — datasets are created
 * via the Create Dataset dialog).
 */
export function PageViewer() {
  const active = useAppStore((s) => s.active);
  const [activePage, setActivePage] = useState(1);

  if (!active) return null;

  const pages = active.pages;
  if (pages.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
        This dataset has no converted pages.
      </div>
    );
  }

  const current = pages.find((p) => p.page === activePage) ?? pages[0];

  return (
    <div className="glass flex flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Layers className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Pages</h2>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {active.dpi} DPI
        </span>
      </div>
      <p className="mb-2 truncate px-1 text-[11px] text-muted-foreground">{active.pdfName}</p>

      <div className="relative mb-3 overflow-hidden rounded-lg border border-border bg-background/60">
        <AnimatePresence mode="wait">
          <motion.img
            key={current.page}
            src={current.dataUrl}
            alt={`${active.name} page ${current.page}`}
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="max-h-[380px] w-full object-contain"
          />
        </AnimatePresence>
        <span className="absolute right-2 top-2 rounded bg-background/80 px-2 py-0.5 font-mono text-[11px] text-cyan-300">
          Page {current.page} / {pages.length}
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((p) => (
          <button
            key={p.page}
            onClick={() => setActivePage(p.page)}
            className={cn(
              'relative shrink-0 overflow-hidden rounded-md border-2 transition-all',
              p.page === current.page
                ? 'scale-[1.04] border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                : 'border-border opacity-60 hover:opacity-100'
            )}
          >
            <img src={p.dataUrl} alt={`thumb page ${p.page}`} className="h-20 w-auto" />
            <span className="absolute bottom-0 left-0 bg-background/80 px-1.5 font-mono text-[10px] text-foreground">
              {p.page}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
