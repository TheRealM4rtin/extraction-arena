import { useCallback } from 'react';
import {
  callVisionModel,
  isAbortError,
  GLM_PRICING,
  GPT_PRICING,
  type ModelResult,
  type PageImage,
  type VisionConfig,
} from '@/lib/api';
import { buildCanonicalPrompt } from '@/lib/canonical/prompt';
import type { SourceContext } from '@/lib/canonical/adapters/types';
import { useAppStore } from '@/store';
import type { GoldenValue } from '@/lib/dataset';

export interface RunResult {
  glm: ModelResult;
  gpt: ModelResult;
}

/**
 * Orchestrates the two live vision-model calls (GLM-5V-Turbo + GPT-5.4 mini) against
 * the active dataset's dynamic field schema. Each model runs independently based
 * on its enabled flag in the store; disabled models are skipped entirely (no API call,
 * no status mutation). The enabled calls fire in parallel and each model's raw JSON
 * is coerced to the golden field shape inside `api.ts`.
 *
 * Results stream in independently: each model commits its own store slice (and thus
 * its column's loading → done/error transition) the moment its own response resolves.
 * There is no Promise.all-style barrier gating visibility, so a slow model never
 * blocks the display of a faster one. `run` only resolves once every spawned call has
 * settled, so the caller can clear the global "running" flag.
 *
 * Pass an AbortSignal to cancel in-flight calls: an aborted model reverts its column
 * to `idle` (no fake error), while models that already finished keep their results.
 */
export function useExtraction() {
  const active = useAppStore((s) => s.active);
  const customContexts = useAppStore((s) => s.customContexts);
  const zaiKey = useAppStore((s) => s.zaiKey);
  const openaiKey = useAppStore((s) => s.openaiKey);
  const enabledModels = useAppStore((s) => s.enabledModels);
  const setGlm = useAppStore((s) => s.setGlm);
  const setGpt = useAppStore((s) => s.setGpt);

  const run = useCallback(
    async (signal?: AbortSignal): Promise<Partial<RunResult>> => {
      if (!active) throw new Error('No dataset selected.');
      const pages: PageImage[] = active.pages;
      if (pages.length === 0) throw new Error('This dataset has no pages.');

      const documentContext = customContexts[active.id] ?? active.pdfName;
      const prompt = buildCanonicalPrompt(active.canonical, documentContext);
      const ctx: SourceContext = {
        recordId: active.id,
        receivedAt: new Date().toISOString(),
        sourcePages: pages.map((p) => ({ page_id: `file:${p.page}`, page_number: p.page })),
        sourceFormat: active.pdfName,
      };

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

      const result: Partial<RunResult> = {};

      // Fire each model independently and commit its result to the store the
      // moment its own response resolves, so a slow model never blocks the
      // display of a faster one. There is no Promise.all-style barrier gating
      // when results become visible — each task self-commits its own column.
      const commit = (key: 'glm' | 'gpt', value: ModelResult) => {
        if (key === 'glm') {
          setGlm(value);
          result.glm = value;
        } else {
          setGpt(value);
          result.gpt = value;
        }
      };

      const tasks = configs.map(async ({ key, cfg }) => {
        try {
          const value: ModelResult = {
            ...(await callVisionModel(cfg, pages, prompt, ctx, signal)),
            status: 'done',
          };
          commit(key, value);
        } catch (reason) {
          // A cancel should never read as an error: revert the column to idle so
          // the spinner stops without showing a bogus failure message. Models
          // that already resolved keep their committed results.
          if (isAbortError(reason) || signal?.aborted) {
            commit(key, idleResult(cfg.modelId, cfg.label));
            return;
          }
          commit(key, errorResult(cfg.modelId, cfg.label, reason));
        }
      });

      // Await only so the caller knows when every spawned call has finished
      // (used to clear the global "running" flag). Visibility of individual
      // results is NOT gated on this — each `commit` above fires independently.
      await Promise.allSettled(tasks);

      return result;
    },
    [active, customContexts, zaiKey, openaiKey, enabledModels, setGlm, setGpt]
  );

  return { run };
}

function idleResult(id: string, label: string): ModelResult {
  return {
    modelId: id,
    label,
    data: {},
    rawText: '',
    elapsedMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    status: 'idle',
  };
}

function loadingResult(id: string, label: string): ModelResult {
  return {
    ...idleResult(id, label),
    status: 'loading',
  };
}

function errorResult(id: string, label: string, reason: unknown): ModelResult {
  const message = reason instanceof Error ? reason.message : String(reason);
  return { ...idleResult(id, label), status: 'error', error: message };
}

export type { GoldenValue };
