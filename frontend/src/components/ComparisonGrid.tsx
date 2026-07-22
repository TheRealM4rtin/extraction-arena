import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { Star, GripVertical } from 'lucide-react';
import { GoldenColumn } from './GoldenColumn';
import { ModelColumn } from './ModelColumn';
import {
  MIN_COLUMN_FRACTION,
  pixelDeltaToFraction,
  transferColumnWidth,
} from '@/lib/columnResize';
import { scoreDataset } from '@/lib/scoring';
import {
  useActiveEvalConfigMap,
  useAppStore,
  MODEL_KEYS,
  type ColumnKey,
  type ModelKey,
} from '@/store';
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
  grok: { key: 'grok', label: 'Grok 4.5', accent: '#F43F5E' },
};

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  gt: 1,
  glm: 1,
  gpt: 1,
  grok: 1,
};

/** Tailwind gap-3 = 0.75rem = 12px between columns. */
const COLUMN_GAP_PX = 12;

/**
 * CSS custom properties on the grid drive each column's flex-grow.
 * During a drag we mutate these on the container DOM node (no React re-render),
 * so neighbors reflow in the same frame. We never clear them to empty — that
 * was the collapse regression.
 */
const FLEX_VAR: Record<ColumnKey, `--fg-${ColumnKey}`> = {
  gt: '--fg-gt',
  glm: '--fg-glm',
  gpt: '--fg-gpt',
  grok: '--fg-grok',
};

function widthsToCssVars(w: Record<ColumnKey, number>): React.CSSProperties {
  return {
    [FLEX_VAR.gt]: w.gt,
    [FLEX_VAR.glm]: w.glm,
    [FLEX_VAR.gpt]: w.gpt,
    [FLEX_VAR.grok]: w.grok,
  } as React.CSSProperties;
}

function applyWidthsToContainer(
  el: HTMLElement,
  w: Record<ColumnKey, number>
) {
  for (const key of Object.keys(FLEX_VAR) as ColumnKey[]) {
    el.style.setProperty(FLEX_VAR[key], String(w[key]));
  }
}

interface ResizeSession {
  startX: number;
  leftKey: ColumnKey;
  rightKey: ColumnKey;
  startLeft: number;
  startRight: number;
  usableWidthPx: number;
  /** Full flex-fraction sum at drag start (for 1:1 px → fraction mapping). */
  totalSum: number;
  /** Snapshot of all widths at pointer-down so non-pair columns stay fixed. */
  startWidths: Record<ColumnKey, number>;
}

