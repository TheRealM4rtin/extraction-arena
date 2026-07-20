# AGENTS.md

An LLM vision-model evaluation dashboard that compares GLM-5V-Turbo (Z.AI) and GPT-5.4 mini (OpenAI) against a per-document golden dataset. Built around first-responder rescue sheets (the seed dataset is the 4-page Tesla Cybertruck sheet). The app is built around a **canonical, versioned rescue-sheet JSON contract** (`rescue-sheet-ev-v1.1` — rich ISO-17840-style domain body + app envelope; v1.0 still migrates); arbitrary source/supplier/model JSON enters the system only through envelope-stamping / an adapter / VLM normalize into that contract.

## Repository layout

Monorepo with **two independent Node projects** (each has its own `package.json`; this is *not* a workspace):
- `backend/` — Express + TypeScript. Installs/runs on its own.
- `frontend/` — Vite + React 18 + TypeScript. Installs/runs on its own.

`backend/` and `frontend/` live at the repo root (the `llm-pdf-evaluator/` prefix in the spec is a project label, not an extra nesting level).

## Architecture rule (easy to violate)

The **backend has two stateless routes:**
- `POST /api/extract` — PDF→PNG conversion (multipart upload → base64 PNGs at 300 DPI).
- `POST /api/llm` — a same-origin **pass-through proxy** for the vision calls. The frontend builds the OpenAI-compatible request (model, messages, prompt, images, `temperature`, `response_format`) and POSTs `{ endpoint, apiKey, payload }`; the backend forwards it verbatim and returns the upstream body. **This exists because of CORS:** neither Z.AI nor OpenAI send `Access-Control-Allow-Origin`, so a direct browser `fetch` can't read the response (Z.AI: request lands, response blocked → Safari's "Load failed") or fails the preflight (OpenAI: request never lands). Do not call the providers directly from the browser, and do not put LLM/scoring logic in the backend — it only forwards.

Keys still live client-side (`VITE_` env, editable in Settings) and are passed through the LLM proxy; the backend never stores them.

## Datasets (the core unit of work)

## Canonical rescue-sheet contract (the core invariant)

Everything the UI, persistence, scoring, metrics, and extraction prompt rely on is a **canonical, versioned record**: `rescue-sheet-ev-v1.1` (types in `frontend/src/lib/canonical/schema.ts`, JSON Schema Draft 2020-12 boundary in `schema.json`). **Arbitrary JSON is never the core input** for scoring — it is envelope-stamped (rich domain gold), adapted (free-form Tesla bag), or VLM-normalized. Pipeline:

```
pasted golden JSON / OEM JSON / LLM output
              │
              ▼
   rich domain?  → stampRichEnvelope (identity_rich)
   free-form?    → Tesla adapter (registry: ONE adapter)
   VLM output?   → normalizeVlmToDraft (not the registry)
              │
              ▼
   canonical rescue-sheet-ev-v1.1 draft
              │
              ▼
   JSON Schema + domain-rule validation  (canonical/validate.ts)
              │
              ▼
   project() → flat path→value map  (canonical/project.ts)
              │
              ▼
   existing scoring / metrics / UI
```

- **Two stored representations per dataset** (`lib/canonical/ingest.ts` produces both):
  - `canonical: RescueSheetV1` — the source of truth (rich nested domain + envelope).
  - `rawSource: RawSourceRecord` — the unmodified pasted JSON, kept for audit/reprocessing (never read directly by the app).
  - `golden: GoldenDataset` — a **derived projection** of `canonical` (via `goldenProjection()`), kept so the original scoring/metrics/UI modules run unchanged. It is read-only; edit `canonical` instead.
