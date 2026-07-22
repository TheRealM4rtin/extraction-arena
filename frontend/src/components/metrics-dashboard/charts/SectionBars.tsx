import { cn } from '@/lib/utils';

export interface SectionBar {
  section: string;
  value: number; // 0..1
  count: number;
}

interface SectionBarsProps {
  rows: SectionBar[];
  accent?: string;
  title?: string;
  className?: string;
}

/** Horizontal mean-score bars by path section. */
export function SectionBars({
  rows,
  accent = '#8B5CF6',
  title,
  className,
}: SectionBarsProps) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No section data yet.</p>
    );
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {title && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.section} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-foreground">
                {r.section}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {Math.round(r.value * 100)}% · {r.count}f
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(2, r.value * 100)}%`,
                  background: accent,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
