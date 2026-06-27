import { Filter, Network, Target, Gauge } from 'lucide-react';
import { PageIntro } from './GoldenDatasetPage';
import { cn } from '@/lib/utils';

/** Read-only reference card explaining precision-vs-recall trade-offs and how
 *  to use the per-field priority toggle. */
export function MetricConfigPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageIntro
        title="Metric Configuration"
        subtitle="How to decide, per field, whether precision or recall matters more in production."
      />

      <LeadCard />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TradeoffCard
          tone="precision"
          icon={<Filter className="h-4 w-4" />}
          title="Over-extraction is worse"
          subtitle="Too many false positives → prioritize precision"
          example="Extracting the wrong IBAN and auto-paying."
          guidance="Require high confidence, accept lower recall, and track field-level precision separately."
        />
        <TradeoffCard
          tone="recall"
          icon={<Network className="h-4 w-4" />}
          title="Under-extraction is worse"
          subtitle="Too many false negatives → prioritize recall"
          example="Indexing contracts for legal search where missing clauses are unacceptable."
          guidance="Lower thresholds to capture more candidates and rely on humans to filter false positives."
        />
      </div>

      <PracticeCard />
    </div>
  );
}

function LeadCard() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-emerald-500/10 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/10">
          <Target className="h-5 w-5 text-foreground" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-foreground">
            For each field, ask: what is worse in production?
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Precision and recall are inversely coupled — improving one usually costs the other.
            Configure the priority per field on the Golden Dataset page to reflect the real-world
            cost of mistakes for that specific extraction.
          </p>
        </div>
      </div>
    </div>
  );
}

function TradeoffCard({
  tone,
  icon,
  title,
  subtitle,
  example,
  guidance,
}: {
  tone: 'precision' | 'recall';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  example: string;
  guidance: string;
}) {
  const isRecall = tone === 'recall';
  const accent = isRecall ? 'text-sky-700 dark:text-sky-300' : 'text-amber-700 dark:text-amber-300';
  const chip = isRecall
    ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md border',
            chip
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-foreground">{title}</h4>
          <p className={cn('text-[11px] font-semibold', accent)}>{subtitle}</p>
        </div>
      </div>

      <Callout label="Example" tone={tone}>
        {example}
      </Callout>

      <p className="text-xs leading-relaxed text-muted-foreground">{guidance}</p>
    </div>
  );
}

function Callout({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'precision' | 'recall';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'recall'
      ? 'border-sky-500/20 bg-sky-500/5'
      : 'border-amber-500/20 bg-amber-500/5';
  const labelCls = tone === 'recall' ? 'text-sky-700 dark:text-sky-300' : 'text-amber-700 dark:text-amber-300';
  return (
    <div className={cn('rounded-lg border px-3 py-2', cls)}>
      <p className={cn('text-[10px] font-semibold uppercase tracking-wider', labelCls)}>
        {label}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

function PracticeCard() {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <Gauge className="h-4 w-4" />
        </span>
        <h4 className="text-sm font-bold text-foreground">In practice</h4>
      </div>
      <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
          Always compute <span className="font-semibold text-foreground">both</span> precision and
          recall — the Dashboard shows every metric regardless of the chosen priority.
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
          Tune thresholds and post-processing to hit target bands.
        </li>
      </ul>
      <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
        <p className="text-xs leading-relaxed text-foreground">
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">Target band example:</span> an{' '}
          <span className="font-mono">amount</span> field must reach{' '}
          <span className="font-mono">≥ 99% recall</span> and{' '}
          <span className="font-mono">≥ 98% precision</span> on the validation set.
        </p>
      </div>
    </div>
  );
}
