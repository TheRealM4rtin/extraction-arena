import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutDashboard,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import { DashboardPage } from './DashboardPage';
import { GoldenDatasetPage } from './GoldenDatasetPage';

interface MetricsDashboardProps {
  open: boolean;
  onClose: () => void;
}

type PageId = 'dashboard' | 'golden';

const NAV: Array<{ id: PageId; label: string; icon: React.ReactNode; hint: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, hint: 'Same engine as main UI — KPIs, charts, fields' },
  { id: 'golden', label: 'Golden Dataset', icon: <Database className="h-4 w-4" />, hint: 'Ground truth & evaluation config' },
];

/** Fullscreen Evaluation Dashboard. Same overlay/scroll-lock/Escape pattern as
 *  the Dataset Viewer. Collapsible left sidebar routes between the Dashboard
 *  and Golden Dataset pages. */
export function MetricsDashboard({ open, onClose }: MetricsDashboardProps) {
  const active = useAppStore((s) => s.active);
  const [page, setPage] = useState<PageId>('dashboard');
  const [collapsed, setCollapsed] = useState(false);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Metrics Dashboard"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background"
          >
            {/* Top bar */}
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-violet-500/20">
                <BarChart3 className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Evaluation Dashboard
                </h2>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {active ? active.name : 'No dataset selected'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close metrics dashboard"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-foreground/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body: sidebar + page */}
            <div className="flex min-h-0 flex-1">
              <Sidebar
                collapsed={collapsed}
                onToggle={() => setCollapsed((v) => !v)}
                page={page}
                onNavigate={setPage}
              />
              <div className="min-w-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
                  {active ? (
                    page === 'dashboard' ? (
                      <DashboardPage />
                    ) : (
                      <GoldenDatasetPage golden={active.golden} />
                    )
                  ) : (
                    <EmptyState />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  page,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  page: PageId;
  onNavigate: (p: PageId) => void;
}) {
  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className="flex min-h-0 shrink-0 flex-col border-r border-border bg-background/40"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex h-11 items-center gap-2 border-b border-border text-muted-foreground transition-colors hover:text-foreground',
          collapsed ? 'justify-center' : 'px-3'
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <>
            <ChevronLeft className="h-4 w-4 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Navigate</span>
          </>
        )}
      </button>

      <nav className="flex flex-col gap-1 p-2">
        {NAV.map((item) => {
          const active = item.id === page;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                active
                  ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 shadow-[inset_0_0_0_1px_rgb(6_182_212_/_0.25)]'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                collapsed && 'justify-center'
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{item.label}</span>
                  <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground/70">
                    {item.hint}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </motion.aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 text-center">
      <Database className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-semibold text-foreground">No dataset selected</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Create or select a dataset to view its golden schema and per-field metrics.
      </p>
    </div>
  );
}
