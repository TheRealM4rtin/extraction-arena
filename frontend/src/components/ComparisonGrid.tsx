import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Star, Terminal } from 'lucide-react';
import { GoldenColumn } from './GoldenColumn';
import { ModelColumn } from './ModelColumn';
import { FieldDiffList } from './FieldDiff';
import { AccuracyScore } from './AccuracyScore';
import { Badge } from '@/components/ui/badge';
import { scoreDataset } from '@/lib/scoring';
import { useAppStore, type ModelKey } from '@/store';
import { cn, formatMs } from '@/lib/utils';

interface ColumnDef {
  key: 'gt' | 'glm' | 'gpt' | 'docling';
  label: string;
  accent: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'gt', label: 'Ground Truth', accent: '#10B981' },
  { key: 'glm', label: 'GLM-5V-Turbo', accent: '#06B6D4' },
  { key: 'gpt', label: 'GPT-5.4 mini', accent: '#8B5CF6' },
  { key: 'docling', label: 'Docling MLX', accent: '#F59E0B' },
];

/** 4-column comparison: Ground Truth, GML-5V-Turbo, GPT-5.4 mini, Docling MLX. */
export function ComparisonGrid() {
  const glm = useAppStore((s) => s.glm);
  const gpt = useAppStore((s) => s.gpt);
  const docling = useAppStore((s) => s.docling);
  const golden = useAppStore((s) => s.active?.golden ?? null);
  const enabledModels = useAppStore((s) => s.enabledModels);
  const toggleModel = useAppStore((s) => s.toggleModel);

  const [widths, setWidths] = useState<number[]>([1, 1, 1, 1]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const scoreOf = (data: Record<string, unknown>) =>
    golden ? scoreDataset(data as Parameters<typeof scoreDataset>[0], golden) : null;
  const scores = {
    glm: scoreOf(glm.data)?.accuracy ?? 0,
    gpt: scoreOf(gpt.data)?.accuracy ?? 0,
    docling: scoreOf(docling.extracted)?.accuracy ?? 0,
  };

  // Only enabled + done models participate in the BEST badge.
  const doneModels: Array<'glm' | 'gpt' | 'docling'> = [];
  if (enabledModels.glm && glm.status === 'done') doneModels.push('glm');
  if (enabledModels.gpt && gpt.status === 'done') doneModels.push('gpt');
  if (enabledModels.docling && docling.status === 'done') doneModels.push('docling');

  let winner: 'glm' | 'gpt' | 'docling' | null = null;
  if (doneModels.length > 0) {
    winner = doneModels.reduce((best, m) => (scores[m] > scores[best] ? m : best), doneModels[0]);
  }

  const onPointerDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = i;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const total = rect.width;
    const i = dragging.current;
    let left = 0;
    for (let k = 0; k <= i; k++) left += (widths[k] / widths.reduce((a, b) => a + b, 0)) * total;
    const deltaFrac = (dx - left) / total;
    const sum = widths.reduce((a, b) => a + b, 0);
    const next = [...widths];
    const move = deltaFrac * sum;
    next[i] = Math.max(0.4, next[i] + move);
    next[i + 1] = Math.max(0.4, next[i + 1] - move);
    setWidths(next);
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  const total = widths.reduce((a, b) => a + b, 0);

  return (
    <div
      ref={containerRef}
      className="relative flex h-[calc(100vh-184px)] min-h-[480px] gap-3 overflow-x-clip"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {COLUMNS.map((col, i) => {
        const flex = `${(widths[i] / total) * 100}%`;
        const modelKey = col.key as ModelKey | 'gt';
        const isModel = modelKey !== 'gt';
        const enabled = isModel ? enabledModels[modelKey] : true;
        const showBadge =
          isModel && winner === modelKey && scores[modelKey] > 0;
        return (
          <div key={col.key} style={{ width: flex }} className="flex min-w-0">
            <div className="relative flex w-full min-w-0 flex-col">
              <ColumnShell
                label={col.label}
                accent={col.accent}
                index={i}
                enabled={enabled}
                onToggle={isModel ? () => toggleModel(modelKey) : undefined}
                badge={showBadge ? <BestBadge accent={col.accent} /> : null}
              >
                {col.key === 'gt' && <GoldenColumn />}
                {col.key === 'glm' && (
                  <ModelColumn source="glm" accent={col.accent} index={i} isWinner={winner === 'glm'} />
                )}
                {col.key === 'gpt' && (
                  <ModelColumn source="gpt" accent={col.accent} index={i} isWinner={winner === 'gpt'} />
                )}
                {col.key === 'docling' && (
                  <DoclingColumn accent={col.accent} index={i} isWinner={winner === 'docling'} />
                )}
              </ColumnShell>
            </div>
          </div>
        );
      })}

      {COLUMNS.slice(0, -1).map((_, i) => (
        <div
          key={`handle-${i}`}
          onPointerDown={onPointerDown(i)}
          className="absolute top-0 z-20 flex h-full w-3 cursor-col-resize items-center justify-center"
          style={{ left: `calc(${((widths.slice(0, i + 1).reduce((a, b) => a + b, 0) / total) * 100).toFixed(3)}% - 6px)` }}
        >
          <div className="h-2/3 w-0.5 rounded-full bg-border hover:bg-foreground/40" />
        </div>
      ))}
    </div>
  );
}

function BestBadge({ accent }: { accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, y: -6, x: '-50%' }}
      animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      className="absolute -top-3 left-1/2 z-30"
    >
      <div
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-black shadow-lg"
        style={{ background: accent }}
      >
        <Star className="h-3 w-3 fill-black" /> BEST
      </div>
    </motion.div>
  );
}

