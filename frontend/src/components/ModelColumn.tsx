import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AccuracyScore } from './AccuracyScore';
import { JsonViewer } from './JsonViewer';
import { FieldDiffList } from './FieldDiff';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { scoreDataset } from '@/lib/scoring';
import { useAppStore } from '@/store';
import { cn, formatMs, formatCost } from '@/lib/utils';

export type ColumnSource = 'glm' | 'gpt';

interface ModelColumnProps {
  source: ColumnSource;
  accent: string;
  index: number;
  isWinner: boolean;
}

/** GML-5V-Turbo / GPT-5.4 mini comparison column (dataset-driven fields). */
export function ModelColumn({ source, accent, index, isWinner }: ModelColumnProps) {
  const result = useAppStore((s) => s[source]);
  const golden = useAppStore((s) => s.active?.golden ?? null);

  const score = golden ? scoreDataset(result.data, golden) : null;
  const loading = result.status === 'loading';
  const done = result.status === 'done';
  const error = result.status === 'error';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'flex flex-col px-3 pb-4 pt-3 transition-shadow duration-500',
        isWinner && done && score && score.accuracy > 0 && 'shadow-[0_0_40px_-8px_var(--winner-glow)]'
      )}
      style={{ '--winner-glow': `${accent}cc` } as React.CSSProperties}
    >
      <div className="my-1 flex flex-col items-center">
        <AccuracyScore
          accuracy={done && score ? score.accuracy : 0}
          accent={accent}
          size={160}
          active={done && !!score}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {score ? `${score.matched}/${score.total} exact` : '—'}
          {score ? ` · ${score.partialAccuracy}% partial` : ''}
        </p>
      </div>

      <div className="mb-3 mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <Badge variant="outline" className="border-border bg-background/60 font-mono text-[11px]">
          {formatMs(result.elapsedMs)}
        </Badge>
        <Badge variant="outline" className="border-border bg-background/60 font-mono text-[11px]">
          {formatCost(result.estimatedCostUsd)} est.
        </Badge>
        <Badge variant="outline" className="border-border bg-background/60 font-mono text-[11px]">
          {(result.promptTokens + result.completionTokens).toLocaleString()} tok
        </Badge>
      </div>

      <CostBars input={result.promptTokens} output={result.completionTokens} accent={accent} />

      <div className="relative mt-3 flex-1">
        <AnimatePresence mode="wait">
          {loading && <SkeletonBody key="skeleton" />}
          {error && <ErrorBody key="error" message={result.error ?? 'Request failed.'} accent={accent} />}
          {done && score && golden && (
            <motion.div
              key="content"
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: 90, opacity: 0 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <FieldDiffList fields={score.perField} data={result.data} golden={golden} accent={accent} />
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Raw JSON
                </summary>
                <div className="mt-2 max-h-52">
                  <JsonViewer data={result.data} accent={accent} typewriter />
                </div>
              </details>
            </motion.div>
          )}
        </AnimatePresence>
        {!loading && !done && !error && <IdleHint accent={accent} />}
      </div>
    </motion.div>
  );
}

function CostBars({ input, output, accent }: { input: number; output: number; accent: string }) {
  const total = Math.max(1, input + output);
  const bars = [
    { h: (input / total) * 100 },
    { h: (output / total) * 100 },
    { h: 100 },
  ];
  return (
    <div className="mb-1 flex items-end justify-center gap-1.5" style={{ height: 30 }}>
      {bars.map((b, i) => (
        <div key={i} className="flex h-full flex-col items-center justify-end">
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(6, b.h)}%` }}
            transition={{ duration: 0.6, delay: 0.2 + i * 0.1, ease: 'easeOut' }}
            className="w-2 rounded-sm"
            style={{ background: accent, opacity: 0.5 + i * 0.2 }}
          />
        </div>
      ))}
    </div>
  );
}

function SkeletonBody() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </motion.div>
  );
}

function ErrorBody({ message, accent }: { message: string; accent: string }) {
  const hint = errorHint(message);

  return (
    <motion.div
      initial={{ opacity: 0, rotateY: 90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      className="flex flex-col items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-rose-400" />
      <p className="text-xs text-rose-200">Extraction failed</p>
      <p className="max-h-40 overflow-auto font-mono text-[10px] text-rose-300/80">{message}</p>
      {hint && (
        <p className="text-[10px]" style={{ color: accent }}>
          {hint}
        </p>
      )}
    </motion.div>
  );
}

function errorHint(message: string): string | null {
  const lower = message.toLowerCase();

  if (lower.includes('413') || lower.includes('too large')) {
    return 'This is a request-size limit, not an API-key issue.';
  }

  if (lower.includes('401') || lower.includes('403') || lower.includes('api key')) {
    return 'Check the API key for this model.';
  }

  return null;
}

function IdleHint({ accent }: { accent: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <Loader2 className="h-5 w-5 opacity-30" style={{ color: accent }} />
      <p className="text-xs">Awaiting run</p>
    </div>
  );
}
