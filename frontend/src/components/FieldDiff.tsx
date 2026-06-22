import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Minus, ChevronRight } from 'lucide-react';
import { type GoldenDataset, type GoldenValue, valueKind } from '@/lib/dataset';
import { type FieldScore, isAbsentValue, normalizeStr } from '@/lib/scoring';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';

/**
 * Traffic-light palette for the unified diff in the "Actual" pane. Fixed
 * (column-independent) so the meaning of each color is consistent across
 * columns: green = matched, red+strikethrough = missing from actual, purple =
 * added in actual. Light and dark variants are picked for legibility on both
 * backgrounds.
 */
const EQUAL_CLASS = 'text-emerald-700 dark:text-emerald-400';
const REMOVED_CLASS = 'text-rose-700 dark:text-rose-400 line-through';
const ADDED_CLASS = 'text-purple-700 dark:text-purple-400';

type UnifiedToken = { text: string; type: 'equal' | 'removed' | 'added' };

function toWords(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/**
 * Word-level LCS unified diff. Walks both sequences and emits a single
 * ordered stream of tokens: `equal` (in both), `removed` (in golden only,
 * missing from actual), `added` (in actual only). Order is preserved so the
 * actual pane reads as a single sentence with inline annotations.
 */
function diffUnified(golden: string, actual: string): UnifiedToken[] {
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
  const tokens: UnifiedToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < k) {
    if (gn[i] === an[j]) {
      tokens.push({ text: g[i], type: 'equal' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: g[i], type: 'removed' });
      i++;
    } else {
      tokens.push({ text: a[j], type: 'added' });
      j++;
    }
  }
  while (i < n) {
    tokens.push({ text: g[i], type: 'removed' });
    i++;
  }
  while (j < k) {
    tokens.push({ text: a[j], type: 'added' });
    j++;
  }
  return tokens;
}

/** Normalized word set, used for best-match pairing of array items. */
function wordSet(s: string): Set<string> {
  return new Set(toWords(s).map(normalizeStr));
}

/** Jaccard-style overlap ratio in [0,1] for two word sets. */
function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
}

function AbsentNote({ label }: { label: string }) {
  return <span className="italic text-muted-foreground">{label}</span>;
}

/**
 * Inline word-level diff renderer. Each token is its own `<span>` colored by
 * status; tokens are joined with literal spaces (not flex gap) so the result
 * reads as flowing inline text on the same baseline as plain text. Used for
 * scalar strings, every object value, and every paired array item.
 */
