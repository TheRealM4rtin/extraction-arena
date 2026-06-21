import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Minus, ChevronRight } from 'lucide-react';
import { type GoldenDataset, type GoldenValue, valueKind } from '@/lib/dataset';
import { type FieldScore, isAbsentValue, normalizeStr } from '@/lib/scoring';
import { cn } from '@/lib/utils';

type DiffPart = { text: string; type: 'equal' | 'removed' | 'added' };

function toWords(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Word-level LCS diff. `golden` is the baseline; `actual` is the model output. */
function diffWords(golden: string, actual: string): { golden: DiffPart[]; actual: DiffPart[] } {
  const g = toWords(golden);
  const a = toWords(actual);
  const gn = g.map(normalizeStr);
  const an = a.map(normalizeStr);
  const n = g.length;
  const k = a.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = k - 1; j >= 0; j--) {
      dp[i][j] = gn[i] === an[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const goldenParts: DiffPart[] = [];
  const actualParts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < k) {
    if (gn[i] === an[j]) {
      goldenParts.push({ text: g[i], type: 'equal' });
      actualParts.push({ text: a[j], type: 'equal' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      goldenParts.push({ text: g[i], type: 'removed' });
      i++;
    } else {
      actualParts.push({ text: a[j], type: 'added' });
      j++;
    }
  }
  while (i < n) {
    goldenParts.push({ text: g[i], type: 'removed' });
    i++;
  }
  while (j < k) {
    actualParts.push({ text: a[j], type: 'added' });
    j++;
  }
  return { golden: goldenParts, actual: actualParts };
}

function DiffLine({ parts, side }: { parts: DiffPart[]; side: 'golden' | 'actual' }) {
  if (parts.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-1 gap-y-0.5">
      {parts.map((p, idx) => {
        if (p.type === 'equal') {
          return (
            <span key={idx} className="text-foreground">
              {p.text}
            </span>
          );
        }
        // 'removed' only appears on the golden side (missing from actual);
        // 'added' only appears on the actual side (extra vs golden).
        if (side === 'golden') {
          return (
            <span
              key={idx}
              className="rounded bg-amber-400/20 px-0.5 text-amber-200 line-through decoration-amber-400/60"
            >
              {p.text}
            </span>
          );
        }
        return (
          <span key={idx} className="rounded bg-rose-500/25 px-0.5 text-rose-200">
            {p.text}
          </span>
        );
      })}
    </span>
  );
}

function AbsentNote({ label }: { label: string }) {
  return <span className="italic text-muted-foreground">{label}</span>;
}

function StringDiff({ golden, actual }: { golden: string; actual: string }) {
  const gAbsent = isAbsentValue(golden);
  const aAbsent = isAbsentValue(actual);
  if (gAbsent && aAbsent) {
    return (
      <DiffPane label="Both absent" tone="match">
        <AbsentNote label="(both not found)" />
      </DiffPane>
    );
  }
  const { golden: gParts, actual: aParts } = diffWords(
    gAbsent ? '' : String(golden),
    aAbsent ? '' : String(actual),
  );
  return (
    <>
      <DiffPane label="Ground truth" tone="golden">
        {gAbsent ? <AbsentNote label="(not found)" /> : <DiffLine parts={gParts} side="golden" />}
      </DiffPane>
      <DiffPane label="Actual" tone="actual">
        {aAbsent ? <AbsentNote label="(not found)" /> : <DiffLine parts={aParts} side="actual" />}
      </DiffPane>
    </>
  );
}

function ItemRow({
  status,
  children,
}: {
  status: 'match' | 'missing' | 'extra';
  children: React.ReactNode;
}) {
  const tone =
    status === 'match'
      ? 'text-emerald-300'
      : status === 'missing'
        ? 'text-amber-200'
        : 'text-rose-200';
  const mark = status === 'match' ? '=' : status === 'missing' ? '-' : '+';
  return (
    <div className="flex items-start gap-1.5">
      <span className={cn('shrink-0 font-mono', tone)}>{mark}</span>
      <span className="font-mono text-[11px] text-foreground">{children}</span>
    </div>
  );
}

function ArrayDiff({ golden, actual }: { golden: string[]; actual: string[] }) {
  const gSet = new Set(golden.map(normalizeStr));
  const aSet = new Set(actual.map(normalizeStr));
  return (
    <>
      <DiffPane label="Ground truth" tone="golden">
        {golden.length === 0 ? (
          <AbsentNote label="(empty)" />
        ) : (
          <div className="flex flex-col gap-0.5">
            {golden.map((item, idx) => (
              <ItemRow key={idx} status={aSet.has(normalizeStr(item)) ? 'match' : 'missing'}>
                {item}
              </ItemRow>
            ))}
          </div>
        )}
      </DiffPane>
      <DiffPane label="Actual" tone="actual">
        {actual.length === 0 ? (
          <AbsentNote label="(empty)" />
        ) : (
          <div className="flex flex-col gap-0.5">
            {actual.map((item, idx) => (
              <ItemRow key={idx} status={gSet.has(normalizeStr(item)) ? 'match' : 'extra'}>
                {item}
              </ItemRow>
            ))}
          </div>
        )}
      </DiffPane>
    </>
  );
}

function ObjectDiff({
  golden,
  actual,
}: {
  golden: Record<string, string>;
  actual: Record<string, string>;
}) {
  const keys = Array.from(new Set([...Object.keys(golden), ...Object.keys(actual)])).sort();
  return (
    <>
      <DiffPane label="Ground truth" tone="golden">
        {keys.length === 0 ? (
          <AbsentNote label="(empty)" />
        ) : (
          <div className="flex flex-col gap-0.5">
            {keys.map((k) => {
              const inGolden = k in golden;
              const matched = inGolden && k in actual && normalizeStr(actual[k]) === normalizeStr(golden[k]);
              return (
                <ItemRow key={k} status={matched ? 'match' : inGolden ? 'missing' : 'extra'}>
                  <span className="text-muted-foreground">{k}:</span> {inGolden ? golden[k] : <span className="text-rose-300">{actual[k]}</span>}
                </ItemRow>
              );
            })}
          </div>
        )}
      </DiffPane>
      <DiffPane label="Actual" tone="actual">
        {keys.length === 0 ? (
          <AbsentNote label="(empty)" />
        ) : (
          <div className="flex flex-col gap-0.5">
            {keys.map((k) => {
              const inActual = k in actual;
              const matched = inActual && k in golden && normalizeStr(actual[k]) === normalizeStr(golden[k]);
              return (
                <ItemRow key={k} status={matched ? 'match' : inActual ? 'extra' : 'missing'}>
                  <span className="text-muted-foreground">{k}:</span> {inActual ? actual[k] : <span className="italic text-muted-foreground">—</span>}
                </ItemRow>
              );
            })}
          </div>
        )}
      </DiffPane>
    </>
  );
}

function DiffPane({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'golden' | 'actual' | 'match';
  children: React.ReactNode;
}) {
  const color =
    tone === 'golden' ? 'text-gt' : tone === 'actual' ? 'text-muted-foreground' : 'text-emerald-500 dark:text-emerald-300';
  const border = tone === 'golden' ? 'border-gt/20 bg-gt/5' : 'border-border bg-background/60';
  return (
    <div className={cn('rounded-md border px-2 py-1.5', border)}>
      <p className={cn('mb-1 text-[10px] font-semibold uppercase tracking-wider', color)}>{label}</p>
      <div className="font-mono text-[11px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function DiffBody({ golden, actual }: { golden: GoldenValue; actual: GoldenValue }) {
  const kind = valueKind(golden);
  if (kind === 'array') {
    return <ArrayDiff golden={golden as string[]} actual={actual as string[]} />;
  }
  if (kind === 'object') {
    return (
      <ObjectDiff
        golden={golden as Record<string, string>}
        actual={(actual as Record<string, string>) ?? {}}
      />
    );
  }
  return <StringDiff golden={golden as string} actual={actual as string} />;
}

interface FieldDiffListProps {
  fields: FieldScore[];
  data: Record<string, GoldenValue>;
  golden: GoldenDataset;
  accent: string;
}

/** Expandable per-field rows. Collapsed = status + label; expanded = ground-truth/actual diff. */
export function FieldDiffList({ fields, data, golden, accent }: FieldDiffListProps) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="flex flex-col gap-1">
      {fields.map((f) => {
        const isOpen = open === f.key;
        const isPartial = !f.match && f.partial > 0;
        const goldenValue = golden.golden_extraction[f.key]?.value;
        const actual = data[f.key];
        return (
          <li key={f.key} className="overflow-hidden rounded-md bg-background/60">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : f.key)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-background/80"
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90',
                )}
              />
              <span className="shrink-0">
                {f.match ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : isPartial ? (
                  <Minus className="h-4 w-4 text-amber-400" />
                ) : (
                  <X className="h-4 w-4 text-rose-400" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {f.label}
              </span>
              {!f.match && (
                <span
                  className="shrink-0 font-mono text-[10px]"
                  style={{ color: isPartial ? '#fbbf24' : '#fb7185' }}
                >
                  {isPartial ? `${Math.round(f.partial * 100)}%` : 'miss'}
                </span>
              )}
              {f.match && (
                <span className="shrink-0 font-mono text-[10px] text-emerald-400">ok</span>
              )}
              <span
                className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: accent, opacity: 0.5 }}
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 gap-1.5 px-2 pb-2 pt-0.5">
                    <DiffBody golden={goldenValue} actual={actual} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
