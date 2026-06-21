import { randomUUID } from 'node:crypto';

type LogMeta = Record<string, unknown>;

interface RequestLogger {
  id: string;
  log: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
}

interface VisionPayloadSummary {
  model: string;
  messageCount: number;
  textParts: number;
  imageCount: number;
}

export function createRequestLogger(scope: string): RequestLogger {
  const id = randomUUID().slice(0, 8);

  return {
    id,
    log: (message, meta) => writeLog('log', scope, id, message, meta),
    warn: (message, meta) => writeLog('warn', scope, id, message, meta),
    error: (message, meta) => writeLog('error', scope, id, message, meta),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function summarizeVisionPayload(payload: unknown): VisionPayloadSummary {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let textParts = 0;
  let imageCount = 0;

  for (const message of messages) {
    const content =
      message && typeof message === 'object' && 'content' in message
        ? (message as { content?: unknown }).content
        : undefined;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const type = (item as { type?: unknown }).type;
      if (type === 'text') textParts++;
      if (type === 'image_url') imageCount++;
    }
  }

  return {
    model: typeof body.model === 'string' ? body.model : 'unknown',
    messageCount: messages.length,
    textParts,
    imageCount,
  };
}

export function summarizeTextPreview(text: string, limit = 160): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function writeLog(
  level: 'log' | 'warn' | 'error',
  scope: string,
  id: string,
  message: string,
  meta?: LogMeta
): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : '';
  console[level](`[backend:${scope}:${id}] ${message}${suffix}`);
}

function safeJson(meta: LogMeta): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return '[unserializable meta]';
  }
}
