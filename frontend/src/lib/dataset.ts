import type { PageImage } from './api';

/** Sentinel string for an absent scalar field. */
export const NOT_FOUND = 'not_found';

/** A golden (or model-extracted) value can be a scalar, a list, or a map. */
export type GoldenValue = string | string[] | Record<string, string>;

export interface GoldenField {
  value: GoldenValue;
  difficulty?: string;
  source?: string;
}

export type GoldenExtraction = Record<string, GoldenField>;

export interface EvalHints {
  fields_most_likely_to_fail?: string[];
  why_they_fail?: string;
  partial_credit_rubric?: Record<string, string>;
}

export interface GoldenDataset {
  golden_extraction: GoldenExtraction;
  model_evaluation_hints?: EvalHints;
  reasoning_log?: string[];
}

/** Lightweight record used for the dataset selector list. */
export interface DatasetMeta {
  id: string;
  name: string;
  pdfName: string;
  dpi: number;
  pageCount: number;
  fieldCount: number;
  createdAt: number;
}

/** Full dataset loaded into memory when selected. */
export interface DatasetRecord extends DatasetMeta {
  pages: PageImage[];
  golden: GoldenDataset;
}

export type ValueKind = 'string' | 'array' | 'object';

export function valueKind(v: unknown): ValueKind {
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'string';
}

export function goldenFieldKeys(g: GoldenDataset): string[] {
  return Object.keys(g.golden_extraction);
}

export function humanLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHv\b/g, 'HV')
    .replace(/\bSrs\b/g, 'SRS');
}

/** Normalize + validate an arbitrary parsed JSON into a GoldenDataset. */
export function normalizeGolden(input: unknown): GoldenDataset {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const ge = obj.golden_extraction;
  if (!ge || typeof ge !== 'object' || Array.isArray(ge)) {
    throw new Error('A "golden_extraction" object is required.');
  }

  const golden_extraction: GoldenExtraction = {};
  for (const [key, rawField] of Object.entries(ge as Record<string, unknown>)) {
    const field =
      rawField && typeof rawField === 'object' && !Array.isArray(rawField)
        ? (rawField as Record<string, unknown>)
        : { value: rawField };
    golden_extraction[key] = {
      value: normalizeValue(field.value),
      difficulty: typeof field.difficulty === 'string' ? field.difficulty : undefined,
      source: typeof field.source === 'string' ? field.source : undefined,
    };
  }

  if (Object.keys(golden_extraction).length === 0) {
    throw new Error('golden_extraction must contain at least one field.');
  }

  return {
    golden_extraction,
    model_evaluation_hints:
      obj.model_evaluation_hints && typeof obj.model_evaluation_hints === 'object'
        ? (obj.model_evaluation_hints as EvalHints)
        : undefined,
    reasoning_log: Array.isArray(obj.reasoning_log) ? (obj.reasoning_log as string[]) : undefined,
  };
}

function normalizeValue(v: unknown): GoldenValue {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (v !== null && typeof v === 'object') {
    const o: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[String(k)] = String(val).trim();
    }
    return o;
  }
  if (v === null || v === undefined) return NOT_FOUND;
  return String(v).trim();
}

/** Map of field key -> expected value kind, derived from the golden dataset. */
export function expectedKinds(g: GoldenDataset): Record<string, ValueKind> {
  const out: Record<string, ValueKind> = {};
  for (const [key, field] of Object.entries(g.golden_extraction)) {
    out[key] = valueKind(field.value);
  }
  return out;
}

/**
 * Coerce an arbitrary model response into the field shape defined by the golden
 * dataset. Never throws; missing/malformed fields become "not_found" / [] / {}.
 */
export function coerceExtracted(
  raw: unknown,
  kinds: Record<string, ValueKind>
): Record<string, GoldenValue> {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const out: Record<string, GoldenValue> = {};
  for (const [key, kind] of Object.entries(kinds)) {
    out[key] = coerceValue(obj[key], kind);
  }
  return out;
}

function coerceValue(v: unknown, kind: ValueKind): GoldenValue {
  if (kind === 'array') {
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x).trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== NOT_FOUND);
    }
    if (typeof v === 'string' && v.trim() && v.toLowerCase() !== NOT_FOUND) {
      return [v.trim()];
    }
    return [];
  }
  if (kind === 'object') {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        o[String(k)] = String(val).trim();
      }
      return o;
    }
    return {};
  }
  if (typeof v === 'string') return v.trim();
  if (v === null || v === undefined) return NOT_FOUND;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).join('; ');
  return String(v).trim();
}

/**
 * Build the extraction prompt for the vision models from the golden dataset's
 * field list. Uses ONLY field keys/types — never the golden answers themselves.
 */
export function buildExtractionPrompt(g: GoldenDataset): string {
  const keys = goldenFieldKeys(g);
  const fieldLines = keys.map((key) => {
    const field = g.golden_extraction[key];
    const kind = valueKind(field.value);
    const typeHint =
      kind === 'array'
        ? 'array of strings'
        : kind === 'object'
          ? 'JSON object mapping labels to strings'
          : 'string';
    return `- "${key}" (${typeHint}): ${humanLabel(key)}`;
  });

  return `You are a technical document extraction engine. Analyze the provided first-responder rescue sheet images and extract ONLY the following fields as a single valid JSON object.

${fieldLines.join('\n')}

Rules:
- Extract ONLY what is visible in the images.
- For string fields, return a string. If a field is absent, return "not_found".
- For string fields, prefer the shortest self-contained text span that answers the field. Do not repeat the field name unless it is part of the answer.
- For array fields, return an array of strings. If absent, return [].
- For object fields, return an object mapping keys to strings. If absent, return {}.
- Preserve exact wording and ordering where the document implies order.
- Return ONLY valid JSON (no markdown, no commentary) with exactly these keys: ${keys.join(', ')}.`;
}