/** Comparison grid: Ground Truth + enabled vision models (GLM, GPT, Grok). */
export function ComparisonGrid() {
  const glm = useAppStore((s) => s.glm);
  const gpt = useAppStore((s) => s.gpt);
  const grok = useAppStore((s) => s.grok);
  const golden = useAppStore((s) => s.active?.golden ?? null);
  const configMap = useActiveEvalConfigMap();
  const enabledModels = useAppStore((s) => s.enabledModels);
  const toggleModel = useAppStore((s) => s.toggleModel);
  const columnOrder = useAppStore((s) => s.columnOrder);
  const setColumnOrder = useAppStore((s) => s.setColumnOrder);

  const resultsByKey: Record<ModelKey, typeof glm> = { glm, gpt, grok };

  const [widths, setWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);
  /** True while a resize drag is active — disables Framer layout projection. */
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const resizeSession = useRef<ResizeSession | null>(null);
  const isResizingRef = useRef(false);

  const scores = useMemo(() => {
    if (!golden) {
      return { glm: 0, gpt: 0, grok: 0 } as Record<ModelKey, number>;
    }
    return {
      glm: scoreDataset(glm.data, golden, configMap, glm.judgeResults).extractionScore,
      gpt: scoreDataset(gpt.data, golden, configMap, gpt.judgeResults).extractionScore,
      grok: scoreDataset(grok.data, golden, configMap, grok.judgeResults).extractionScore,
    } satisfies Record<ModelKey, number>;
  }, [
    golden,
    glm.data,
    glm.judgeResults,
    gpt.data,
    gpt.judgeResults,
    grok.data,
    grok.judgeResults,
    configMap,
  ]);

  // Only enabled + done models participate in the BEST badge.
  const doneModels = MODEL_KEYS.filter(
    (m) => enabledModels[m] && resultsByKey[m].status === 'done'
  );

  let winner: ModelKey | null = null;
  if (doneModels.length > 0) {
    winner = doneModels.reduce((best, m) => (scores[m] > scores[best] ? m : best), doneModels[0]);
  }

  // Window-level listeners: live widths go to CSS vars on the container (sync
  // reflow, no React re-render of heavy column bodies). Commit to React state
  // once on pointerup. Never clear the CSS vars.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const session = resizeSession.current;
      const container = containerRef.current;
      if (!session || !container) return;
      const deltaPx = e.clientX - session.startX;
      const deltaFrac = pixelDeltaToFraction(
        deltaPx,
        session.usableWidthPx,
        session.totalSum
      );
      const { left, right } = transferColumnWidth(
        session.startLeft,
        session.startRight,
        deltaFrac,
        MIN_COLUMN_FRACTION
      );
      const next = {
        ...session.startWidths,
        [session.leftKey]: left,
        [session.rightKey]: right,
      };
      widthsRef.current = next;
      // Direct CSS var writes — same-frame flex reflow, no setState lag.
      container.style.setProperty(FLEX_VAR[session.leftKey], String(left));
      container.style.setProperty(FLEX_VAR[session.rightKey], String(right));
    };
    const onUp = () => {
      if (!resizeSession.current && !isResizingRef.current) return;
      resizeSession.current = null;
      isResizingRef.current = false;
      // Single React commit with final fractions (CSS vars already match).
      setWidths({ ...widthsRef.current });
      setIsResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onResizePointerDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const leftKey = columnOrder[i];
    const rightKey = columnOrder[i + 1];
    if (!leftKey || !rightKey || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const gapTotal = COLUMN_GAP_PX * Math.max(0, columnOrder.length - 1);
    const usableWidthPx = Math.max(1, rect.width - gapTotal);
    const startWidths = { ...widthsRef.current };
    const totalSum = Object.values(startWidths).reduce((a, b) => a + b, 0);

    resizeSession.current = {
      startX: e.clientX,
      leftKey,
      rightKey,
      startLeft: startWidths[leftKey],
      startRight: startWidths[rightKey],
      usableWidthPx,
      totalSum,
      startWidths,
    };
    isResizingRef.current = true;
    // Seed vars (already set via React style) and disable layout projection.
    applyWidthsToContainer(containerRef.current, startWidths);
    setIsResizing(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  return (
    <Reorder.Group
      axis="x"
      values={columnOrder}
      onReorder={setColumnOrder}
      as="div"
      ref={containerRef}
      style={widthsToCssVars(widths)}
      className="relative flex h-[calc(100vh-184px)] min-h-[480px] gap-3 overflow-x-clip"
    >
      {columnOrder.map((key, i) => {
        const col = COLUMN_MAP[key];
        const isLast = i === columnOrder.length - 1;
        const modelKey = key as ModelKey | 'gt';
        const isModel = modelKey !== 'gt';
        const enabled = isModel ? enabledModels[modelKey] : true;
        const showBadge = isModel && winner === modelKey && scores[modelKey] > 0;
        return (
          <ReorderableColumn
            key={key}
            columnKey={key}
            isResizing={isResizing}
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
            {key !== 'gt' && (
              <ModelColumn
                source={key}
                accent={col.accent}
                index={i}
                isWinner={winner === key}
              />
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
 * drives width transfer in the parent.
 *
 * flex-grow is bound to a CSS variable on the grid (`var(--fg-*)`) so live
 * resize can update the container without re-rendering column content.
 * layout={false} during resize kills Framer position projection lag.
 * We never blank flex-grow — that collapsed columns in an earlier attempt.
 */
function ReorderableColumn({
  columnKey,
  isResizing,
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
  isResizing: boolean;
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
      // Reorder.Item's public type omits `false`, but motion accepts it at runtime.
      layout={(isResizing ? false : 'position') as 'position'}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      whileDrag={{
        scale: 1.015,
        zIndex: 50,
        boxShadow: '0 18px 48px -12px rgba(0,0,0,0.6)',
      }}
      style={{
        // CSS var is set on the parent grid; unitless number works for flex-grow.
        flexGrow: `var(${FLEX_VAR[columnKey]})` as unknown as number,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
      }}
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
          // overflow-x-hidden: avoid a dual-axis scrollbar corner (white square)
          // on columns with long unwrapped field values (notably Ground Truth).
          'min-h-0 flex-1 overflow-y-auto overflow-x-hidden transition-opacity duration-300',
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
