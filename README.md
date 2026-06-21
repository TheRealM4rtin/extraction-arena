# Extraction Arena

LLM vision-model evaluation dashboard. Create a **dataset** (upload a PDF + its golden extraction JSON), then run GLM-5V-Turbo (Z.AI), GPT-5.4 mini (OpenAI), and a local Docling MLX baseline side-by-side and score each field against the golden truth. The seed dataset is the 4-page Tesla Cybertruck first-responder rescue sheet, but the schema is dataset-driven — any PDF + golden JSON works. **Datasets persist locally (IndexedDB) and survive restarts.**

## Architecture

Two independent Node projects (this is **not** a workspace — install and run each separately):

- `backend/` — Express + TypeScript. Converts PDFs to PNG pages at exactly 300 DPI (`POST /api/extract`), proxies the OpenAI-compatible vision calls (`POST /api/llm`), and runs a local Docling MLX pipeline over stored page images (`POST /api/docling`). Uses `pdfjs-dist` + `@napi-rs/canvas` so it runs with no system binaries.
- `frontend/` — Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Framer Motion. Manages datasets in IndexedDB, calls the backend routes, and scores GLM/GPT/Docling outputs against the golden dataset.

## Quick start

```bash
# 1. Backend (PDF → PNG @ 300 DPI + Docling)
cd backend && npm install
cp .env.example .env   # optional: point DOCLING_PYTHON_PATH at your Docling venv
npm run dev            # http://localhost:3001

# 2. Frontend (in another terminal)
cd frontend && npm install
cp .env.example .env   # then add your VITE_ZAI_API_KEY and VITE_OPENAI_API_KEY
npm run dev            # http://localhost:5173
```

Open http://localhost:5173 → **+ Create dataset** → enter a name, upload the PDF, paste the golden extraction JSON. Then press **Run Extraction**.

For the local baseline, install Docling in a Python environment with MLX support and point `DOCLING_PYTHON_PATH` at that interpreter if `python3` is not the right one on your machine. The default model preset is `smoldocling_mlx`, which is the recommended starting point on a 16 GB M1 Pro.

## Docker (entire app in containers)

```bash
cp .env.example .env   # add your VITE_ZAI_API_KEY + VITE_OPENAI_API_KEY
docker compose up --build
```

- Frontend → http://localhost:5173 (nginx serves the Vite build + proxies `/api/*` to the backend container)
- Backend → http://localhost:3001 (internal, also exposed for debugging)
- The Docling model cache persists in the `docling-cache` volume so weights download only once.

**MLX caveat:** MLX needs bare-metal Apple Silicon and cannot run inside Docker's Linux VM. The container therefore uses the CPU/PyTorch Docling presets (`smoldocling` / `granitedocling`) — same models, just not GPU-accelerated. For maximum speed on an M1 Pro, run the backend natively (Quick start above) with `DOCLING_MODEL=smoldocling_mlx`.

## Datasets

A dataset = `{ name, pdfName, dpi, pages[], golden }`. The `golden_extraction` object's keys define the extraction schema; each field's `value` may be a **string, string[], or `{key: string}` object** (with optional `difficulty` / `source` metadata). Scoring is per-field exact match (set-based for arrays, key/value for objects) plus a partial-credit metric. Multiple named datasets can coexist; all are stored locally in IndexedDB.

## Environment

Frontend keys (in `frontend/.env`):

| Var | Purpose |
|---|---|
| `VITE_ZAI_API_KEY` | GLM-5V-Turbo via `https://api.z.ai/api/paas/v4/chat/completions` |
| `VITE_OPENAI_API_KEY` | GPT-5.4 mini via `https://api.openai.com/v1/chat/completions` |

The `VITE_` prefix is intentional — Vite exposes these to the browser. The keys stay in the browser and are forwarded only through the same-origin `/api/llm` proxy so the providers' missing CORS headers do not break the app.

Backend Docling settings (in `backend/.env`):

| Var | Purpose |
|---|---|
| `DOCLING_PYTHON_PATH` | Python interpreter with Docling installed |
| `DOCLING_MODEL` | `smoldocling_mlx` / `granitedocling_mlx` (native M1) or `smoldocling` / `granitedocling` (CPU/Docker) |
| `DOCLING_WORKER_PATH` | Optional override for `docling_worker.py` |
| `DOCLING_TIMEOUT_MS` | Optional local pipeline timeout |

See `AGENTS.md` for repo conventions and hard constraints.
# extraction-arena
