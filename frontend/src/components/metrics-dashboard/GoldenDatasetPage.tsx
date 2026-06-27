import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Filter, Network } from 'lucide-react';
import {
  type GoldenDataset,
  type GoldenValue,
  humanLabel,
  valueKind,
} from '@/lib/dataset';
import { useAppStore, useFieldMetricConfig } from '@/store';
import {
  type MatchStrategy,
  type OptimizationPriority,
} from '@/lib/metrics';
import { cn } from '@/lib/utils';

interface GoldenDatasetPageProps {
  golden: GoldenDataset;
}

/** Interactive showcase of the golden schema: one card per field, with the
 *  per-field match-strategy + optimization-priority controls and an accordion
 *  that reveals the golden value. */
export function GoldenDatasetPage({ golden }: GoldenDatasetPageProps) {
  const entries = Object.entries(golden.golden_extraction);

  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title="Golden Dataset"
        subtitle="The extraction ground truth. Configure how each field is scored, then review its expected value."
      />
      <ul className="flex flex-col gap-2">
        {entries.map(([key, field]) => (
          <GoldenFieldRow key={key} fieldKey={key} value={field.value} />
        ))}
      </ul>
    </div>
  );
}

function GoldenFieldRow({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: GoldenValue;
}) {
  const [open, setOpen] = useState(false);
  const config = useFieldMetricConfig(fieldKey);
  const setFieldMetricConfig = useAppStore((s) => s.setFieldMetricConfig);

  const setStrategy = (matchStrategy: MatchStrategy) =>
    setFieldMetricConfig(fieldKey, { matchStrategy });
  const setPriority = (priority: OptimizationPriority) =>
    setFieldMetricConfig(fieldKey, { priority });

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">
              {humanLabel(fieldKey)}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {fieldKey}
            </span>
          </span>
        </button>

        {/* Toggle controls — stop propagation so they never toggle the accordion. */}
        <div
          className="flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <MatchStrategyPill
            value={config.matchStrategy}
            onChange={setStrategy}
          />
          <PriorityToggle value={config.priority} onChange={setPriority} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="value"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Expected value
              </p>
              <GoldenValueDisplay value={value} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Pill / segmented control: Partial Match vs Exact Match. */
function MatchStrategyPill({
  value,
  onChange,
}: {
  value: MatchStrategy;
  onChange: (v: MatchStrategy) => void;
}) {
  const segments: Array<{ id: MatchStrategy; label: string }> = [
    { id: 'partial', label: 'Partial' },
    { id: 'exact', label: 'Exact' },
  ];
  return (
    <SegmentControl
      ariaLabel="Match strategy"
      segments={segments}
      value={value}
      onChange={(v) => onChange(v as MatchStrategy)}
      activeClass={(id) =>
        id === 'partial'
          ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-[inset_0_0_0_1px_rgb(6_182_212_/_0.35)]'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow-[inset_0_0_0_1px_rgb(245_158_11_/_0.35)]'
      }
    />
  );
}

/** Labeled two-way toggle: Prioritize Recall (blue/net) vs Precision (amber/filter). */
function PriorityToggle({
  value,
  onChange,
}: {
  value: OptimizationPriority;
  onChange: (v: OptimizationPriority) => void;
}) {
  const segments: Array<{ id: OptimizationPriority; label: string; icon: React.ReactNode }> = [
    { id: 'recall', label: 'Recall', icon: <Network className="h-3.5 w-3.5" /> },
    { id: 'precision', label: 'Precision', icon: <Filter className="h-3.5 w-3.5" /> },
  ];
  return (
    <SegmentControl
      ariaLabel="Optimization priority"
      segments={segments}
      value={value}
      onChange={(v) => onChange(v as OptimizationPriority)}
      activeClass={(id) =>
        id === 'recall'
          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 shadow-[inset_0_0_0_1px_rgb(56_189_248_/_0.35)]'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow-[inset_0_0_0_1px_rgb(245_158_11_/_0.35)]'
      }
      prefixLabel="Prioritize"
    />
  );
}

interface SegmentLike {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

function SegmentControl({
  ariaLabel,
  segments,
  value,
  onChange,
  activeClass,
  prefixLabel,
}: {
  ariaLabel: string;
  segments: SegmentLike[];
  value: string;
  onChange: (v: string) => void;
  activeClass: (id: string) => string;
  prefixLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {prefixLabel && (
        <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
          {prefixLabel}
        </span>
      )}
      <div className="flex items-center rounded-full border border-border bg-background/50 p-0.5">
        {segments.map((seg) => {
          const active = seg.id === value;
          return (
            <button
              key={seg.id}
              type="button"
              onClick={() => onChange(seg.id)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                active
                  ? activeClass(seg.id)
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {seg.icon}
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Renders a golden value (scalar / array / object) verbatim, no diff. */
function GoldenValueDisplay({ value }: { value: GoldenValue }) {
  const kind = valueKind(value);

  if (kind === 'array') {
    const arr = value as string[];
    if (arr.length === 0) return <AbsentNote label="(empty array)" />;
    return (
      <ul className="flex flex-col gap-0.5">
        {arr.map((item, idx) => (
          <li key={idx} className="flex gap-1.5 font-mono text-sm text-foreground">
            <span className="text-gt/60">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, string>);
    if (entries.length === 0) return <AbsentNote label="(empty object)" />;
    return (
      <dl className="flex flex-col gap-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-1.5 font-mono text-sm">
            <dt className="text-gt/70">{k}:</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const str = value as string;
  if (str === 'not_found' || str === '') return <AbsentNote label="(not found)" />;
  return <p className="font-mono text-sm leading-relaxed text-foreground">{str}</p>;
}

function AbsentNote({ label }: { label: string }) {
  return <span className="italic text-muted-foreground">{label}</span>;
}

export function PageIntro({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="border-b border-border/60 pb-2">
      <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
    </div>
  );
}
