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
      <div className="flex h-28 items-end gap-1.5">
        {bins.map((b) => (
          <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="font-mono text-[10px] text-muted-foreground">{b.count}</span>
            <div
              className="w-full max-w-[36px] rounded-t-sm transition-all"
              style={{
                height: `${Math.max(4, (b.count / max) * 100)}%`,
                background: accent,
                opacity: 0.35 + (b.count / max) * 0.65,
              }}
              title={`${b.label}: ${b.count}`}
            />
            <span className="truncate text-[9px] text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
