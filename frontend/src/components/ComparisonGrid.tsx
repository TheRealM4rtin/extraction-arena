import { useRef, useState } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { Star, GripVertical } from 'lucide-react';
import { GoldenColumn } from './GoldenColumn';
import { ModelColumn } from './ModelColumn';
import { scoreDataset } from '@/lib/scoring';
import { useAppStore, type ColumnKey, type ModelKey } from '@/store';
import { cn } from '@/lib/utils';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  accent: string;
}

const COLUMN_MAP: Record<ColumnKey, ColumnDef> = {
  gt: { key: 'gt', label: 'Ground Truth', accent: '#10B981' },
  glm: { key: 'glm', label: 'GLM-5V-Turbo', accent: '#06B6D4' },
  gpt: { key: 'gpt', label: 'GPT-5.4 mini', accent: '#8B5CF6' },
};

const DEFAULT_WIDTHS: Record<ColumnKey, number> = { gt: 1, glm: 1, gpt: 1 };

/** 3-column comparison: Ground Truth, GLM-5V-Turbo, GPT-5.4 mini. */
export function ComparisonGrid() {
  const glm = useAppStore((s) => s.glm);
  const gpt = useAppStore((s) => s.gpt);
  const golden = useAppStore((s) => s.active?.golden ?? null);
  const enabledModels = useAppStore((s) => s.enabledModels);
  const toggleModel = useAppStore((s) => s.toggleModel);
  const columnOrder = useAppStore((s) => s.columnOrder);
  const setColumnOrder = useAppStore((s) => s.setColumnOrder);

  const [widths, setWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const scoreOf = (data: Record<string, unknown>) =>
    golden ? scoreDataset(data as Parameters<typeof scoreDataset>[0], golden) : null;
  const scores = {
    glm: scoreOf(glm.data)?.accuracy ?? 0,
    gpt: scoreOf(gpt.data)?.accuracy ?? 0,
  };

  // Only enabled + done models participate in the BEST badge.
  const doneModels: Array<'glm' | 'gpt'> = [];
  if (enabledModels.glm && glm.status === 'done') doneModels.push('glm');
  if (enabledModels.gpt && gpt.status === 'done') doneModels.push('gpt');

  let winner: 'glm' | 'gpt' | null = null;
  if (doneModels.length > 0) {
    winner = doneModels.reduce((best, m) => (scores[m] > scores[best] ? m : best), doneModels[0]);
  }

  const onResizePointerDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = i;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const total = rect.width;
    const i = dragging.current;
    const leftKey = columnOrder[i];
    const rightKey = columnOrder[i + 1];
    if (!leftKey || !rightKey) return;
    const dx = e.clientX - rect.left;
    const sum = Object.values(widths).reduce((a, b) => a + b, 0);
    let cumulativeFrac = 0;
    for (let k = 0; k <= i; k++) cumulativeFrac += widths[columnOrder[k]];
    const leftEdgePx = (cumulativeFrac / sum) * total;
    const move = ((dx - leftEdgePx) / total) * sum;
    const next = { ...widths };
    next[leftKey] = Math.max(0.4, next[leftKey] + move);
    next[rightKey] = Math.max(0.4, next[rightKey] - move);
    setWidths(next);
  };
  const onResizePointerUp = () => {
    dragging.current = null;
  };

  const total = Object.values(widths).reduce((a, b) => a + b, 0);

  return (
    <Reorder.Group
      axis="x"
      values={columnOrder}
      onReorder={setColumnOrder}
      as="div"
      ref={containerRef}
      onPointerMove={onResizePointerMove}
      onPointerUp={onResizePointerUp}
      className="relative flex h-[calc(100vh-184px)] min-h-[480px] gap-3 overflow-x-clip"
    >
      {columnOrder.map((key, i) => {
        const col = COLUMN_MAP[key];
        const flex = `${(widths[key] / total) * 100}%`;
        const isLast = i === columnOrder.length - 1;
        const modelKey = key as ModelKey | 'gt';
        const isModel = modelKey !== 'gt';
        const enabled = isModel ? enabledModels[modelKey] : true;
        const showBadge = isModel && winner === modelKey && scores[modelKey] > 0;
        return (
          <ReorderableColumn
            key={key}
            columnKey={key}
            flex={flex}
            index={i}
            isLast={isLast}
            label={col.label}
            accent={col.accent}
            enabled={enabled}
            onToggle={isModel ? () => toggleModel(modelKey) : undefined}
            badge={showBadge ? <BestBadge accent={col.accent} /> : null}
            onResizePointerDown={onResizePointerDown(i)}
          >
            {key === 'gt' && <GoldenColumn />}
            {key === 'glm' && (
              <ModelColumn source="glm" accent={col.accent} index={i} isWinner={winner === 'glm'} />
            )}
            {key === 'gpt' && (
              <ModelColumn source="gpt" accent={col.accent} index={i} isWinner={winner === 'gpt'} />
            )}
          </ReorderableColumn>
        );
      })}
    </Reorder.Group>
  );
}

/**
 * A single reorderable comparison column. The drag handle in the header starts
 * a framer-motion drag via useDragControls; the resize handle on the right edge
 * (hidden for the last column in the current order) drives the width-fraction
 * resize logic which lives in the parent.
 */
function ReorderableColumn({
  columnKey,
  flex,
  index,
  isLast,
  label,
  accent,
  enabled,
  onToggle,
  badge,
  onResizePointerDown,
  children,
}: {
  columnKey: ColumnKey;
  flex: string;
  index: number;
  isLast: boolean;
  label: string;
  accent: string;
  enabled: boolean;
  onToggle?: () => void;
  badge?: React.ReactNode;
  onResizePointerDown: (e: React.PointerEvent) => void;
  children: React.ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={columnKey}
      as="div"
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      whileDrag={{
        scale: 1.015,
        zIndex: 50,
        boxShadow: '0 18px 48px -12px rgba(0,0,0,0.6)',
      }}
      style={{ width: flex }}
      className="relative flex min-w-0"
    >
      <div className="relative flex w-full min-w-0 flex-col">
        <ColumnShell
          label={label}
          accent={accent}
          index={index}
          enabled={enabled}
          onToggle={onToggle}
          badge={badge}
          dragControls={controls}
        >
          {children}
        </ColumnShell>
      </div>
      {!isLast && (
        <div
          onPointerDown={onResizePointerDown}
          aria-hidden
          className="absolute top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center"
          style={{ right: '-6px' }}
        >
          <div className="h-2/3 w-0.5 rounded-full bg-border hover:bg-foreground/40" />
        </div>
      )}
    </Reorder.Item>
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
  dragControls,
  children,
}: {
  label: string;
  accent: string;
  index: number;
  enabled?: boolean;
  onToggle?: () => void;
  badge?: React.ReactNode;
  dragControls: ReturnType<typeof useDragControls>;
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
        className="flex shrink-0 items-center gap-1.5 rounded-t-2xl px-3 py-3"
        style={{ background: `${accent}${enabled ? '14' : '0A'}` }}
      >
        <button
          type="button"
          aria-label={`Drag ${label} column to reorder`}
          title="Drag to reorder"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragControls.start(e);
          }}
          className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 transition-colors hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
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
      onPointerDown={(e) => e.stopPropagation()}
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
