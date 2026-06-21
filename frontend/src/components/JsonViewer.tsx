import { useEffect, useRef, useState } from 'react';
import { type GoldenValue } from '@/lib/dataset';

interface JsonViewerProps {
  data: Record<string, GoldenValue>;
  accent: string;
  /** Stream the text in like a terminal instead of appearing instantly. */
  typewriter?: boolean;
  className?: string;
}

/**
 * Syntax-highlighted JSON view of a model's extracted record. Strings are
 * rendered in the column's accent color, arrays/brackets in white, keys in
 * muted. Optional typewriter reveal that always finishes within ~1.5s.
 */
export function JsonViewer({ data, accent, typewriter = false, className }: JsonViewerProps) {
  const fullText = JSON.stringify(data, null, 2);
  if (typewriter) {
    return <Typewriter text={fullText} accent={accent} className={className} />;
  }
  return <HighlightedJson text={fullText} accent={accent} className={className} />;
}

function HighlightedJson({
  text,
  accent,
  className,
}: {
  text: string;
  accent: string;
  className?: string;
}) {
  return (
    <pre className={`overflow-auto font-mono text-xs leading-relaxed text-foreground ${className ?? ''}`}>
      <code>{highlight(text, accent)}</code>
    </pre>
  );
}

function highlight(text: string, accent: string) {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block">
      {tokenize(line, accent)}
      {'\n'}
    </span>
  ));
}

function tokenize(line: string, accent: string) {
  const parts: React.ReactNode[] = [];
  const regex = /("(?:\\.|[^"\\])*")(\s*:\s*)?|(\{|\}|\[|\])|(\b-?\d+(?:\.\d+)?\b)|([^\s{}\[\],]+)/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(line)) !== null) {
    if (m[1] !== undefined) {
      const isKey = m[2] !== undefined;
      parts.push(
        isKey ? (
          <span key={key++} className="text-muted-foreground">
            {m[1]}
          </span>
        ) : (
          <span key={key++} style={{ color: accent }}>
            {m[1]}
          </span>
        )
      );
      if (m[2]) parts.push(<span key={key++}>{m[2]}</span>);
    } else if (m[3]) {
      parts.push(
        <span key={key++} className="text-foreground">
          {m[3]}
        </span>
      );
    } else if (m[4]) {
      parts.push(
        <span key={key++} className="text-muted-foreground">
          {m[4]}
        </span>
      );
    } else if (m[5]) {
      parts.push(<span key={key++}>{m[5]}</span>);
    }
  }
  return parts;
}

function Typewriter({ text, accent, className }: { text: string; accent: string; className?: string }) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setCount(0);
    const total = text.length;
    const durationMs = 1400;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setCount(Math.floor(total * t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [text]);

  return (
    <pre className={`overflow-hidden font-mono text-xs leading-relaxed text-foreground ${className ?? ''}`}>
      <code>{highlight(text.slice(0, count), accent)}</code>
      <span className="inline-block w-2 animate-pulse" style={{ color: accent }}>
        ▋
      </span>
    </pre>
  );
}
