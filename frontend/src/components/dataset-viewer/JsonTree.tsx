import { createContext, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, ChevronRight, Loader2, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { NOT_FOUND } from '@/lib/dataset';

/**
 * Recursive key-value JSON renderer for the Dataset Viewer (sub-issue #11).
 * No <pre>/<code>; nested objects/arrays are collapsible with item-count
 * badges. Leaves whose local path is in `editablePaths` render an inline
 * editor (sub-issue #12) via {@link EditableValue}.
 */

type NodeKind = 'scalar' | 'array' | 'object';

interface TreeContextValue {
  accent: string;
  editablePaths?: Set<string>;
  onSave?: (path: string[], value: unknown) => Promise<void>;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('JsonTree nodes must be rendered inside <JsonTree>');
  return ctx;
}

function kindOf(v: unknown): NodeKind {
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'scalar';
}

export interface JsonTreeProps {
  data: unknown;
  /** Hex color used for keys, badges, and numeric values. */
  accent?: string;
  className?: string;
  /** Local path keys (dot-joined) whose node should render the inline editor. */
  editablePaths?: Set<string>;
  /** Called with the (local) path + new value when an edit is confirmed. */
  onSave?: (path: string[], value: unknown) => Promise<void>;
}

export function JsonTree({ data, accent = '#10B981', className, editablePaths, onSave }: JsonTreeProps) {
  return (
    <TreeContext.Provider value={{ accent, editablePaths, onSave }}>
      <div className={cn('flex flex-col', className)}>
        <ValueNode value={data} path={[]} label={undefined} depth={0} />
      </div>
    </TreeContext.Provider>
  );
}

interface NodeProps {
  value: unknown;
  path: string[];
  label?: string;
  depth: number;
}

function ValueNode({ value, path, label, depth }: NodeProps) {
  const ctx = useContext(TreeContext);
  const editable = !!ctx?.editablePaths?.has(path.join('.')) && !!ctx?.onSave;
  if (editable) return <EditableValue value={value} path={path} label={label} depth={depth} />;
  return <ValueDisplay value={value} path={path} label={label} depth={depth} />;
}

/** Pure (read-only) rendering of a single node. Shared by viewer + editor idle. */
function ValueDisplay({ value, path, label, depth }: NodeProps) {
  const kind = kindOf(value);
  if (kind === 'array' || kind === 'object') {
    return <CollapsibleNode value={value} path={path} label={label} depth={depth} kind={kind} />;
  }
  return <ScalarRow label={label} value={value} />;
}

function ScalarRow({ label, value }: { label?: string; value: unknown }) {
  return (
    <div className="flex items-baseline gap-1.5 py-0.5">
      {label !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{label}:</span>
      )}
      <ScalarValue value={value} />
    </div>
  );
}

function ScalarValue({ value }: { value: unknown }) {
  const { accent } = useTree();
  if (value === null || value === undefined) {
    return <span className="font-mono text-xs italic text-muted-foreground/60">null</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold',
          value ? 'bg-emerald-400/15 text-emerald-400' : 'bg-rose-400/15 text-rose-400',
        )}
      >
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'number') {
    return (
      <span className="font-mono text-sm font-medium" style={{ color: accent }}>
        {value}
      </span>
    );
  }
  const str = String(value);
  if (str === '' || str === NOT_FOUND) {
    return (
      <span className="font-mono text-xs italic text-muted-foreground/60">
        {str === '' ? 'empty' : NOT_FOUND}
      </span>
    );
  }
  return <span className="break-all font-mono text-sm text-foreground">{str}</span>;
}

interface CollapsibleNodeProps extends NodeProps {
  kind: 'array' | 'object';
}

