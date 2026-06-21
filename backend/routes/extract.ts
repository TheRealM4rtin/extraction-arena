import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { pdfBufferToImages, TARGET_DPI } from '../lib/pdfToImages.js';
import { createRequestLogger, formatBytes } from '../lib/log.js';

const router = Router();

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap from spec.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

router.post('/extract', upload.single('pdf'), async (req: Request, res: Response) => {
  const log = createRequestLogger('extract');
  log.log('received extract request');

  try {
    if (!req.file) {
      log.warn('rejecting request with no uploaded PDF');
      return res.status(400).json({ error: 'No PDF file uploaded (field name must be "pdf").' });
    }

    log.log('validated uploaded PDF', {
      pdfName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadBytes: formatBytes(req.file.size),
      targetDpi: TARGET_DPI,
      maxPages: 4,
    });

    // multer gives a Node Buffer; copy into a plain Uint8Array for pdf.js.
    const bytes = new Uint8Array(req.file.buffer);
    log.log('starting PDF to PNG conversion', { pdfBytes: formatBytes(bytes.byteLength) });
    const images = await pdfBufferToImages(bytes, 4, (message, meta) => log.log(message, meta));
    const totalPngBytes = images.reduce((sum, img) => sum + Buffer.byteLength(img.base64, 'base64'), 0);

    log.log('finished PDF to PNG conversion', {
      pages: images.length,
      totalPngBytes: formatBytes(totalPngBytes),
    });

    log.log('sending extract response', { pages: images.length, dpi: TARGET_DPI });
    return res.json({
      dpi: TARGET_DPI,
      pages: images.length,
      images: images.map((img) => ({
        page: img.page,
        width: img.width,
        height: img.height,
        // Pre-formatted data URL so the frontend can drop it straight into <img>/fetch.
        dataUrl: `data:image/png;base64,${img.base64}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown conversion error.';
    log.error('PDF conversion failed', { message });
    return res.status(500).json({ error: `PDF conversion failed: ${message}` });
  }
});

export default router;
