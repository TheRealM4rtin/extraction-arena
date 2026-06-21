import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DoclingInputPage {
  page: number;
  dataUrl: string;
}

export interface DoclingDocumentPage {
  page: number;
  markdown: string;
  document: unknown;
}

export interface DoclingRunResult {
  text: string;
  document: {
    engine: 'docling-mlx';
    model: string;
    pages: DoclingDocumentPage[];
  };
}

interface WorkerInputPage {
  page: number;
  path: string;
}

interface WorkerOutputPage {
  page: number;
  markdown?: unknown;
  document?: unknown;
}

interface WorkerOutput {
  model?: unknown;
  pages?: unknown;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export async function runDoclingOnPages(pages: DoclingInputPage[]): Promise<DoclingRunResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'docling-pages-'));

  try {
    const workerPages = await writePagesToTempDir(pages, tempDir);
    const workerOutput = await runWorker(workerPages);
    const normalizedPages = normalizeWorkerPages(workerOutput.pages, workerPages);
    const model = normalizeModel(workerOutput.model);
    const text = normalizedPages
      .map((page) => page.markdown.trim() && `--- Page ${page.page} ---\n${page.markdown.trim()}`)
      .filter(Boolean)
      .join('\n\n');

    return {
      text,
      document: {
        engine: 'docling-mlx',
        model,
        pages: normalizedPages,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writePagesToTempDir(pages: DoclingInputPage[], tempDir: string): Promise<WorkerInputPage[]> {
  const workerPages: WorkerInputPage[] = [];

  for (const page of pages) {
    const imageBuffer = decodeImageDataUrl(page.dataUrl);
    const imagePath = join(tempDir, `page-${String(page.page).padStart(3, '0')}.png`);
    await writeFile(imagePath, imageBuffer);
    workerPages.push({ page: page.page, path: imagePath });
  }

  return workerPages;
}

function decodeImageDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) {
    throw new Error('Invalid page image. Expected a base64 data URL.');
  }

  return Buffer.from(match[1], 'base64');
}

async function runWorker(pages: WorkerInputPage[]): Promise<WorkerOutput> {
  const pythonPath = process.env.DOCLING_PYTHON_PATH?.trim() || 'python3';
  const workerPath = await resolveWorkerPath();
  const timeoutMs = readPositiveInt(process.env.DOCLING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(pythonPath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rejectPromise(new Error(`Docling worker timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || 'Unknown Docling worker error.';
        rejectPromise(new Error(`Docling worker exited with code ${code}: ${details}`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout) as WorkerOutput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rejectPromise(new Error(`Failed to parse Docling worker output: ${message}`));
      }
    });

    proc.stdin.end(JSON.stringify(pages));
  });
}

async function resolveWorkerPath(): Promise<string> {
  const configured = process.env.DOCLING_WORKER_PATH?.trim();
  const candidates = [
    configured,
    resolve(process.cwd(), 'docling_worker.py'),
    fileURLToPath(new URL('../../docling_worker.py', import.meta.url)),
    fileURLToPath(new URL('../docling_worker.py', import.meta.url)),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Docling worker not found. Set DOCLING_WORKER_PATH or keep docling_worker.py in backend/.');
}

function normalizeWorkerPages(rawPages: unknown, fallbackPages: WorkerInputPage[]): DoclingDocumentPage[] {
  if (!Array.isArray(rawPages)) {
    throw new Error('Docling worker returned an invalid page list.');
  }

  return rawPages.map((value, index) => normalizeWorkerPage(value, fallbackPages[index]));
}

function normalizeWorkerPage(value: unknown, fallbackPage?: WorkerInputPage): DoclingDocumentPage {
  const pageObj: Partial<WorkerOutputPage> =
    value && typeof value === 'object' ? (value as WorkerOutputPage) : {};
  const page =
    typeof pageObj.page === 'number' && Number.isFinite(pageObj.page)
      ? pageObj.page
      : fallbackPage?.page;

  if (!page) {
    throw new Error('Docling worker returned a page without a valid page number.');
  }

  return {
    page,
    markdown: typeof pageObj.markdown === 'string' ? pageObj.markdown : '',
    document: pageObj.document ?? {},
  };
}

function normalizeModel(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'SmolDocling-256M (MLX)';
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
