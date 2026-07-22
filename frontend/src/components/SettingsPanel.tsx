import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ThemeToggle';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Slide-over settings: API keys. Keys are masked. */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const zaiKey = useAppStore((s) => s.zaiKey);
  const openaiKey = useAppStore((s) => s.openaiKey);
  const xaiKey = useAppStore((s) => s.xaiKey);
  const setZaiKey = useAppStore((s) => s.setZaiKey);
  const setOpenaiKey = useAppStore((s) => s.setOpenaiKey);
  const setXaiKey = useAppStore((s) => s.setXaiKey);

  const [showKeys, setShowKeys] = useState(false);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="glass fixed right-0 top-0 z-50 flex h-full w-[340px] flex-col gap-5 border-l border-border p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-tight">Settings</h2>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ThemeToggle />

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">API Keys</p>
                <button
                  onClick={() => setShowKeys((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {showKeys ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showKeys ? 'Hide' : 'Show'}
                </button>
              </div>

              <KeyField
                label="Z.AI API Key (GLM-5V-Turbo)"
                value={zaiKey}
                onChange={setZaiKey}
                shown={showKeys}
              />
              <KeyField
                label="OpenAI API Key (GPT-5.4 mini)"
                value={openaiKey}
                onChange={setOpenaiKey}
                shown={showKeys}
              />
              <KeyField
                label="xAI API Key (Grok 4.5)"
                value={xaiKey}
                onChange={setXaiKey}
                shown={showKeys}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Keys are read from <code className="font-mono">VITE_ZAI_API_KEY</code>,{' '}
                <code className="font-mono">VITE_OPENAI_API_KEY</code>, and{' '}
                <code className="font-mono">VITE_XAI_API_KEY</code> at build time and stored only in
                your browser. LLM calls are forwarded through the same-origin backend proxy and are never
                persisted server-side.
              </p>
            </div>

            <div className="mt-auto rounded-lg border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
              <p className="mb-1 font-semibold text-foreground">Backend</p>
              PDF→PNG conversion at <span className="text-cyan-300">300 DPI</span> on the Express server
              (<code className="font-mono">POST /api/extract</code>).
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function KeyField({
  label,
  value,
  onChange,
  shown,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  shown: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <Input
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder="sk-..."
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
