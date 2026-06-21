import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Layers, Maximize2, X } from 'lucide-react';
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
  const [fullscreen, setFullscreen] = useState(false);

  // Sync the sidebar page with whichever dataset becomes active.
  useEffect(() => {
    if (active && active.pages.length > 0) {
      setActivePage(active.pages[0].page);
    }
  }, [active?.name]);

  // Lock body scroll while the fullscreen modal is open.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

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
    <>
      <div className="glass flex flex-col rounded-2xl p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Layers className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Pages</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {active.dpi} DPI
          </span>
        </div>
        <p className="mb-2 truncate px-1 text-[11px] text-muted-foreground">{active.pdfName}</p>

        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title="Open PDF in fullscreen"
          className="group relative mb-3 block w-full overflow-hidden rounded-lg border border-border bg-background/60 text-left transition-colors hover:border-cyan-400/60"
        >
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
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-lg">
              <Maximize2 className="h-3.5 w-3.5" />
              Open fullscreen
            </span>
          </span>
        </button>

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

      <PdfFullscreenModal
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        pages={pages}
        activePage={activePage}
        onSelect={setActivePage}
        pdfName={active.pdfName}
      />
    </>
  );
}

interface PdfFullscreenModalProps {
  open: boolean;
  onClose: () => void;
  pages: { page: number; dataUrl: string }[];
  activePage: number;
  onSelect: (page: number) => void;
  pdfName: string;
}

function PdfFullscreenModal({
  open,
  onClose,
  pages,
  activePage,
  onSelect,
  pdfName,
}: PdfFullscreenModalProps) {
  const current = pages.find((p) => p.page === activePage) ?? pages[0];
  const currentIndex = pages.findIndex((p) => p.page === current?.page);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onSelect(pages[currentIndex - 1].page);
  }, [currentIndex, onSelect, pages]);

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < pages.length - 1) onSelect(pages[currentIndex + 1].page);
  }, [currentIndex, onSelect, pages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goPrev, goNext]);

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Fullscreen PDF preview: ${pdfName}`}
        >
          {/* Top bar */}
          <div
            className="absolute left-0 right-0 top-0 flex items-center gap-3 px-4 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate font-mono text-sm text-muted-foreground">{pdfName}</span>
            <span className="ml-auto rounded-full bg-muted px-3 py-1 font-mono text-sm text-foreground">
              {current.page} / {pages.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close fullscreen preview"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-cyan-400/20 hover:text-cyan-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Previous arrow */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={currentIndex <= 0}
            aria-label="Previous page"
            className="absolute left-3 flex h-12 w-12 items-center justify-center rounded-full bg-background/70 text-foreground shadow-lg transition-all hover:bg-cyan-400/20 hover:text-cyan-300 disabled:pointer-events-none disabled:opacity-30 z-10 sm:left-6"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>

          {/* Page image */}
          <motion.img
            key={current.page}
            src={current.dataUrl}
            alt={`PDF page ${current.page}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[88vw] rounded-md object-contain shadow-2xl"
          />

          {/* Next arrow */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={currentIndex >= pages.length - 1}
            aria-label="Next page"
            className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-full bg-background/70 text-foreground shadow-lg transition-all hover:bg-cyan-400/20 hover:text-cyan-300 disabled:pointer-events-none disabled:opacity-30 z-10 sm:right-6"
          >
            <ChevronRight className="h-7 w-7" />
          </button>

          {/* Hint */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1 text-[11px] text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            Use arrows to navigate · Esc or click outside to close
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
