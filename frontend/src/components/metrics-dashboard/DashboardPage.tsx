import { useMemo, useState } from 'react';
import { Check, Filter, ListOrdered, Network, X } from 'lucide-react';
import { useAppStore, MODEL_KEYS, type ModelKey } from '@/store';
import { humanLabel, type GoldenValue } from '@/lib/dataset';
import { aggregateRows, buildDashboardRows, type PRF } from '@/lib/metrics';
import { scoreDataset } from '@/lib/scoring';
import {
  aggregateBySection,
  histogramBins,
  scoreBand,
  sortByPriority,
  type FieldEvaluation,
} from '@/lib/evaluation';
import { cn } from '@/lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { PageIntro } from './GoldenDatasetPage';
import { Histogram } from './charts/Histogram';
import { SectionBars } from './charts/SectionBars';
import { BandStack } from './charts/BandStack';

type View = 'avg' | ModelKey;

interface ViewMeta {
  id: View;
  label: string;
  active: string;
  ring: string;
  accent: string;
}

const VIEW_META: Record<View, ViewMeta> = {
  avg: {
    id: 'avg',
    label: 'Average',
    active: 'border-gt/50 bg-gt/10 text-gt',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--gt)_/_0.3)]',
    accent: '#10B981',
  },
  glm: {
    id: 'glm',
    label: 'GLM-5V-Turbo',
    active: 'border-glm/50 bg-glm/10 text-glm',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--glm)_/_0.3)]',
    accent: '#06B6D4',
  },
  gpt: {
    id: 'gpt',
    label: 'GPT-5.4 mini',
    active: 'border-gpt/50 bg-gpt/10 text-gpt',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--gpt)_/_0.3)]',
    accent: '#8B5CF6',
  },
  grok: {
    id: 'grok',
    label: 'Grok 4.5',
    active: 'border-grok/50 bg-grok/10 text-grok',
    ring: 'shadow-[inset_0_0_0_1px_rgb(var(--grok)_/_0.3)]',
    accent: '#F43F5E',
  },
};

/** First available per-model evaluation on a dashboard row (stable model order). */
function firstEvalForAvg(row: {
  evaluationsByModel?: Record<string, FieldEvaluation>;
}): FieldEvaluation | undefined {
  for (const key of MODEL_KEYS) {
    const ev = row.evaluationsByModel?.[key];
    if (ev) return ev;
  }
  return undefined;
}

/**
 * Evaluation detail dashboard: same engine as the main comparison UI, with
 * aggregates, lightweight charts, and a per-field table sorted by priority.
 */
