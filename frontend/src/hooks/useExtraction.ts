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
 * the active dataset's dynamic field schema. Each model runs independently based on
 * its enabled flag in the store; disabled models are skipped entirely (no API call,
 * no status mutation). The enabled ones run in parallel and each model's raw JSON is
 * coerced to the golden field shape inside `api.ts`.
 */
export function useExtraction() {
  const active = useAppStore((s) => s.active);
  const customContexts = useAppStore((s) => s.customContexts);
  const zaiKey = useAppStore((s) => s.zaiKey);
  const openaiKey = useAppStore((s) => s.openaiKey);
  const enabledModels = useAppStore((s) => s.enabledModels);
  const setGlm = useAppStore((s) => s.setGlm);
  const setGpt = useAppStore((s) => s.setGpt);

  const run = useCallback(async (): Promise<Partial<RunResult>> => {
    if (!active) throw new Error('No dataset selected.');
    const pages: PageImage[] = active.pages;
    if (pages.length === 0) throw new Error('This dataset has no pages.');

    const documentContext = customContexts[active.id] ?? active.pdfName;
    const prompt = buildExtractionPrompt(active.golden, documentContext);
    const kinds = expectedKinds(active.golden);

    const allConfigs: Array<{ key: 'glm' | 'gpt'; cfg: VisionConfig }> = [
      {
        key: 'glm',
        cfg: {
          modelId: 'glm-5v-turbo',
          label: 'GLM-5V-Turbo',
          endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
          apiKey: zaiKey,
          ...GLM_PRICING,
        },
      },
      {
        key: 'gpt',
        cfg: {
          modelId: 'gpt-5.4-mini',
          label: 'GPT-5.4 mini',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKey: openaiKey,
          ...GPT_PRICING,
        },
      },
    ];

    const configs = allConfigs.filter(({ key }) => enabledModels[key]);
    if (configs.length === 0) return {};

    // Only set loading state for the models we're actually running.
    if (enabledModels.glm) setGlm(loadingResult('glm-5v-turbo', 'GLM-5V-Turbo'));
    if (enabledModels.gpt) setGpt(loadingResult('gpt-5.4-mini', 'GPT-5.4 mini'));

    const settled = await Promise.allSettled(
      configs.map(({ cfg }) => callVisionModel(cfg, pages, prompt, kinds))
    );

    const result: Partial<RunResult> = {};

    settled.forEach((res, i) => {
      const { key, cfg } = configs[i];
      const value =
        res.status === 'fulfilled'
          ? { ...res.value, status: 'done' as const }
          : errorResult(cfg.modelId, cfg.label, res.reason);
      if (key === 'glm') {
        setGlm(value);
        result.glm = value;
      } else {
        setGpt(value);
        result.gpt = value;
      }
    });

    return result;
  }, [active, customContexts, zaiKey, openaiKey, enabledModels, setGlm, setGpt]);

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
