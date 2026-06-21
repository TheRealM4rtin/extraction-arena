import { motion } from 'framer-motion';
import { Plus, Trash2, Database, FileText, Hash, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DatasetManagerProps {
  onNew: () => void;
}

/** Sidebar: list of saved datasets (persisted locally), select / delete / create. */
export function DatasetManager({ onNew }: DatasetManagerProps) {
  const datasets = useAppStore((s) => s.datasets);
  const loading = useAppStore((s) => s.catalogLoading);
  const active = useAppStore((s) => s.active);
  const selectDataset = useAppStore((s) => s.selectDataset);
  const removeDataset = useAppStore((s) => s.removeDataset);

  return (
    <div className="glass flex flex-col rounded-2xl p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Datasets</h2>
        </div>
        <Button size="sm" variant="outline" onClick={onNew} className="gap-1.5 px-2.5">
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && datasets.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
          <Database className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No datasets yet.</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">Create one to start evaluating.</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {datasets.map((ds) => {
          const isActive = active?.id === ds.id;
          return (
            <motion.div
              key={ds.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors',
                isActive
                  ? 'border-cyan-400/50 bg-cyan-400/10 shadow-[0_0_12px_-4px_rgba(6,182,212,0.5)]'
                  : 'border-border bg-background/60 hover:border-border/80 hover:bg-background/80'
              )}
              onClick={() => selectDataset(ds.id)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{ds.name}</p>
                <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {ds.pageCount}p
                  </span>
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" /> {ds.fieldCount} fields
                  </span>
                  <span className="truncate">{ds.dpi} DPI</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void removeDataset(ds.id);
                }}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label={`Delete ${ds.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