function CollapsibleNode({ value, path, label, depth, kind }: CollapsibleNodeProps) {
  const { accent } = useTree();
  const [open, setOpen] = useState(true);
  const isArray = kind === 'array';
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  const countLabel = `${entries.length} ${isArray ? 'items' : 'keys'}`;

  // Root container (path.length === 0): render children directly, always open, no toggle.
  if (path.length === 0) {
    if (entries.length === 0) {
      return <span className="font-mono text-xs text-muted-foreground/60">{openBracket}{closeBracket}</span>;
    }
    return (
      <div className="flex flex-col">
        {entries.map(([k, v]) => (
          <ValueNode key={k} value={v} path={[...path, k]} label={isArray ? undefined : k} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5">
        {label !== undefined && <span className="font-mono text-xs text-muted-foreground">{label}:</span>}
        <span className="font-mono text-sm text-muted-foreground/70">{openBracket}{closeBracket}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded py-0.5 text-left transition-colors hover:bg-background/40"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        {label !== undefined && (
          <span className="font-mono text-xs font-semibold" style={{ color: accent }}>
            {label}:
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground/70">{openBracket}</span>
        <span className="rounded-full bg-muted/50 px-1.5 py-px text-[10px] text-muted-foreground">{countLabel}</span>
        {!open && <span className="font-mono text-xs text-muted-foreground/70">{closeBracket}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="ml-[5px] border-l border-border/50 pl-3">
              {entries.map(([k, v]) => (
                <ValueNode key={k} value={v} path={[...path, k]} label={isArray ? undefined : k} depth={depth + 1} />
              ))}
              <span className="font-mono text-xs text-muted-foreground/70">{closeBracket}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inline editor for an editable node (sub-issue #12). */
function EditableValue({ value, path, label, depth }: NodeProps) {
  const { accent, onSave } = useTree();
  const kind = kindOf(value);
  const isBoolean = kind === 'scalar' && typeof value === 'boolean';
  const isNumber = kind === 'scalar' && typeof value === 'number';
  const isContainer = kind === 'array' || kind === 'object';

  const [editing, setEditing] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [boolDraft, setBoolDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const displayLabel = label ?? path[path.length - 1] ?? 'value';

  const startEdit = () => {
    setError(null);
    if (isBoolean) setBoolDraft(Boolean(value));
    else setTextDraft(toInitialDraft(value, kind));
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const flashSuccess = () => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 800);
  };

  const commit = async (next: unknown) => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(path, next);
      setEditing(false);
      flashSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (saving) return;
    let parsed: unknown;
    try {
      if (isBoolean) {
        parsed = boolDraft;
      } else if (isNumber) {
        const n = Number(textDraft);
        if (textDraft.trim() === '' || Number.isNaN(n)) throw new Error('Must be a number.');
        parsed = n;
      } else if (isContainer) {
        parsed = parseContainer(textDraft, kind);
      } else {
        parsed = parseStringField(textDraft, path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid value');
      return;
    }
    await commit(parsed);
  };

  if (!editing) {
    return (
      <div className="group/edit relative flex items-start gap-1.5 rounded-md py-0.5 transition-colors">
        <div className="min-w-0 flex-1">
          <ValueDisplay value={value} path={path} label={label} depth={depth} />
        </div>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`Edit ${displayLabel}`}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover/edit:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-primary/40 bg-background/60 p-2 transition-colors',
        flash && 'border-emerald-400/50 bg-emerald-400/10',
      )}
    >
      {label !== undefined && (
        <span className="font-mono text-xs font-semibold" style={{ color: accent }}>
          {label}:
        </span>
      )}

      {isBoolean ? (
        <div className="flex items-center gap-2">
          <Switch checked={boolDraft} onCheckedChange={setBoolDraft} disabled={saving} />
          <span className="font-mono text-xs text-muted-foreground">{String(boolDraft)}</span>
        </div>
      ) : isContainer ? (
        <Textarea
          autoFocus
          value={textDraft}
          spellCheck={false}
          disabled={saving}
          onChange={(e) => setTextDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void confirm();
            if (e.key === 'Escape') cancel();
          }}
          className="min-h-[80px] resize-y font-mono text-xs"
        />
      ) : (
        <Input
          autoFocus
          type={isNumber ? 'number' : 'text'}
          value={textDraft}
          spellCheck={false}
          disabled={saving}
          onChange={(e) => setTextDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirm();
            if (e.key === 'Escape') cancel();
          }}
          className="h-8 font-mono text-xs"
        />
      )}

      {error && (
        <p className="flex items-center gap-1 text-[11px] text-rose-400">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving}
          aria-label="Confirm edit"
          className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-500/15 text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel edit"
          className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted/50 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {isContainer && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            {kind === 'array' ? 'one item per line' : 'valid JSON object'}
          </span>
        )}
      </div>
    </div>
  );
}

function toInitialDraft(value: unknown, kind: NodeKind): string {
  if (kind === 'array') return (value as string[]).join('\n');
  if (kind === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function parseContainer(draft: string, kind: 'array' | 'object'): unknown {
  if (kind === 'array') {
    return draft
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch {
    throw new Error('Invalid JSON object.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Value must be a JSON object.');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[String(k)] = String(v).trim();
  }
  return out;
}

/**
 * Validate a scalar string edit. The dataset `name` must stay non-empty.
 * Golden string fields use the "not_found" sentinel when blank.
 */
function parseStringField(draft: string, path: string[]): string {
  const trimmed = draft.trim();
  const last = path[path.length - 1];
  if (path[0] === 'name') {
    if (trimmed.length === 0) throw new Error('Name cannot be empty.');
    return trimmed;
  }
  if (last === 'difficulty' || last === 'source') return trimmed;
  return trimmed.length === 0 ? NOT_FOUND : trimmed;
}
