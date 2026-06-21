import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UploadCloud, Loader2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { convertPdfToPages, type PageImage } from '@/lib/api';
import { normalizeGolden, type GoldenDataset } from '@/lib/dataset';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;

interface CreateDatasetDialogProps {
  open: boolean;
  onClose: () => void;
}

type Stage = 'name' | 'pdf' | 'golden';

const DEFAULT_DPI = 300;

/** Three-step dataset creation: name -> PDF (300 DPI conversion) -> golden JSON. */
export function CreateDatasetDialog({ open, onClose }: CreateDatasetDialogProps) {
  const createDataset = useAppStore((s) => s.createDataset);

  const [stage, setStage] = useState<Stage>('name');
  const [name, setName] = useState('');
  const [pages, setPages] = useState<PageImage[]>([]);
  const [pdfName, setPdfName] = useState('');
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [goldenText, setGoldenText] = useState('');
  const [goldenError, setGoldenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setStage('name');
    setName('');
    setPages([]);
    setPdfName('');
    setDpi(DEFAULT_DPI);
    setConverting(false);
    setConvertError(null);
    setGoldenText('');
    setGoldenError(null);
    setSaving(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handlePdf = async (file: File) => {
    setConvertError(null);
    if (file.type !== 'application/pdf') {
      setConvertError('Only PDF files are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setConvertError('File exceeds the 10 MB limit.');
      return;
    }
    setConverting(true);
    try {
      const result = await convertPdfToPages(file);
      setPages(result.pages);
      setPdfName(result.pdfName);
      setDpi(result.dpi);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setConverting(false);
    }
  };

  const handleSave = async () => {
    setGoldenError(null);
    let golden: GoldenDataset;
    try {
      golden = normalizeGolden(JSON.parse(goldenText));
    } catch (e) {
      setGoldenError(e instanceof Error ? e.message : 'Invalid JSON.');
      return;
    }
    setSaving(true);
    try {
      await createDataset({ name, pdfName, dpi, pages, golden });
      close();
    } catch (e) {
      setGoldenError(e instanceof Error ? e.message : 'Could not save dataset.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && pages.length > 0 && goldenText.trim().length > 0 && !saving;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          />
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="glass flex max-h-[88vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-2xl"
            >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Create Dataset</h2>
                <StageBadge stage={stage} />
              </div>
              <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* Step indicators */}
              <div className="mb-5 flex items-center gap-2 text-[11px]">
                <StepDot active={stage === 'name'} done={stage !== 'name'} label="Name" />
                <div className="h-px flex-1 bg-border" />
                <StepDot active={stage === 'pdf'} done={stage === 'golden'} label="PDF" />
                <div className="h-px flex-1 bg-border" />
                <StepDot active={stage === 'golden'} done={false} label="Golden JSON" />
              </div>

              {stage === 'name' && (
                <div className="flex flex-col gap-3">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Dataset name
                  </label>
                  <Input
                    autoFocus
                    value={name}
                    placeholder="e.g. Cybertruck Rescue Sheet"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && name.trim()) setStage('pdf');
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Give this evaluation set a memorable name. You can run and re-run it anytime.
                  </p>
                </div>
              )}

              {stage === 'pdf' && (
                <div className="flex flex-col gap-3">
                  <PdfDropZone converting={converting} pdfName={pdfName} pageCount={pages.length} dpi={dpi} error={convertError} onFile={handlePdf} />
                  {convertError && (
                    <p className="flex items-center gap-1.5 text-xs text-rose-400">
                      <AlertCircle className="h-3.5 w-3.5" /> {convertError}
                    </p>
                  )}
                </div>
              )}

              {stage === 'golden' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Golden dataset JSON
                    </label>
                    <span className="text-[10px] text-muted-foreground">Requires a "golden_extraction" object</span>
                  </div>
                  <Textarea
                    value={goldenText}
                    spellCheck={false}
                    placeholder='{ "golden_extraction": { "field_key": { "value": "...", "difficulty": "text", "source": "Page 1/4" } } }'
                    className="min-h-[260px] resize-y font-mono text-xs"
                    onChange={(e) => setGoldenText(e.target.value)}
                  />
                  {goldenError && (
                    <p className="flex items-center gap-1.5 text-xs text-rose-400">
                      <AlertCircle className="h-3.5 w-3.5" /> {goldenError}
                    </p>
                  )}
                  <div className="rounded-md border border-border bg-background/60 p-2.5 text-[11px] text-muted-foreground">
                    <p className="mb-1 font-semibold text-foreground">Output shape</p>
                    Each field becomes an extraction target. <code className="font-mono text-foreground">value</code> may be a
                    string, array, or object. <code className="font-mono text-foreground">difficulty</code> and{' '}
                    <code className="font-mono text-foreground">source</code> are optional metadata shown in the Golden column.
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => (stage === 'name' ? close() : setStage(stage === 'golden' ? 'pdf' : 'name'))}>
                {stage === 'name' ? 'Cancel' : 'Back'}
              </Button>
              <div className="flex items-center gap-2">
                {stage === 'name' && (
                  <Button size="sm" disabled={!name.trim()} onClick={() => setStage('pdf')}>
                    Continue
                  </Button>
                )}
                {stage === 'pdf' && (
                  <Button size="sm" disabled={pages.length === 0 || converting} onClick={() => setStage('golden')}>
                    Continue
                  </Button>
                )}
                {stage === 'golden' && (
                  <Button size="sm" disabled={!canSave} onClick={handleSave}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create dataset'}
                  </Button>
                )}
              </div>
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function PdfDropZone({
  converting,
  pdfName,
  pageCount,
  dpi,
  error,
  onFile,
}: {
  converting: boolean;
  pdfName: string;
  pageCount: number;
  dpi: number;
  error: string | null;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);

  if (pageCount > 0 && !error) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        <div className="flex-1">
          <p className="truncate text-sm font-medium text-foreground">{pdfName}</p>
          <p className="text-[11px] text-muted-foreground">
            {pageCount} pages converted at {dpi} DPI
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onFile(new File([], ''))}>
          Replace
        </Button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-background/50 p-8 text-center transition-all hover:border-cyan-400/60',
        dragging && 'scale-[1.01] border-cyan-400 bg-cyan-400/5',
        !dragging && !converting && 'animate-breathe'
      )}
    >
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {converting ? (
        <>
          <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
          <p className="font-mono text-xs text-cyan-300">Converting at 300 DPI…</p>
        </>
      ) : (
        <>
          <UploadCloud className="h-8 w-8 text-cyan-400" />
          <p className="text-sm font-medium text-foreground">Drop the rescue-sheet PDF</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> PDF · max 10 MB
          </p>
        </>
      )}
    </label>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 font-medium uppercase tracking-wider',
        active ? 'text-cyan-600 dark:text-cyan-300' : done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          active ? 'bg-cyan-400' : done ? 'bg-emerald-400' : 'bg-muted-foreground/40'
        )}
      />
      {label}
    </span>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  const map: Record<Stage, string> = { name: 'Step 1/3', pdf: 'Step 2/3', golden: 'Step 3/3' };
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {map[stage]}
    </span>
  );
}
