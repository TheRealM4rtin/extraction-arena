import { useCallback } from 'react';
import {
  callVisionModel,
  GLM_PRICING,
  GPT_PRICING,
  type ModelResult,
  type PageImage,
  type VisionConfig,
} from '@/lib/api';
import { buildExtractionPrompt, expectedKinds, type GoldenValue } from '@/lib/dataset';
import { useAppStore } from '@/store';

export interface RunResult {
  glm: ModelResult;
  gpt: ModelResult;
}

/**
 * Orchestrates the two live vision-model calls (GML-5V-Turbo + GPT-5.4 mini) against
 * the active dataset's dynamic field schema. Both run in parallel; each model's
 * raw JSON is coerced to the golden field shape inside `api.ts`.
 */
export function useExtraction() {
  const active = useAppStore((s) => s.active);
  const zaiKey = useAppStore((s) => s.zaiKey);
  const openaiKey = useAppStore((s) => s.openaiKey);
  const setGlm = useAppStore((s) => s.setGlm);
  const setGpt = useAppStore((s) => s.setGpt);

  const run = useCallback(async (): Promise<RunResult> => {
    if (!active) throw new Error('No dataset selected.');
    const pages: PageImage[] = active.pages;
    if (pages.length === 0) throw new Error('This dataset has no pages.');

    const prompt = buildExtractionPrompt(active.golden);
    const kinds = expectedKinds(active.golden);

    const configs: VisionConfig[] = [
      {
        modelId: 'glm-5v-turbo',
        label: 'GLM-5V-Turbo',
        endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
        apiKey: zaiKey,
        ...GLM_PRICING,
      },
      {
        modelId: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: openaiKey,
        ...GPT_PRICING,
      },
    ];

    setGlm(loadingResult('glm-5v-turbo', 'GLM-5V-Turbo'));
    setGpt(loadingResult('gpt-5.4-mini', 'GPT-5.4 mini'));

    const settled = await Promise.allSettled(
      configs.map((cfg) => callVisionModel(cfg, pages, prompt, kinds))
    );

    const [glmRes, gptRes] = settled;
    const glm =
      glmRes.status === 'fulfilled'
        ? { ...glmRes.value, status: 'done' as const }
        : errorResult('glm-5v-turbo', 'GLM-5V-Turbo', glmRes.reason);
    const gpt =
      gptRes.status === 'fulfilled'
        ? { ...gptRes.value, status: 'done' as const }
        : errorResult('gpt-5.4-mini', 'GPT-5.4 mini', gptRes.reason);

    setGlm(glm);
    setGpt(gpt);

    return { glm, gpt };
  }, [active, zaiKey, openaiKey, setGlm, setGpt]);

  return { run };
}

function loadingResult(id: string, label: string): ModelResult {
  return {
    modelId: id,
    label,
    data: {},
    rawText: '',
    elapsedMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    status: 'loading',
  };
}

function errorResult(id: string, label: string, reason: unknown): ModelResult {
  const message = reason instanceof Error ? reason.message : String(reason);
  return { ...loadingResult(id, label), status: 'error', error: message };
}

export type { GoldenValue };
