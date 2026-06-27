import { cn } from '@/lib/utils';
import { scoreBand } from '@/lib/metrics';

interface ScoreBadgeProps {
  /** Score in [0, 1]. */
  value: number;
  /** When false, render a neutral placeholder instead of a colored score. */
  hasData?: boolean;
  className?: string;
}

const BAND_STYLES: Record<
  ReturnType<typeof scoreBand>,
  { cls: string; dot: string }
> = {
  green: {
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  amber: {
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  red: {
    cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
};

/** Compact color-coded score label: >=0.95 green, 0.80–0.94 amber, <0.80 red. */
export function ScoreBadge({ value, hasData = true, className }: ScoreBadgeProps) {
  if (!hasData) {
    return (
      <span
        className={cn(
          'inline-flex min-w-[3.5rem] items-center justify-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground',
          className
        )}
      >
        —
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(1, value));
  const band = scoreBand(clamped);
  const { cls, dot } = BAND_STYLES[band];
  return (
    <span
      className={cn(
        'inline-flex min-w-[3.5rem] items-center justify-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs font-semibold',
        cls,
        className
      )}
      title={`${(clamped * 100).toFixed(0)}%`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {(clamped * 100).toFixed(0)}%
    </span>
  );
}