export function DashboardPage() {
  const active = useAppStore((s) => s.active);
  const glm = useAppStore((s) => s.glm);
  const gpt = useAppStore((s) => s.gpt);
  const grok = useAppStore((s) => s.grok);
  const metricConfigs = useAppStore((s) => s.metricConfigs);

  const [view, setView] = useState<View>('avg');

  const configMap = useMemo(
    () => (active ? (metricConfigs[active.id] ?? {}) : {}),
    [active, metricConfigs]
  );

  const resultsByKey = useMemo(
    () => ({ glm, gpt, grok }),
    [glm, gpt, grok]
  );

  const modelEvals = useMemo(() => {
    const empty: Record<ModelKey, ReturnType<typeof scoreDataset>['evaluation'] | null> = {
      glm: null,
      gpt: null,
      grok: null,
    };
    if (!active) return empty;
    const out = { ...empty };
    for (const key of MODEL_KEYS) {
      const r = resultsByKey[key];
      out[key] =
        r.status === 'done'
          ? scoreDataset(r.data, active.golden, configMap, r.judgeResults).evaluation ?? null
          : null;
    }
    return out;
  }, [active, resultsByKey, configMap]);

  const doneKeys = useMemo(
    () => MODEL_KEYS.filter((k) => modelEvals[k] !== null),
    [modelEvals]
  );

  const rows = useMemo(() => {
    if (!active) return [];
    const modelResults: Array<{
      id: string;
      data: Record<string, GoldenValue>;
      judgeResults?: typeof glm.judgeResults;
    }> = [];
    for (const key of MODEL_KEYS) {
      const r = resultsByKey[key];
      if (r.status === 'done') {
        modelResults.push({ id: key, data: r.data, judgeResults: r.judgeResults });
      }
    }
    return buildDashboardRows(
      Object.keys(active.golden.golden_extraction),
      active.golden.golden_extraction,
      modelResults,
      configMap
    );
  }, [active, resultsByKey, configMap]);

  const anyDone = doneKeys.length > 0;
  const availableViews = useMemo(() => {
    const views: View[] = [];
    if (anyDone) views.push('avg');
    for (const key of doneKeys) views.push(key);
    return views;
  }, [anyDone, doneKeys]);

  const effectiveView: View = availableViews.includes(view) ? view : 'avg';
  const summary = aggregateRows(rows, effectiveView);
  const meta = VIEW_META[effectiveView];

  const fieldEvalsForView: FieldEvaluation[] = useMemo(() => {
    if (effectiveView !== 'avg' && modelEvals[effectiveView]) {
      return modelEvals[effectiveView]!.perField;
    }
    if (doneKeys.length >= 2) {
      return rows
        .filter((r) => r.hasData)
        .map((r) => {
          const perModel = doneKeys
            .map((k) => r.evaluationsByModel?.[k])
            .filter((e): e is FieldEvaluation => Boolean(e));
          const base = perModel[0]!;
          return {
            ...base,
            match: perModel.every((e) => e.match),
            partial: perModel.reduce((s, e) => s + e.partial, 0) / perModel.length,
            precision: r.avg.precision,
            recall: r.avg.recall,
            f1: r.avg.f1,
          };
        });
    }
    return doneKeys[0] ? (modelEvals[doneKeys[0]]?.perField ?? []) : [];
  }, [effectiveView, modelEvals, rows, doneKeys]);

  const gateSummary = useMemo(() => {
    type Ev = NonNullable<(typeof modelEvals)[ModelKey]>;
    const pack = (ev: Ev) => ({
      accuracy: ev.accuracy,
      partialAccuracy: ev.partialAccuracy,
      matched: ev.matched,
      total: ev.total,
      extractionScore: ev.extractionScore,
      judgeUpliftCount: ev.judgeUpliftCount ?? 0,
      detAccuracy: ev.detAccuracy ?? ev.accuracy,
    });
    if (effectiveView !== 'avg' && modelEvals[effectiveView]) {
      return pack(modelEvals[effectiveView]!);
    }
    const done = doneKeys
      .map((k) => modelEvals[k])
      .filter((e): e is Ev => Boolean(e));
    if (done.length >= 2) {
      const n = done.length;
      return {
        accuracy: Math.round(done.reduce((s, e) => s + e.accuracy, 0) / n),
        partialAccuracy: Math.round(
          done.reduce((s, e) => s + e.partialAccuracy, 0) / n
        ),
        matched: Math.round(done.reduce((s, e) => s + e.matched, 0) / n),
        total: done[0]!.total,
        extractionScore: Math.round(
          done.reduce((s, e) => s + e.extractionScore, 0) / n
        ),
        judgeUpliftCount: done.reduce((s, e) => s + (e.judgeUpliftCount ?? 0), 0),
        detAccuracy: Math.round(
          done.reduce((s, e) => s + (e.detAccuracy ?? e.accuracy), 0) / n
        ),
      };
    }
    const single = done[0];
    return single
      ? pack(single)
      : {
          accuracy: 0,
          partialAccuracy: 0,
          matched: 0,
          total: 0,
          extractionScore: 0,
          judgeUpliftCount: 0,
          detAccuracy: 0,
        };
  }, [effectiveView, modelEvals, doneKeys]);

  const hist = useMemo(
    () => histogramBins(fieldEvalsForView.map((f) => f.f1), 5),
    [fieldEvalsForView]
  );

  const sections = useMemo(
    () =>
      aggregateBySection(fieldEvalsForView).map((s) => ({
        section: s.section,
        value: s.meanF1,
        count: s.count,
      })),
    [fieldEvalsForView]
  );

  const bands = useMemo(() => {
    let green = 0;
    let amber = 0;
    let red = 0;
    for (const f of fieldEvalsForView) {
      const b = scoreBand(f.f1);
      if (b === 'green') green += 1;
      else if (b === 'amber') amber += 1;
      else red += 1;
    }
    return { green, amber, red };
  }, [fieldEvalsForView]);

  const worst = useMemo(
    () => sortByPriority(fieldEvalsForView).slice(0, 8),
    [fieldEvalsForView]
  );

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aEv =
        effectiveView === 'avg'
          ? firstEvalForAvg(a)
          : a.evaluationsByModel?.[effectiveView];
      const bEv =
        effectiveView === 'avg'
          ? firstEvalForAvg(b)
          : b.evaluationsByModel?.[effectiveView];
      const aMetric =
        a.config.priority === 'precision'
          ? (aEv?.precision ?? a.avg.precision)
          : (aEv?.recall ?? a.avg.recall);
      const bMetric =
        b.config.priority === 'precision'
          ? (bEv?.precision ?? b.avg.precision)
          : (bEv?.recall ?? b.avg.recall);
      if (!a.hasData && b.hasData) return 1;
      if (a.hasData && !b.hasData) return -1;
      if (aMetric !== bMetric) return aMetric - bMetric;
      return a.key.localeCompare(b.key);
    });
  }, [rows, effectiveView]);

  if (!active) return null;

  const prfFor = (row: (typeof rows)[number]): PRF | undefined =>
    effectiveView === 'avg' ? (row.hasData ? row.avg : undefined) : row.byModel[effectiveView];

  const evalFor = (row: (typeof rows)[number]): FieldEvaluation | undefined => {
    if (effectiveView === 'avg') return firstEvalForAvg(row);
    return row.evaluationsByModel?.[effectiveView];
  };

  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title="Evaluation detail"
        subtitle="Same engine as the comparison columns — composed Extraction score (gate + partial + F1), optional semantic judge uplift on weak fields, and distributions."
      />

      <ModelSelector
        views={availableViews}
        view={effectiveView}
        onChange={setView}
        hasData={anyDone}
      />

      <SummaryStrip
        summary={summary}
        gate={gateSummary}
        view={effectiveView}
        hasData={anyDone}
      />

      {anyDone && fieldEvalsForView.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <BandStack
              title="F1 score bands"
              green={bands.green}
              amber={bands.amber}
              red={bands.red}
            />
          </div>
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <Histogram
              title="F1 distribution"
              bins={hist.map((b) => ({ label: b.label, count: b.count }))}
              accent={meta.accent}
            />
          </div>
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <SectionBars
              title="Mean F1 by section"
              rows={sections}
              accent={meta.accent}
            />
          </div>
        </div>
      )}

      {anyDone && worst.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Worst fields (priority-aware)
          </p>
          <ul className="flex flex-col gap-1">
            {worst.map((f) => {
              const metric =
                f.config.priority === 'precision' ? f.precision : f.recall;
              return (
                <li
                  key={f.key}
                  className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1.5"
                >
                  {f.match ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {f.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {f.config.priority === 'precision' ? 'P' : 'R'}{' '}
                    {Math.round(metric * 100)}% · F1 {Math.round(f.f1 * 100)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left">
                <Th>Field</Th>
                <Th>Config</Th>
                <Th className="text-center">Match</Th>
                <Th className="text-center">Partial</Th>
                <Th className="text-center">Precision</Th>
                <Th className="text-center">Recall</Th>
                <Th className="text-center">F1</Th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const prf = prfFor(row);
                const ev = evalFor(row);
                const has = prf !== undefined;
                const primaryIsP = row.config.priority === 'precision';
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
                      <div className="flex flex-wrap gap-1">
                        <StrategyBadge strategy={row.config.matchStrategy} />
                        <ListModeBadge mode={row.config.listMode} />
                        <PriorityBadge priority={row.config.priority} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {has && ev ? (
                        ev.match ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> ok
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-rose-400">
                            <X className="h-3.5 w-3.5" /> miss
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-mono text-xs text-foreground">
                        {has && ev ? `${Math.round(ev.partial * 100)}%` : '—'}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-center',
                        primaryIsP && 'bg-amber-500/5'
                      )}
                    >
                      <ScoreBadge value={prf?.precision ?? 0} hasData={has} />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-center',
                        !primaryIsP && 'bg-sky-500/5'
                      )}
                    >
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
        Run an extraction to populate scores. Numbers here match the main comparison gauges.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Select model view">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        View
      </span>
      {views.map((id) => {
        const m = VIEW_META[id];
        const isActive = id === view;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors',
              isActive ? cn(m.active, m.ring) : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStrip({
  summary,
  gate,
  view,
  hasData,
}: {
  summary: PRF & { count: number };
  gate: {
    accuracy: number;
    partialAccuracy: number;
    matched: number;
    total: number;
    extractionScore: number;
    judgeUpliftCount: number;
    detAccuracy: number;
  };
  view: View;
  hasData: boolean;
}) {
  const m = VIEW_META[view];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Overall · {m.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {hasData
            ? `${gate.matched}/${gate.total} fields exact · mean of ${summary.count} fields${
                gate.judgeUpliftCount > 0 ? ` · ${gate.judgeUpliftCount} judged ↑` : ''
              }`
            : 'no results yet'}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-4">
        <SummaryStat label="Extraction" value={gate.extractionScore / 100} has={hasData} />
        <SummaryStat label="Exact" value={gate.accuracy / 100} has={hasData} />
        <SummaryStat label="Partial" value={gate.partialAccuracy / 100} has={hasData} />
        <SummaryStat label="Precision" value={summary.precision} has={hasData && summary.count > 0} />
        <SummaryStat label="Recall" value={summary.recall} has={hasData && summary.count > 0} />
        <SummaryStat label="F1" value={summary.f1} has={hasData && summary.count > 0} />
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
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        isExact
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400'
      )}
    >
      {isExact ? 'Exact' : 'Partial'}
    </span>
  );
}

function ListModeBadge({ mode }: { mode: 'sequence' | 'set' }) {
  const isSeq = mode === 'sequence';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        isSeq
          ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      )}
    >
      <ListOrdered className="h-3 w-3" />
      {isSeq ? 'Seq' : 'Set'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: 'precision' | 'recall' }) {
  const isRecall = priority === 'recall';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
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
