# Extraction Arena

LLM vision-model evaluation dashboard. Create a **dataset** (upload a PDF + paste its golden rescue-sheet JSON), then run GLM-5V-Turbo (Z.AI) and GPT-5.4 mini (OpenAI) side-by-side and score each field against the golden truth. The seed dataset is the 4-page Tesla Cybertruck first-responder rescue sheet. The app is built around a **canonical, versioned rescue-sheet JSON contract** (`rescue-sheet-ev-v1.1` rich domain + envelope; v1.0 still migrates); pasted/OEM/model JSON is envelope-stamped or adapted into that contract and validated before it is scored. **Datasets persist locally (IndexedDB) and survive restarts.**

## Architecture

Two independent Node projects (this is **not** a workspace — install and run each separately):

- `backend/` — Express + TypeScript. Converts PDFs to PNG pages at exactly 300 DPI (`POST /api/extract`) and proxies the OpenAI-compatible vision calls (`POST /api/llm`). Uses `pdfjs-dist` + `@napi-rs/canvas` so it runs with no system binaries.
- `frontend/` — Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Framer Motion. Manages datasets in IndexedDB, calls the backend routes, and scores GLM/GPT outputs against the golden dataset.

## Quick start

```bash
# 1. Backend (PDF → PNG @ 300 DPI)
cd backend && npm install
cp .env.example .env   # optional: backend port override
npm run dev            # http://localhost:3001

# 2. Frontend (in another terminal)
cd frontend && npm install
cp .env.example .env   # then add your VITE_ZAI_API_KEY and VITE_OPENAI_API_KEY
npm run dev            # http://localhost:5173
```

Open http://localhost:5173 → **+ Create dataset** → enter a name, upload the PDF, paste the golden extraction JSON. Then press **Run Extraction**.

## Docker (entire app in containers)

```bash
cp .env.example .env   # add your VITE_ZAI_API_KEY + VITE_OPENAI_API_KEY
docker compose up --build
```

- Frontend → http://localhost:5173 (nginx serves the Vite build + proxies `/api/*` to the backend container)
- Backend → http://localhost:3001 (internal, also exposed for debugging)

## Datasets

A dataset = `{ name, pdfName, dpi, pages[], canonical, golden, rawSource }`. The pasted JSON is the **raw source**; rich ISO-style gold is envelope-stamped into **canonical** `rescue-sheet-ev-v1.1`, free-form `{ golden_extraction }` goes through the Tesla adapter, validation runs (structural JSON Schema + domain rules), and a **golden projection** (flat path → value map) is derived for the scorer. Unrecognized free-form keys are preserved under `legacy_fields` (never lost). Scoring is per-field exact match (order-sensitive for arrays) plus a partial-credit metric. Extraction always prompts with the full empty v1.1 skeleton (never golden answers). Model output is normalized (`normalizeVlmToDraft`) then projected and scored. Multiple named datasets can coexist; all are stored locally in IndexedDB. Pre-v1 datasets are migrated lazily on load.

## Environment

Frontend keys (in `frontend/.env`):

| Var | Purpose |
|---|---|
| `VITE_ZAI_API_KEY` | GLM-5V-Turbo via `https://api.z.ai/api/paas/v4/chat/completions` |
| `VITE_OPENAI_API_KEY` | GPT-5.4 mini via `https://api.openai.com/v1/chat/completions` |

The `VITE_` prefix is intentional — Vite exposes these to the browser. The keys stay in the browser and are forwarded only through the same-origin `/api/llm` proxy so the providers' missing CORS headers do not break the app.

Backend settings (in `backend/.env`):

| Var | Purpose |
|---|---|
| `PORT` | Optional backend port override (defaults to `3001`) |

See `AGENTS.md` for repo conventions and hard constraints.
# extraction-arena
