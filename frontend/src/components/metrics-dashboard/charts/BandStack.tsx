import { cn } from '@/lib/utils';

interface BandStackProps {
  green: number;
  amber: number;
  red: number;
  title?: string;
  className?: string;
}

/** Stacked horizontal bar of F1 score bands. */
export function BandStack({ green, amber, red, title, className }: BandStackProps) {
  const total = Math.max(1, green + amber + red);
  const segments = [
    { key: 'green', n: green, color: '#10B981', label: '≥95%' },
    { key: 'amber', n: amber, color: '#F59E0B', label: '80–94%' },
    { key: 'red', n: red, color: '#F43F5E', label: '<80%' },
  ];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {title && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {segments.map((s) =>
          s.n > 0 ? (
            <div
              key={s.key}
              style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.n}`}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}: <span className="font-mono text-foreground">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
