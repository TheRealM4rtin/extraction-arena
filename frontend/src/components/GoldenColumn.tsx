import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Layers3, Tag } from 'lucide-react';
import { type GoldenDataset, type GoldenValue, humanLabel, valueKind } from '@/lib/dataset';
import { useAppStore } from '@/store';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Read-only Ground Truth column. The golden dataset is provided at creation
 * time (uploaded JSON), not hand-edited here — this displays the reference
 * fields each model is scored against, with their difficulty + source metadata.
 *
 * Each cell subscribes to the global open-field refcount: while any model
 * column has a field's diff pane open, the matching cell here lifts forward
 * with a glass/glow highlight, and scrolls into view the moment it is opened.
 */
export function GoldenColumn() {
  const golden: GoldenDataset | null = useAppStore((s) => s.active?.golden ?? null);
  if (!golden) return null;

  const entries = Object.entries(golden.golden_extraction);
  const hints = golden.model_evaluation_hints;

  return (
    <div className="flex flex-col gap-2 px-3 pb-4">
      {entries.map(([key, field], i) => (
        <GoldenCell key={key} fieldKey={key} field={field} index={i} />
      ))}

      {hints?.why_they_fail && (
        <div className="mt-1 rounded-lg border border-gt/20 bg-gt/5 p-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-gt">
            <Layers3 className="h-3.5 w-3.5" /> Eval note
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{hints.why_they_fail}</p>
        </div>
      )}
    </div>
  );
}

/**
 * One golden field card. While any model column has this field's pane open
 * (`openFieldRefs[fieldKey] > 0`) the card lifts forward: an emerald border,
 * a faint glass tint, a soft accent glow, and a slight scale-up so it reads
 * as "in front" of its siblings. The highlight persists until the last column
 * closes the pane.
 *
 * The `expandedField` nonce fires once per fresh open (refcount 0 → 1); the
 * matching cell reacts by scrolling itself into view. `prefers-reduced-motion`
 * is honoured (instant scroll, no spring). The scale and shadow are static
 * states (not looping motion), so they remain for reduced-motion users.
 */
function GoldenCell({
  fieldKey,
  field,
  index,
}: {
  fieldKey: string;
  field: { value: GoldenValue; difficulty?: string; source?: string };
  index: number;
}) {
  const isHighlighted = useAppStore((s) => (s.openFieldRefs[fieldKey] ?? 0) > 0);
  const expandedKey = useAppStore((s) => s.expandedField.key);
  const expandedNonce = useAppStore((s) => s.expandedField.nonce);
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expandedKey !== fieldKey || !cellRef.current) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cellRef.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [expandedNonce, expandedKey, fieldKey]);

  return (
    <motion.div
      ref={cellRef}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0, scale: isHighlighted ? 1.02 : 1 }}
      transition={{
        opacity: { delay: Math.min(index * 0.03, 0.4) },
        x: { delay: Math.min(index * 0.03, 0.4) },
        scale: { type: 'spring', stiffness: 320, damping: 22 },
      }}
      className={cn(
        'relative rounded-lg bg-background/60 p-2.5 transition-[background-color,border-color,box-shadow] duration-300',
        isHighlighted
          ? 'z-10 border border-gt/50 bg-gt/[0.07]'
          : 'border border-transparent',
      )}
      style={
        isHighlighted
          ? {
              boxShadow:
                '0 0 0 1px rgb(var(--gt) / 0.35), 0 16px 38px -10px rgb(var(--gt) / 0.4)',
            }
          : undefined
      }
    >
      <div className="relative">
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="text-xs font-bold text-gt">{humanLabel(fieldKey)}</p>
          {field.difficulty && (
            <Badge className="border-gt/30 bg-gt/10 text-[10px] text-gt">{field.difficulty}</Badge>
          )}
        </div>
        <FieldValue value={field.value} />
        {field.source && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Tag className="h-3 w-3" />
            {field.source}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function FieldValue({ value }: { value: GoldenValue }) {
  const kind = valueKind(value);

  if (kind === 'array') {
    const arr = value as string[];
    if (arr.length === 0) return <p className="font-mono text-sm text-muted-foreground">—</p>;
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
    if (entries.length === 0) return <p className="font-mono text-sm text-muted-foreground">—</p>;
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
  return (
    <p className="font-mono text-sm leading-relaxed text-foreground">
      {str === 'not_found' || str === '' ? <span className="text-muted-foreground">—</span> : str}
    </p>
  );
}
