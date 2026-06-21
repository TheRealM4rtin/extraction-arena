import { useCallback } from 'react';
import { runDoclingPipeline } from '@/lib/api';
import {
  expectedKinds,
  type GoldenValue,
  humanLabel,
  type ValueKind,
} from '@/lib/dataset';
import { useAppStore } from '@/store';

/**
 * Local Docling baseline. The backend runs a DocTags-native VLM through MLX,
 * returns the structured DoclingDocument JSON plus markdown/text, then we map
 * that text onto the dataset schema using the field keys only.
 *
 * Honors the model toggle in the store: if Docling is disabled, `run` is a no-op.
 */
export function useDocling() {
  const active = useAppStore((s) => s.active);
  const enabled = useAppStore((s) => s.enabledModels.docling);
  const setDocling = useAppStore((s) => s.setDocling);

  const run = useCallback(async () => {
    if (!enabled) return null;
    if (!active) throw new Error('No dataset selected.');
    const pages = active.pages;
    if (pages.length === 0) throw new Error('This dataset has no pages.');

    const kinds = expectedKinds(active.golden);
    setDocling({
      status: 'loading',
      rawText: '',
      extracted: {},
      document: null,
      model: '',
      error: undefined,
    });
    const startedAt = performance.now();

    try {
      const result = await runDoclingPipeline(pages);
      const text = result.text.trim();
      const extracted = keywordExtract(text, kinds);
      setDocling({
        rawText: text,
        extracted,
        document: result.document,
        model: result.document.model,
        elapsedMs: performance.now() - startedAt,
        status: 'done',
      });
      return { text, extracted, document: result.document };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDocling({
        rawText: '',
        extracted: {},
        document: null,
        model: '',
        elapsedMs: performance.now() - startedAt,
        status: 'error',
        error: message,
      });
      throw error;
    }
  }, [active, enabled, setDocling]);

  return { run };
}

/** Dataset-keyed text extraction against Docling markdown/text. */
function keywordExtract(
  text: string,
  kinds: Record<string, ValueKind>
): Record<string, GoldenValue> {
  const out: Record<string, GoldenValue> = {};
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const [key, kind] of Object.entries(kinds)) {
    const keywords = keywordsFromKey(key);
    if (kind === 'object') {
      out[key] = {};
      continue;
    }
    if (kind === 'array') {
      const hits = lines
        .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)))
        .slice(0, 6);
      out[key] = hits;
      continue;
    }

    let best = '';
    for (const line of lines) {
      const lower = line.toLowerCase();
      const hit = keywords.find((kw) => lower.includes(kw));
      if (!hit) continue;

      const idx = lower.indexOf(hit);
      best = line.slice(idx + hit.length).replace(/^[\s:.\-]+/, '').trim() || line;
      break;
    }

    out[key] = best || 'not_found';
  }

  return out;
}

function keywordsFromKey(key: string): string[] {
  const label = humanLabel(key).toLowerCase();
  const words = label.split(' ').filter((word) => word.length >= 3);
  const significant = words.filter(
    (word) => !['the', 'and', 'for', 'with', 'from', 'location', 'locations'].includes(word)
  );
  const phrase = words.join(' ');
  return Array.from(new Set([phrase, ...significant]));
}
