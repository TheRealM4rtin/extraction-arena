import { useMemo, useState } from 'react';
import { Network, Filter } from 'lucide-react';
import { useAppStore, type ModelKey } from '@/store';
import { humanLabel, type GoldenValue } from '@/lib/dataset';
import { aggregateRows, buildDashboardRows, type PRF } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { PageIntro } from './GoldenDatasetPage';

type View = 'avg' | ModelKey;

interface ViewMeta {
  id: View;
  label: string;
  active: string;
  ring: string;
}

const VIEW_META: Record<View, ViewMeta> = {
  avg: {
    id: 'avg',
    label: 'Average',
    active: 'border-gt/50 bg-gt/10 text-gt',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--gt)_/_0.3)]',
  },
  glm: {
    id: 'glm',
    label: 'GLM-5V-Turbo',
    active: 'border-glm/50 bg-glm/10 text-glm',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--glm)_/_0.3)]',
  },
  gpt: {
    id: 'gpt',
    label: 'GPT-5.4 mini',
    active: 'border-gpt/50 bg-gpt/10 text-gpt',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--gpt)_/_0.3)]',
  },
};

/**
 * Per-field metrics table: Precision / Recall / F1 computed from extraction
 * results vs the golden dataset. A model selector switches the scores between
 * the cross-model average and each individual model's breakdown. Match strategy
 * + priority columns mirror the per-field config set on the Golden Dataset page.
 */
export function DashboardPage() {
  const active = useAppStore((s) => s.active);
  const glm = useAppStore((s) => s.glm);
  const gpt = useAppStore((s) => s.gpt);
  const metricConfigs = useAppStore((s) => s.metricConfigs);

  const [view, setView] = useState<View>('avg');

  const rows = useMemo(() => {
    if (!active) return [];
    const configs = metricConfigs[active.id] ?? {};
    const modelResults: Array<{ id: string; data: Record<string, GoldenValue> }> = [];
    if (glm.status === 'done') modelResults.push({ id: 'glm', data: glm.data });
    if (gpt.status === 'done') modelResults.push({ id: 'gpt', data: gpt.data });
    return buildDashboardRows(
      Object.keys(active.golden.golden_extraction),
      active.golden.golden_extraction,
      modelResults,
      configs
    );
  }, [active, glm, gpt, metricConfigs]);

  if (!active) return null;

  // Available views: average (if any model ran) + each model that produced results.
  const availableViews: View[] = [];
  const anyDone = glm.status === 'done' || gpt.status === 'done';
  if (anyDone) availableViews.push('avg');
  if (glm.status === 'done') availableViews.push('glm');
  if (gpt.status === 'done') availableViews.push('gpt');

  // Fall back to 'avg' if the selected view is no longer available (e.g. a
  // model was reset). 'avg' is always valid as a placeholder even pre-run.
  const effectiveView: View = availableViews.includes(view) ? view : 'avg';

  const summary = aggregateRows(rows, effectiveView);

  const prfFor = (row: (typeof rows)[number]): PRF | undefined =>
    effectiveView === 'avg' ? (row.hasData ? row.avg : undefined) : row.byModel[effectiveView];

  return (
    <div className="flex flex-col gap-3">
      <PageIntro title="Dashboard" subtitle="Per-field precision, recall and F1 against the golden dataset." />

      <ModelSelector
        views={availableViews}
        view={effectiveView}
        onChange={setView}
        hasData={anyDone}
      />

      <SummaryStrip summary={summary} view={effectiveView} />

      <div className="overflow-hidden rounded-xl border border-border bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left">
                <Th>Field</Th>
                <Th>Match Strategy</Th>
                <Th>Priority</Th>
                <Th className="text-center">Precision</Th>
                <Th className="text-center">Recall</Th>
                <Th className="text-center">F1</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const prf = prfFor(row);
                const has = prf !== undefined;
                return (
                  <tr
                    key={row.key}
                    className="border-b border-border/40 last:border-b-0 transition-colors hover:bg-background/40"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">
                          {humanLabel(row.key)}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {row.key}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StrategyBadge strategy={row.config.matchStrategy} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PriorityBadge priority={row.config.priority} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ScoreBadge value={prf?.precision ?? 0} hasData={has} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ScoreBadge value={prf?.recall ?? 0} hasData={has} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ScoreBadge value={prf?.f1 ?? 0} hasData={has} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Legend />
    </div>
  );
}

function ModelSelector({
  views,
  view,
  onChange,
  hasData,
}: {
  views: View[];
  view: View;
  onChange: (v: View) => void;
  hasData: boolean;
}) {
  if (!hasData) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
        Run an extraction to populate scores. The model selector and per-model breakdown appear once results are in.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Select model view">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        View
      </span>
      {views.map((id) => {
        const meta = VIEW_META[id];
        const isActive = id === view;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors',
              isActive ? cn(meta.active, meta.ring) : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStrip({
  summary,
  view,
}: {
  summary: PRF & { count: number };
  view: View;
}) {
  const meta = VIEW_META[view];
  const has = summary.count > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Overall · {meta.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {has ? `mean across ${summary.count} field${summary.count === 1 ? '' : 's'}` : 'no results yet'}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-4">
        <SummaryStat label="Precision" value={summary.precision} has={has} />
        <SummaryStat label="Recall" value={summary.recall} has={has} />
        <SummaryStat label="F1" value={summary.f1} has={has} />
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  has,
}: {
  label: string;
  value: number;
  has: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 font-mono text-lg font-bold text-foreground">
        {has ? `${Math.round(value * 100)}%` : '—'}
      </span>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
        className
      )}
    >
      {children}
    </th>
  );
}

function StrategyBadge({ strategy }: { strategy: 'exact' | 'partial' }) {
  const isExact = strategy === 'exact';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        isExact
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400'
      )}
    >
      {isExact ? 'Exact' : 'Partial'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: 'precision' | 'recall' }) {
  const isRecall = priority === 'recall';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        isRecall
          ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      {isRecall ? <Network className="h-3 w-3" /> : <Filter className="h-3 w-3" />}
      {isRecall ? 'Recall' : 'Precision'}
    </span>
  );
}

function Legend() {
  const items: Array<{ label: string; cls: string }> = [
    { label: '≥ 95%', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
    { label: '80–94%', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    { label: '< 80%', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Score bands
      </span>
      {items.map((it) => (
        <span
          key={it.label}
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
            it.cls
          )}
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}
