# AGENTS.md

An LLM vision-model evaluation dashboard that compares GLM-5V-Turbo (Z.AI), GPT-5.4 mini (OpenAI), and a local Docling MLX baseline against a per-document golden dataset. Built around first-responder rescue sheets (the seed dataset is the 4-page Tesla Cybertruck sheet), but **the extraction schema is dataset-driven, not fixed** — each dataset brings its own PDF and golden JSON.

## Repository layout

Monorepo with **two independent Node projects** (each has its own `package.json`; this is *not* a workspace):
- `backend/` — Express + TypeScript. Installs/runs on its own.
- `frontend/` — Vite + React 18 + TypeScript. Installs/runs on its own.

`backend/` and `frontend/` live at the repo root (the `llm-pdf-evaluator/` prefix in the spec is a project label, not an extra nesting level).

## Architecture rule (easy to violate)

The **backend has three stateless routes:**
- `POST /api/extract` — PDF→PNG conversion (multipart upload → base64 PNGs at 300 DPI).
- `POST /api/llm` — a same-origin **pass-through proxy** for the vision calls. The frontend builds the OpenAI-compatible request (model, messages, prompt, images, `temperature`, `response_format`) and POSTs `{ endpoint, apiKey, payload }`; the backend forwards it verbatim and returns the upstream body. **This exists because of CORS:** neither Z.AI nor OpenAI send `Access-Control-Allow-Origin`, so a direct browser `fetch` can't read the response (Z.AI: request lands, response blocked → Safari's "Load failed") or fails the preflight (OpenAI: request never lands). Do not call the providers directly from the browser, and do not put LLM/scoring logic in the backend — it only forwards.
- `POST /api/docling` — a same-origin local pass-through for the Docling MLX baseline. The frontend POSTs dataset page images as data URLs; the backend writes temporary PNGs, invokes `docling_worker.py`, and returns the exported DoclingDocument JSON plus extracted markdown/text.

The local baseline runs server-side through Docling + MLX. Keys still live client-side (`VITE_` env, editable in Settings) and are passed through the LLM proxy; the backend never stores them.

## Datasets (the core unit of work)

The app no longer has a drag-drop PDF + fixed ground truth. Instead, a **dataset** = `{ name, pdfName, dpi, pages[], golden }`, created via the "Create Dataset" dialog (name → PDF upload → golden JSON paste) and **persisted locally in IndexedDB** (`lib/db.ts`), so it survives app restarts. Multiple named datasets can coexist and be selected from the sidebar.

- The golden JSON's `golden_extraction` object defines the extraction schema for that dataset — its keys are the fields, and each field's `value` may be a **string, string[], or `{key: string}` object**. `difficulty` and `source` are optional display metadata.
- The extraction prompt (`buildExtractionPrompt` in `lib/dataset.ts`) is generated from the field keys + their *types* only — **never the golden answers**, so the model is never leaked the truth. The Docling keyword mapper also uses only field keys.
- Page images are stored inline (base64 data URLs) in IndexedDB; a dataset can be re-run offline once created.

## Hard constraints

- **`pdfjs-dist` is pinned to `3.11.174`** in `backend/`. v4+'s worker bootstrap calls `process.getBuiltinModule()`, which only exists on Node 20.16+/22+. Do not bump it unless the runtime Node is also upgraded. Backend uses `@napi-rs/canvas` + global `Path2D`/`ImageData`/`DOMMatrix` polyfills so no poppler/imagemagick binaries are required.
- **`NodeCanvasFactory.destroy` must stay a no-op.** `@napi-rs/canvas` throws `Failed to unwrap exclusive reference of CanvasElement` if you set `canvas.width = 0` (the default `BaseCanvasFactory.destroy`) while its 2D context still holds a shared borrow. This only triggers on image-heavy PDFs (cached intermediate canvases), so it passes on simple test PDFs and bites in production. GC reclaims the canvases once pdf.js drops them.
- **`pdfjs-dist` pulls in `canvas` (node-canvas) as an optional dependency.** It coexists with `@napi-rs/canvas`; the factory passed to `getDocument({ canvasFactory })` is what actually renders, so keep routing it explicitly.
- **PDF→PNG at exactly 300 DPI.** Not 72, not 4K.
- **Accuracy scoring is real and dataset-driven:** per-field exact match vs the golden value (normalized strings; order-independent set match for arrays; key/value match for objects), plus a partial-credit metric for arrays/objects. Never mock or fake scores.
- **No placeholder API calls.** Both models are called for real with live keys.
- **Validate/coerce every model JSON output to the golden field types** before display (`coerceExtracted` in `lib/dataset.ts`).

## Sentinels

Absent scalar field → literal string **`"not_found"`** (not `null`, not `""`). Absent array → `[]`. Absent object → `{}`. Scoring treats all three as "absent" and matches two absent values as a correct match.

## API integration

Both endpoints are OpenAI-compatible chat-completions with vision. For each call:
- `temperature: 0`
- `response_format: { type: "json_object" }`
- Multimodal `content` array: the dataset-driven extraction prompt + one `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }` per converted page
- Calls go through the backend `/api/llm` pass-through (CORS bypass), not directly to the provider.

| Model | Endpoint | Model ID |
|---|---|---|
| GLM-5V-Turbo | `https://api.z.ai/api/paas/v4/chat/completions` | `glm-5v-turbo` |
| GPT-5.4 mini | `https://api.openai.com/v1/chat/completions` | `gpt-5.4-mini` |

Z.AI uses `Authorization: Bearer $ZAI_API_KEY` and is OpenAI-compatible — don't look for a separate SDK.

## Environment / security gotcha

Keys use the `VITE_` prefix (`VITE_OPENAI_API_KEY`, `VITE_ZAI_API_KEY`). Vite exposes any `VITE_`-prefixed var to the browser bundle. This is **intentional** for this demo (frontend calls APIs directly). If you ever move calls server-side, drop the `VITE_` prefix so keys aren't shipped to the client.

## UI conventions (repo-specific)

- **Dark mode is the default and only theme.** Backgrounds `#0A0A0F` / `#12121A`.
- **Per-column accent colors are fixed and reused everywhere** (borders, glows, badges, JSON syntax highlighting, gauge fill):
  - Ground Truth `#10B981` · GLM-5V-Turbo `#06B6D4` · GPT-5.4 mini `#8B5CF6` · Docling MLX `#F59E0B`
- Columns always render left-to-right in that order.
- Minimum font size **14px** (demo is recorded for mobile LinkedIn viewing).
- All animations must complete within ~3–5s and stay smooth on a modern laptop — no particle systems, 3D, video, sound, or cursor trails.
