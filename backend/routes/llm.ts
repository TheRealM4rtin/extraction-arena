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

interface LlmProxyBody {
  endpoint?: unknown;
  apiKey?: unknown;
  payload?: unknown;
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

  try {
    const startedAt = Date.now();
    log.log('forwarding request upstream', { endpoint, model: summary.model });
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('upstream fetch failed', { endpoint, message });
    return res.status(502).json({ error: `Upstream fetch failed: ${message}` });
  }
});

export default router;
