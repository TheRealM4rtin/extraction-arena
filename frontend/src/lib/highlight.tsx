import type { ReactNode } from 'react';

/**
 * Shared accent-class lookup used by `JsonViewer` and `FieldDiff`.
 *
 * Per-column accent text is rendered via the Tailwind tokens (`text-gt`,
 * `text-glm`, `text-gpt`, `text-ocr`) rather than an inline `style` so the
 * color flips to a light-mode-safe shade via the CSS variables in `index.css`.
 * `marker` is the highlighter style for differing words/items: a soft accent
 * background plus accent text. Literal class names live here so Tailwind's
 * content scanner picks them up.
 */
const ACCENT_CLASSES: Record<string, { text: string; marker: string }> = {
  '#10B981': { text: 'text-gt', marker: 'bg-gt/20 text-gt' },
  '#06B6D4': { text: 'text-glm', marker: 'bg-glm/20 text-glm' },
  '#8B5CF6': { text: 'text-gpt', marker: 'bg-gpt/20 text-gpt' },
  '#F59E0B': { text: 'text-ocr', marker: 'bg-ocr/20 text-ocr' },
};

export function accentClasses(accent: string): { text: string; marker: string } {
  return ACCENT_CLASSES[accent] ?? { text: '', marker: '' };
}

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:\s*)?|(\{|\}|\[|\])|(\b-?\d+(?:\.\d+)?\b)|([^\s{}\[\],]+)/g;

/** Tokenize a single line of JSON-ish text into highlighted React nodes. */
export function tokenizeLine(line: string, accent: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const { text: textClass } = accentClasses(accent);
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m[1] !== undefined) {
      const isKey = m[2] !== undefined;
      parts.push(
        isKey ? (
          <span key={key++} className="text-muted-foreground">
            {m[1]}
          </span>
        ) : textClass ? (
          <span key={key++} className={textClass}>
            {m[1]}
          </span>
        ) : (
          <span key={key++} style={{ color: accent }}>
            {m[1]}
          </span>
        ),
      );
      if (m[2]) parts.push(<span key={key++}>{m[2]}</span>);
    } else if (m[3]) {
      parts.push(
        <span key={key++} className="text-foreground">
          {m[3]}
        </span>,
      );
    } else if (m[4]) {
      parts.push(
        <span key={key++} className="text-muted-foreground">
          {m[4]}
        </span>,
      );
    } else if (m[5]) {
      parts.push(
        <span key={key++} className="text-foreground">
          {m[5]}
        </span>,
      );
    }
  }
  return parts;
}

/** Highlight a multi-line block of JSON-ish text, one `<span block>` per line. */
export function highlightBlock(text: string, accent: string): ReactNode[] {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block">
      {tokenizeLine(line, accent)}
      {'\n'}
    </span>
  ));
}
