import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  createCanvas,
  Path2D,
  ImageData,
  DOMMatrix,
  type Canvas,
  type SKRSContext2D,
} from '@napi-rs/canvas';
import { formatBytes } from './log.js';

const require = createRequire(import.meta.url);

// pdf.js was written for browsers; install the canvas primitives it expects
// onto the global scope before any rendering kicks off.
const g = globalThis as Record<string, unknown>;
if (!g.Path2D) g.Path2D = Path2D;
if (!g.ImageData) g.ImageData = ImageData;
if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;

// pdf.js v3.11 legacy CJS build. Chosen deliberately over v4 because v4's
// worker bootstrap calls process.getBuiltinModule(), which only exists on
// Node 20.16+/22+. v3 loads its worker via require('worker_threads') and runs
// on Node 20.11 without throwing.
// Typed loosely (require() returns any); the runtime contract is simple.
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}
interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (params: Record<string, unknown>) => { promise: Promise<void> };
  cleanup: () => void;
}

// Point pdf.js at its worker file; in Node it spawns a worker_threads worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.js'
);

// Standard font data (Helvetica etc.) so text renders without network fetches.
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = pathToFileURL(join(pdfjsRoot, 'standard_fonts') + '/').href;

export const TARGET_DPI = 300;
const PDF_BASE_DPI = 72;
const RENDER_SCALE = TARGET_DPI / PDF_BASE_DPI; // ~4.1667

export interface PdfPageImage {
  page: number;
  width: number;
  height: number;
  base64: string;
}

type CanvasObject = { canvas: Canvas; context: SKRSContext2D };
type StepLogger = (message: string, meta?: Record<string, unknown>) => void;

class NodeCanvasFactory {
  create(width: number, height: number): CanvasObject {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasObj: CanvasObject, width: number, height: number): void {
    canvasObj.canvas.width = width;
    canvasObj.canvas.height = height;
  }
  destroy(_canvasObj: CanvasObject): void {
    // Intentionally a no-op. @napi-rs/canvas rejects `canvas.width = 0` (what
    // BaseCanvasFactory.destroy does) because its 2D context holds a shared
    // borrow of the surface. Dropping our references is enough — pdf.js removes
    // the entry from its cache and the canvas is GC'd.
  }
}

export async function pdfBufferToImages(
  pdfBuffer: Uint8Array,
  maxPages = 4,
  onStep?: StepLogger
): Promise<PdfPageImage[]> {
  const step = onStep ?? (() => undefined);

  // One factory instance drives both transport-level canvases and page renders.
  const factory = new NodeCanvasFactory();
  step('loading PDF document', { pdfBytes: formatBytes(pdfBuffer.byteLength) });

  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer,
    useSystemFonts: false,
    standardFontDataUrl,
    // Route ALL pdf.js canvases (rendering + transport/annotation) through our
    // @napi-rs/canvas factory with a safe destroy().
    canvasFactory: factory,
  });

  const doc = await loadingTask.promise;
  const pagecount = Math.min(doc.numPages, maxPages);
  const images: PdfPageImage[] = [];
  step('PDF document loaded', {
    totalPages: doc.numPages,
    pagesToRender: pagecount,
    targetDpi: TARGET_DPI,
  });

  try {
    for (let i = 1; i <= pagecount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      step('rendering page', {
        page: i,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      });

      const canvasObj = factory.create(viewport.width, viewport.height);
      await page.render({
        canvasContext: canvasObj.context,
        viewport,
        canvasFactory: factory,
        background: '#ffffff',
      }).promise;

      const pngBuffer = canvasObj.canvas.toBuffer('image/png');
      step('encoded page PNG', { page: i, pngBytes: formatBytes(pngBuffer.byteLength) });
      images.push({
        page: i,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        base64: pngBuffer.toString('base64'),
      });

      page.cleanup();
    }
  } finally {
    step('destroying PDF document');
    await doc.destroy();
    step('PDF document released');
  }

  step('all requested pages converted', { renderedPages: images.length });
  return images;
}