function WordDiff({ golden, actual }: { golden: string; actual: string }) {
  const tokens = diffUnified(golden, actual);
  if (tokens.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {tokens.map((t, idx) => (
        <span
          key={idx}
          className={t.type === 'equal' ? EQUAL_CLASS : t.type === 'removed' ? REMOVED_CLASS : ADDED_CLASS}
        >
          {idx > 0 ? ' ' : ''}
          {t.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Ground-truth pane content: the golden value rendered verbatim, no diff, no
 * marks. Arrays/objects are laid out as plain rows so the structure is
 * scannable. Font + size come from the surrounding `DiffPane`.
 */
function PlainValue({ value }: { value: GoldenValue }) {
  const kind = valueKind(value);
  if (kind === 'array') {
    const arr = value as string[];
    if (arr.length === 0) return <AbsentNote label="(empty)" />;
    return (
      <div className="flex flex-col gap-0.5">
        {arr.map((item, idx) => (
          <div key={idx} className="text-foreground">
            {item}
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, string>);
    if (entries.length === 0) return <AbsentNote label="(empty)" />;
    return (
      <div className="flex flex-col gap-0.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground">{k}:</span>{' '}
            <span className="text-foreground">{v}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-foreground">{String(value)}</span>;
}

/**
 * Array diff with best-match pairing + per-pair word-level diff. For each
 * golden item, pick the unused actual item with the highest word-overlap; if
 * overlap ≥ 0.5, render a word-diff of the pair, otherwise mark the golden
 * item as missing (red strike). Unmatched actual items are appended in
 * purple (added). Mirrors the scorer's order-independent set semantics.
 */
function ArrayAnswer({ golden, actual }: { golden: string[]; actual: string[] }) {
  if (golden.length === 0 && actual.length === 0) return <AbsentNote label="(empty)" />;

  const gSets = golden.map(wordSet);
  const aSets = actual.map(wordSet);
  const usedActual = new Set<number>();

  type Row =
    | { kind: 'pair'; golden: string; actual: string }
    | { kind: 'missing'; text: string }
    | { kind: 'added'; text: string };
  const rows: Row[] = [];

  golden.forEach((g, gi) => {
    let bestJ = -1;
    let bestRatio = 0;
    actual.forEach((_, aj) => {
      if (usedActual.has(aj)) return;
      const r = overlapRatio(gSets[gi], aSets[aj]);
      if (r > bestRatio) {
        bestRatio = r;
        bestJ = aj;
      }
    });
    if (bestJ >= 0 && bestRatio >= 0.5) {
      usedActual.add(bestJ);
      rows.push({ kind: 'pair', golden: g, actual: actual[bestJ] });
    } else {
      rows.push({ kind: 'missing', text: g });
    }
  });
  actual.forEach((a, aj) => {
    if (!usedActual.has(aj)) rows.push({ kind: 'added', text: a });
  });

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row, idx) => {
        if (row.kind === 'pair') {
          return (
            <div key={idx}>
              <WordDiff golden={row.golden} actual={row.actual} />
            </div>
          );
        }
        return (
          <div key={idx} className={row.kind === 'missing' ? REMOVED_CLASS : ADDED_CLASS}>
            {row.text}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Object diff at the key level. For each key in the union of golden + actual:
 * - present in both → word-diff the two values
 * - golden only → render golden value with REMOVED_CLASS
 * - actual only → render actual value with ADDED_CLASS
 */
function ObjectAnswer({
  golden,
  actual,
}: {
  golden: Record<string, string>;
  actual: Record<string, string>;
}) {
  const keys = Array.from(new Set([...Object.keys(golden), ...Object.keys(actual)])).sort();
  if (keys.length === 0) return <AbsentNote label="(empty)" />;
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map((k) => {
        const inG = k in golden;
        const inA = k in actual;
        return (
          <div key={k}>
            <span className="text-muted-foreground">{k}:</span>{' '}
            {inG && inA ? (
              <WordDiff golden={golden[k]} actual={actual[k]} />
            ) : (
              <span className={inG ? REMOVED_CLASS : ADDED_CLASS}>{inG ? golden[k] : actual[k]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Whole-value "all added" fallback for the case where golden is absent. */
function AllAdded({ value }: { value: GoldenValue }) {
  const kind = valueKind(value);
  if (kind === 'array') {
    const arr = value as string[];
    if (arr.length === 0) return <AbsentNote label="(empty)" />;
    return (
      <div className="flex flex-col gap-0.5">
        {arr.map((item, idx) => (
          <div key={idx} className={ADDED_CLASS}>
            {item}
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, string>);
    if (entries.length === 0) return <AbsentNote label="(empty)" />;
    return (
      <div className="flex flex-col gap-0.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground">{k}:</span>{' '}
            <span className={ADDED_CLASS}>{v}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className={ADDED_CLASS}>{String(value)}</span>;
}

function AnswerBody({ golden, actual }: { golden: GoldenValue; actual: GoldenValue }) {
  const kind = valueKind(golden);
  if (kind === 'array') {
    return <ArrayAnswer golden={golden as string[]} actual={(actual as string[]) ?? []} />;
  }
  if (kind === 'object') {
    return (
      <ObjectAnswer
        golden={golden as Record<string, string>}
        actual={(actual as Record<string, string>) ?? {}}
      />
    );
  }
  return <WordDiff golden={golden as string} actual={actual as string} />;
}

/**
 * Two-pane layout. Ground truth = plain golden (no marks). Actual = unified
 * inline diff walked through the LCS alignment (green/red-strike/purple).
 * Font, text size, and per-tone border/background are preserved from the
 * original git-diff rendering.
 */
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
  const border =
    tone === 'golden'
      ? 'border-gt/20 bg-gt/5'
      : tone === 'actual'
        ? 'border-border bg-background/60'
        : 'border-emerald-500/20 bg-emerald-500/5 dark:border-emerald-300/20 dark:bg-emerald-300/5';
  return (
    <div className={cn('rounded-md border px-2 py-1.5', border)}>
      <p className={cn('mb-1 text-[10px] font-semibold uppercase tracking-wider', color)}>{label}</p>
      <div className="diff-text font-mono text-[11px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function DiffBody({ golden, actual }: { golden: GoldenValue; actual: GoldenValue }) {
  const gAbsent = isAbsentValue(golden);
  const aAbsent = isAbsentValue(actual);
  if (gAbsent && aAbsent) {
    return (
      <DiffPane label="Both absent" tone="match">
        <AbsentNote label="(both not found)" />
      </DiffPane>
    );
  }
  return (
    <>
      <DiffPane label="Ground truth" tone="golden">
        {gAbsent ? <AbsentNote label="(not found)" /> : <PlainValue value={golden} />}
      </DiffPane>
      <DiffPane label="Actual" tone="actual">
        {aAbsent ? (
          <AbsentNote label="(not found)" />
        ) : gAbsent ? (
          <AllAdded value={actual} />
        ) : (
          <AnswerBody golden={golden} actual={actual} />
        )}
      </DiffPane>
    </>
  );
}

interface FieldDiffListProps {
  fields: FieldScore[];
  data: Record<string, GoldenValue>;
  golden: GoldenDataset;
  accent: string;
}

/** Expandable per-field rows. Collapsed = status + label; expanded = ground-truth/actual panes. */
export function FieldDiffList({ fields, data, golden, accent }: FieldDiffListProps) {
  const [open, setOpen] = useState<string | null>(null);
  const setFieldOpen = useAppStore((s) => s.setFieldOpen);

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
              onClick={() => {
                if (isOpen) {
                  setOpen(null);
                  setFieldOpen(f.key, false);
                } else {
                  // Close the previously-open field (if any) so its Ground
                  // Truth refcount decrements before we open the new one.
                  if (open) setFieldOpen(open, false);
                  setOpen(f.key);
                  setFieldOpen(f.key, true);
                }
              }}
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
