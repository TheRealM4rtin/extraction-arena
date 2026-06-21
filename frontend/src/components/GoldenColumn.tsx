import { motion } from 'framer-motion';
import { Layers3, Tag } from 'lucide-react';
import { type GoldenDataset, type GoldenValue, humanLabel, valueKind } from '@/lib/dataset';
import { useAppStore } from '@/store';
import { Badge } from '@/components/ui/badge';

/**
 * Read-only Ground Truth column. The golden dataset is provided at creation
 * time (uploaded JSON), not hand-edited here — this displays the reference
 * fields each model is scored against, with their difficulty + source metadata.
 */
export function GoldenColumn() {
  const golden: GoldenDataset | null = useAppStore((s) => s.active?.golden ?? null);
  if (!golden) return null;

  const entries = Object.entries(golden.golden_extraction);
  const hints = golden.model_evaluation_hints;

  return (
    <div className="flex flex-col gap-2 px-3 pb-4">
      {entries.map(([key, field], i) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i * 0.03, 0.4) }}
          className="rounded-lg bg-background/60 p-2.5"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="text-xs font-bold text-gt">{humanLabel(key)}</p>
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
        </motion.div>
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
