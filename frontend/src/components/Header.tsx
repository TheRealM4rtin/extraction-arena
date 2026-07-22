import { useEffect, useState } from 'react';
import { Settings, CircleDot, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenMetrics: () => void;
}

/** Fixed top bar: gradient logo, live clock, and per-service status dots. */
export function Header({ onOpenSettings, onOpenMetrics }: HeaderProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-5 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 font-black text-black">
          E
        </div>
        <h1 className="bg-gradient-to-r from-cyan-300 via-violet-300 to-emerald-300 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
          Extraction Arena
        </h1>
      </div>

      {/* Centered Metrics button — absolutely positioned so it stays centered
          regardless of the side groups' widths. */}
      <button
        type="button"
        onClick={onOpenMetrics}
        className="group absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-1.5 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:border-cyan-400/50 hover:text-cyan-700 dark:hover:text-cyan-300 md:flex"
        aria-label="Open metrics dashboard"
      >
        <BarChart3 className="h-4 w-4 transition-transform group-hover:scale-110" />
        Metrics
      </button>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-3 sm:flex">
          <StatusDot label="Dataset" color="#10B981" />
          <StatusDot label="GLM" color="#06B6D4" />
          <StatusDot label="GPT" color="#8B5CF6" />
          <StatusDot label="Grok" color="#F43F5E" />
        </div>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <Button variant="ghost" size="icon" onClick={onOpenMetrics} aria-label="Metrics" className="md:hidden">
          <BarChart3 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

function StatusDot({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <CircleDot className="h-3 w-3 animate-pulse" style={{ color }} />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}
