import { Router } from 'express';
import {
  createRequestLogger,
  formatBytes,
  jsonByteLength,
  summarizeTextPreview,
  summarizeVisionPayload,
} from '../lib/log.js';

/**
 * Same-origin pass-through for the vision-model providers.
 *
 * Both Z.AI and OpenAI omit CORS headers, so a browser `fetch` to their
 * endpoints either can't read the response (Z.AI: request lands, response is
 * blocked) or fails the preflight (OpenAI: request never lands). Routing
 * through here removes CORS from the equation. The backend is otherwise
 * stateless: it forwards exactly what the frontend built and returns the
 * upstream body verbatim so token/cost parsing in the client stays unchanged.
 */
const router = Router();

/**
 * Cap a single upstream attempt. Vision calls legitimately take 30-90s on a
 * multi-page 300 DPI payload, so this is generous; a timeout counts as a
 * transient failure and is retried.
 */
const UPSTREAM_TIMEOUT_MS = 240_000;
/**
 * Total attempts per request. A retry only happens on a network-level failure
 * (connection reset, abort-by-timeout, etc.): if the upstream returned ANY HTTP
 * status at all (even 4xx/5xx), it is forwarded verbatim and not retried. This
 * is what absorbs the transient undici errors that otherwise surface as a 502
 * when two large image uploads race through the proxy concurrently.
 */
const MAX_ATTEMPTS = 2;

interface LlmProxyBody {
  endpoint?: unknown;
  apiKey?: unknown;
  payload?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

router.post('/llm', async (req, res) => {
  const log = createRequestLogger('llm');
  const { endpoint, apiKey, payload } = (req.body ?? {}) as LlmProxyBody;
  log.log('received LLM proxy request', { requestBytes: formatBytes(jsonByteLength(req.body)) });

  if (typeof endpoint !== 'string' || !/^https?:\/\//i.test(endpoint)) {
    log.warn('rejecting request with invalid endpoint', { endpointType: typeof endpoint });
    return res.status(400).json({ error: 'Invalid endpoint.' });
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    log.warn('rejecting request with missing API key', { endpoint });
    return res.status(400).json({ error: 'Missing API key.' });
  }

  const summary = summarizeVisionPayload(payload);
  log.log('validated LLM proxy request', {
    endpoint,
    model: summary.model,
    messages: summary.messageCount,
    textParts: summary.textParts,
    images: summary.imageCount,
    payloadBytes: formatBytes(jsonByteLength(payload)),
  });

  if (endpoint === 'https://api.z.ai/v1/chat/completions') {
    log.warn('request targets deprecated Z.AI endpoint', {
      endpoint,
      expectedEndpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    });
  }

  // Forward client cancellation: when the browser (or the Vite proxy in front
  // of us) drops the downstream request, abort the in-flight upstream fetch so
  // we stop paying for a result nobody will read.
  //
  // CRITICAL: we listen on `res`, not `req`. Since Node 16, `req`'s 'close'
  // event fires the moment the *request body* has been fully consumed (i.e.
  // right after `express.json()` finishes), not when the client disconnects —
  // so `req.on('close')` would abort every single call immediately. `res`'s
  // 'close' fires when the response stream closes (either because we finished
  // sending it, or because the client dropped the connection first); the
  // `writableEnded` guard tells the two apart so we only abort on a real
  // disconnect.
  const abortUpstream = (controller: AbortController) => {
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClose);
    return () => res.off('close', onClose);
  };

  const body = JSON.stringify(payload);
  let upstream: Response | null = null;
  let text = '';
  let lastErr: unknown = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const detachClose = abortUpstream(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);

    log.log('forwarding request upstream', { endpoint, model: summary.model, attempt });

    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      text = await upstream.text();
    } catch (err) {
      clearTimeout(timeout);
      detachClose();
      const elapsedMs = Date.now() - startedAt;

      if (timedOut) {
        lastErr = new Error(`upstream timeout after ${elapsedMs}ms`);
        log.warn('upstream attempt timed out', { attempt, elapsedMs });
      } else if (controller.signal.aborted) {
        // Client went away (res 'close' fired before writableEnded). Nothing
        // to retry and nobody to answer to — writing a response to a dead
        // socket would just log noise, so bail silently.
        log.warn('client disconnected during upstream call', { attempt, elapsedMs });
        return;
      } else {
        lastErr = err;
        const message = err instanceof Error ? err.message : String(err);
        log.warn('upstream fetch attempt failed', { attempt, elapsedMs, message });
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(400 * attempt);
        continue;
      }
      break;
    }

    clearTimeout(timeout);
    detachClose();
    break; // got a real HTTP response — forward it verbatim, do not retry.
  }

  if (!upstream) {
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    log.error('upstream fetch failed', { endpoint, message });
    return res.status(502).json({ error: `Upstream fetch failed: ${message}` });
  }

  const responseMeta = {
    endpoint,
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    responseBytes: formatBytes(Buffer.byteLength(text)),
    contentType: upstream.headers.get('content-type') ?? 'application/json',
  };

  if (upstream.ok) {
    log.log('received upstream success response', responseMeta);
  } else {
    log.warn('received upstream error response', {
      ...responseMeta,
      preview: summarizeTextPreview(text),
    });
  }

  return res
    .status(upstream.status)
    .type(upstream.headers.get('content-type') ?? 'application/json')
    .send(text);
});

export default router;
