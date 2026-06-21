import { Router } from 'express';
import { createRequestLogger, formatBytes } from '../lib/log.js';
import { runDoclingOnPages, type DoclingInputPage } from '../lib/docling.js';

const router = Router();

interface DoclingRequestBody {
  pages?: unknown;
}

router.post('/docling', async (req, res) => {
  const log = createRequestLogger('docling');
  const { pages } = (req.body ?? {}) as DoclingRequestBody;

  if (!Array.isArray(pages) || pages.length === 0) {
    log.warn('rejecting request with no page images');
    return res.status(400).json({ error: 'A non-empty "pages" array is required.' });
  }

  let normalizedPages: DoclingInputPage[];
  try {
    normalizedPages = pages.map((page, index) => normalizePage(page, index));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid page payload.';
    log.warn('rejecting request with invalid page payload', { message });
    return res.status(400).json({ error: message });
  }

  const inputBytes = normalizedPages.reduce((sum, page) => sum + Buffer.byteLength(page.dataUrl), 0);
  log.log('received Docling request', {
    pages: normalizedPages.length,
    inputBytes: formatBytes(inputBytes),
    model: process.env.DOCLING_MODEL?.trim() || 'smoldocling_mlx',
  });

  try {
    const startedAt = Date.now();
    const result = await runDoclingOnPages(normalizedPages);
    log.log('Docling conversion completed', {
      pages: result.document.pages.length,
      model: result.document.model,
      durationMs: Date.now() - startedAt,
      textBytes: formatBytes(Buffer.byteLength(result.text)),
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Docling error.';
    log.error('Docling conversion failed', { message });
    return res.status(500).json({ error: `Docling conversion failed: ${message}` });
  }
});

function normalizePage(value: unknown, index: number): DoclingInputPage {
  if (!value || typeof value !== 'object') {
    throw new Error(`Page ${index + 1} must be an object.`);
  }

  const page = (value as { page?: unknown }).page;
  const dataUrl = (value as { dataUrl?: unknown }).dataUrl;

  if (typeof page !== 'number' || !Number.isFinite(page)) {
    throw new Error(`Page ${index + 1} is missing a valid page number.`);
  }

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error(`Page ${page} is missing a valid image data URL.`);
  }

  return { page, dataUrl };
}

export default router;
