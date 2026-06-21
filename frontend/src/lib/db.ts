import type { DatasetMeta, DatasetRecord } from './dataset';

/**
 * Local persistence for datasets (metadata + converted page images + golden
 * JSON) via IndexedDB. Survives app restarts. Page images are stored inline as
 * base64 data URLs, so a dataset can be re-run offline once created.
 */

const DB_NAME = 'extraction-arena';
const DB_VERSION = 1;
const META_STORE = 'datasets-meta'; // lightweight: drives the selector list
const FULL_STORE = 'datasets-full'; // full records incl. pages + golden

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FULL_STORE)) {
        db.createObjectStore(FULL_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      })
  );
}

function toMeta(rec: DatasetRecord): DatasetMeta {
  const { id, name, pdfName, dpi, pageCount, fieldCount, createdAt } = rec;
  return { id, name, pdfName, dpi, pageCount, fieldCount, createdAt };
}

export async function saveDataset(rec: DatasetRecord): Promise<void> {
  await tx(META_STORE, 'readwrite', (s) => s.put(toMeta(rec)));
  await tx(FULL_STORE, 'readwrite', (s) => s.put(rec));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively merge a partial patch into a base record. Plain objects are
 * merged key-by-key; arrays and scalars are replaced wholesale (matching the
 * golden value semantics: string[] / Record<string,string> are atomic units).
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(patch)) {
    const next = (patch as Record<string, unknown>)[key];
    out[key] = key in out ? deepMerge(out[key], next) : next;
  }
  return out as T;
}

/**
 * Apply a deep partial patch to an existing dataset and persist the full
 * merged record (meta + full stores). Returns the merged record so callers
 * can update in-memory state atomically.
 */
export async function updateDataset(
  id: string,
  patch: Partial<DatasetRecord>
): Promise<DatasetRecord> {
  const existing = await loadDataset(id);
  if (!existing) throw new Error(`Dataset ${id} not found`);
  const merged = deepMerge(existing, patch);
  await saveDataset(merged);
  return merged;
}

export async function listDatasets(): Promise<DatasetMeta[]> {
  const all = await tx<DatasetMeta[]>(META_STORE, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadDataset(id: string): Promise<DatasetRecord | undefined> {
  return tx<DatasetRecord | undefined>(FULL_STORE, 'readonly', (s) => s.get(id));
}

export async function deleteDataset(id: string): Promise<void> {
  await tx(META_STORE, 'readwrite', (s) => s.delete(id));
  await tx(FULL_STORE, 'readwrite', (s) => s.delete(id));
}
