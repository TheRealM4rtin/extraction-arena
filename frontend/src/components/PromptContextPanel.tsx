import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Pencil, X, RotateCcw } from 'lucide-react';
import { useAppStore, useDocumentContext } from '@/store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Sidebar: compact "Prompt Context" panel that injects a one-sentence document
 * description into the extraction prompt. Defaults to the active PDF filename;
 * click to override it for the active dataset. Shown only when a dataset is
 * active, placed directly below the Datasets section.
 */
export function PromptContextPanel() {
  const active = useAppStore((s) => s.active);
  const { value, isCustom } = useDocumentContext();
  const [editing, setEditing] = useState(false);

  if (!active) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Add context to the prompt"
        className="glass group flex w-full flex-col gap-1 rounded-2xl p-3 text-left transition-colors hover:border-cyan-400/40"
      >
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Prompt Context
            </h2>
          </div>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <p
          className={cn(
            'truncate px-1 text-[11px]',
            isCustom ? 'text-cyan-300' : 'text-muted-foreground'
          )}
        >
          {value || 'No context set'}
        </p>
        <p className="h-0 overflow-hidden px-1 text-[10px] text-muted-foreground/0 transition-all duration-200 group-hover:h-4 group-hover:text-muted-foreground/80">
          Add context to the prompt
        </p>
      </button>

      <PromptContextModal
        open={editing}
        onClose={() => setEditing(false)}
        initialValue={value}
        defaultFileName={active.pdfName}
        isCustom={isCustom}
      />
    </>
  );
}

interface PromptContextModalProps {
  open: boolean;
  onClose: () => void;
  initialValue: string;
  defaultFileName: string;
  isCustom: boolean;
}

function PromptContextModal({
  open,
  onClose,
  initialValue,
  defaultFileName,
  isCustom,
}: PromptContextModalProps) {
  const setDocumentContext = useAppStore((s) => s.setDocumentContext);
  const [draft, setDraft] = useState(initialValue);

  // Resync the textarea whenever the modal opens or the active dataset changes.
  useEffect(() => {
    if (open) setDraft(initialValue);
  }, [open, initialValue]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const confirm = () => {
    setDocumentContext(draft);
    onClose();
  };

  const resetToDefault = () => {
    setDocumentContext(defaultFileName);
    setDraft(defaultFileName);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          />
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="glass flex w-[480px] max-w-[92vw] flex-col overflow-hidden rounded-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-400" />
                  <h2 className="text-base font-bold">Prompt Context</h2>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-col gap-3 p-5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Document description
                </label>
                <Textarea
                  autoFocus
                  value={draft}
                  spellCheck={false}
                  placeholder={defaultFileName}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirm();
                  }}
                  className="min-h-[80px] resize-none font-mono text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  One short sentence describing the document. It is injected into the extraction
                  prompt to ground the model. Empty values fall back to the PDF filename.
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
                <Button variant="ghost" size="sm" onClick={resetToDefault} disabled={!isCustom}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to filename
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={confirm}>
                    Confirm
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