- **Adapters** (`canonical/adapters/`): one per free-form source shape. The registry holds a SINGLE adapter — `TeslaRescueSheetAdapter` — which maps `{ golden_extraction: {...} }` to v1.1, preserving unrecognized keys under `legacy_fields`. **Rich ISO-style gold** (nested `disable_direct_hazards`, `warnings`, HV under `vehicle.propulsion`) is accepted via **envelope stamp** (`stampRichEnvelope`) — not the Tesla key table. **Vision-model output** uses `normalizeVlmToDraft()` (`canonical/vlm.ts`).
- **Energy enum:** models and scoring prefer `battery_electric`; ingest normalizes free-form `"electricity"` → `battery_electric`.
- **Validation never blocks** (`canonical/validate.ts`): structural (ajv 2020-12) + domain rules (step sequencing, positive durations/voltages, dangling evidence/source-page refs, missing-evidence warnings) + a separate **publish gate**. Problems are `Issue[]`, not thrown.
- **No coordinates.** Evidence is page-level; locations use `location_descriptor` (or legacy `location.value`), not bounding boxes.
- **Lifecycle is metadata + rules only** (no review-queue UI): `raw | draft | validated | reviewed | published | rejected | legacy` (`canonical/lifecycle.ts`).

## Datasets (the core unit of work)

A **dataset** = `{ name, pdfName, dpi, pages[], canonical, golden, rawSource }`, created via the "Create Dataset" dialog (name → PDF upload → golden JSON paste) and **persisted locally in IndexedDB** (`lib/db.ts`, DB v2), so it survives app restarts. Multiple named datasets can coexist and be selected from the sidebar.

- The pasted JSON is the **raw source**. Rich domain gold is envelope-stamped; free-form bags use the Tesla adapter. Validation runs; the **projection** is what gets scored in Ground Truth / metrics.
- The extraction prompt (`buildCanonicalPrompt` in `canonical/prompt.ts`) **always** sends the **full empty v1.1 nested skeleton** (placeholders only) — **never golden answers**, and **not** a gold-gated subset of fields. Scoring still only compares paths present on this dataset's projection.
- Page images are stored inline (base64 data URLs) in IndexedDB; a dataset can be re-run offline once created.
- **Pre-v1 datasets are migrated lazily** on load (`migrateLegacyDataset`): their free-form `golden_extraction` is re-run through the Tesla adapter to produce a `canonical` record, and the original projection is preserved.

## Hard constraints

- **`pdfjs-dist` is pinned to `3.11.174`** in `backend/`. v4+'s worker bootstrap calls `process.getBuiltinModule()`, which only exists on Node 20.16+/22+. Do not bump it unless the runtime Node is also upgraded. Backend uses `@napi-rs/canvas` + global `Path2D`/`ImageData`/`DOMMatrix` polyfills so no poppler/imagemagick binaries are required.
- **`NodeCanvasFactory.destroy` must stay a no-op.** `@napi-rs/canvas` throws `Failed to unwrap exclusive reference of CanvasElement` if you set `canvas.width = 0` (the default `BaseCanvasFactory.destroy`) while its 2D context still holds a shared borrow. This only triggers on image-heavy PDFs (cached intermediate canvases), so it passes on simple test PDFs and bites in production. GC reclaims the canvases once pdf.js drops them.
- **`pdfjs-dist` pulls in `canvas` (node-canvas) as an optional dependency.** It coexists with `@napi-rs/canvas`; the factory passed to `getDocument({ canvasFactory })` is what actually renders, so keep routing it explicitly.
- **PDF→PNG at exactly 300 DPI.** Not 72, not 4K.
- **Accuracy scoring is real and canonical-driven:** per-field exact match vs the projected golden value (normalized strings; **order-sensitive** for arrays; key/value match for objects), plus a partial-credit metric. The scoring engine (`lib/scoring.ts`) is unchanged — it operates on the flat projection (`canonical/project.ts`). Never mock or fake scores.
- **No placeholder API calls.** Both models are called for real with live keys.
- **Normalize + validate every model JSON output to the canonical contract** before display/scoring: `normalizeVlmToDraft` (`canonical/vlm.ts`) → `validate` → `project`. Issues are surfaced, never thrown.

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
  - Ground Truth `#10B981` · GLM-5V-Turbo `#06B6D4` · GPT-5.4 mini `#8B5CF6`
- Columns always render left-to-right in that order.
- Minimum font size **14px** (demo is recorded for mobile LinkedIn viewing).
- All animations must complete within ~3–5s and stay smooth on a modern laptop — no particle systems, 3D, video, sound, or cursor trails.