function ColumnShell({
  label,
  accent,
  index,
  enabled = true,
  onToggle,
  badge,
  children,
}: {
  label: string;
  accent: string;
  index: number;
  enabled?: boolean;
  onToggle?: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className={cn(
        'relative flex h-full min-h-0 flex-col rounded-2xl glass transition-opacity duration-300',
        !enabled && 'opacity-60'
      )}
      style={{ borderColor: `${accent}${enabled ? '40' : '1A'}` }}
    >
      {badge}
      <div
        className="flex shrink-0 items-center gap-2 rounded-t-2xl px-4 py-3"
        style={{ background: `${accent}${enabled ? '14' : '0A'}` }}
      >
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{
            background: accent,
            boxShadow: enabled ? `0 0 10px ${accent}` : 'none',
            opacity: enabled ? 1 : 0.4,
          }}
        />
        <h2
          className="flex-1 text-sm font-bold uppercase tracking-wider transition-opacity"
          style={{ color: accent, opacity: enabled ? 1 : 0.55 }}
        >
          {label}
        </h2>
        {onToggle && (
          <ColumnToggle
            enabled={enabled}
            onToggle={onToggle}
            accent={accent}
            label={label}
          />
        )}
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto transition-opacity duration-300',
          !enabled && 'pointer-events-none opacity-30 saturate-50'
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

/**
 * Accent-colored toggle switch rendered in the top-right of model column headers.
 * When on, the track fills with the column's accent color; when off, it falls back
 * to the muted input surface. The thumb slides right when enabled.
 */
function ColumnToggle({
  enabled,
  onToggle,
  accent,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  accent: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${label} column`}
      title={enabled ? 'Disable model' : 'Enable model'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{ background: enabled ? accent : 'hsl(240 4% 16%)' }}
    >
      <span
        className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200"
        style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  );
}

function DoclingColumn({ accent, index, isWinner }: { accent: string; index: number; isWinner: boolean }) {
  const docling = useAppStore((s) => s.docling);
  const golden = useAppStore((s) => s.active?.golden ?? null);
  const score = golden ? scoreDataset(docling.extracted, golden) : null;
  const done = docling.status === 'done';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className={cn(
        'flex flex-col px-3 pb-4 pt-3 transition-shadow duration-500',
        isWinner && done && score && score.accuracy > 0 && 'shadow-[0_0_40px_-8px_var(--docling-glow)]'
      )}
      style={{ '--docling-glow': `${accent}cc` } as React.CSSProperties}
    >
      <div className="my-1 flex flex-col items-center">
        <AccuracyScore accuracy={done && score ? score.accuracy : 0} accent={accent} size={150} />
        <p className="mt-1 text-xs text-muted-foreground">
          {score ? `${score.matched}/${score.total} (Docling map)` : '—'}
        </p>
      </div>
      <div className="my-2 flex flex-wrap items-center justify-center gap-1.5">
        <Badge variant="outline" className="border-border bg-background/60 font-mono text-[11px]">
          {formatMs(docling.elapsedMs)}
        </Badge>
        {docling.model && (
          <Badge variant="outline" className="border-border bg-background/60 text-[11px] text-muted-foreground">
            {docling.model}
          </Badge>
        )}
      </div>

      {done && score && golden && (
        <div className="mt-1">
          <FieldDiffList fields={score.perField} data={docling.extracted} golden={golden} accent={accent} />
        </div>
      )}

      {(docling.status === 'loading' || done) && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" style={{ color: accent }} />
            Docling extracted text
          </div>
          <div className="h-56 overflow-y-auto rounded-md border border-border bg-background/60 p-2">
            {docling.status === 'loading' && (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-200/90">
                {'▋ Running local Docling...'}
              </pre>
            )}
            {done && (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-200/90">
                {docling.rawText || '(no text extracted)'}
                <span className="ml-0.5 inline-block animate-pulse" style={{ color: accent }}>▋</span>
              </pre>
            )}
          </div>
        </div>
      )}

      {docling.status === 'error' && (
        <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 p-2">
          <p className="font-mono text-[11px] text-rose-300">{docling.error}</p>
        </div>
      )}
      {docling.status === 'idle' && (
        <p className="mt-6 text-center font-mono text-[11px] text-muted-foreground">Awaiting local Docling run...</p>
      )}
    </motion.div>
  );
}
