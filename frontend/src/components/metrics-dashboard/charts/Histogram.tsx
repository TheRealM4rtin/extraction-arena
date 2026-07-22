import { cn } from '@/lib/utils';

export interface HistBin {
  label: string;
  count: number;
}

interface HistogramProps {
  bins: HistBin[];
  accent?: string;
  title?: string;
  className?: string;
}

/** Lightweight CSS column histogram (no chart library). */
export function Histogram({
  bins,
  accent = '#06B6D4',
  title,
  className,
}: HistogramProps) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {title && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      {/*
        Fixed-height plot area so bar heights can be percentages of a real
        containing block. (Percentage height on a flex column that only
        sizes to its content collapses to 0.)
      */}
      <div className="flex h-28 items-stretch gap-1.5">
        {bins.map((b) => {
          const ratio = b.count / max;
          // Empty bins keep a thin baseline so the chart shape stays readable.
          const barPct = b.count === 0 ? 2 : Math.max(8, ratio * 100);
          return (
            <div
              key={b.label}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <span className="shrink-0 font-mono text-[10px] leading-none text-muted-foreground">
                {b.count}
              </span>
              <div className="mt-1 flex w-full min-h-0 flex-1 flex-col justify-end items-center">
                <div
                  className="w-full max-w-[36px] rounded-t-sm transition-all"
                  style={{
                    height: `${barPct}%`,
                    background: accent,
                    opacity: b.count === 0 ? 0.2 : 0.35 + ratio * 0.65,
                  }}
                  title={`${b.label}: ${b.count}`}
                />
              </div>
              <span className="mt-1 shrink-0 truncate text-[9px] leading-none text-muted-foreground">
                {b.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
