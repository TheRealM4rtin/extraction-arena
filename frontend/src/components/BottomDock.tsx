import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, RotateCcw, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BottomDockProps {
  onRun: () => void;
  onReset: () => void;
  onCancel: () => void;
  onExport: () => void;
  running: boolean;
  canRun: boolean;
}

/**
 * Floating glass capsule toolbar with Run / Reset-Cancel / Export.
 *
 * The rotate button is dual-purpose: while a run is in progress it cancels every
 * in-flight call (the shared AbortController in App), and while idle it resets the
 * result columns. The icon stays RotateCcw in both modes; only the affordance
 * (aria-label + tint) changes so the cancel target is unambiguous.
 */
export function BottomDock({ onRun, onReset, onCancel, onExport, running, canRun }: BottomDockProps) {
  const [shimmer, setShimmer] = useState(false);

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 22 }}
      className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2"
    >
      <div className="glass flex items-center gap-2 rounded-full p-1.5 shadow-2xl">
        <Button
          onClick={onRun}
          disabled={!canRun || running}
          className="gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 px-6 text-primary-foreground hover:from-cyan-400 hover:to-violet-400"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Running...' : 'Run Extraction'}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={running ? onCancel : onReset}
          className="rounded-full"
          aria-label={running ? 'Cancel run' : 'Reset'}
          title={running ? 'Cancel run' : 'Reset'}
        >
          <RotateCcw className={running ? 'h-4 w-4 text-rose-400' : 'h-4 w-4'} />
        </Button>

        <div className="relative overflow-hidden">
          <Button
            variant="ghost"
            onClick={() => {
              setShimmer(true);
              onExport();
              setTimeout(() => setShimmer(false), 800);
            }}
            className="gap-2 rounded-full"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          {shimmer && (
            <motion.span
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/30 to-transparent"
              animate={{ x: ['0%', '200%'] }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
