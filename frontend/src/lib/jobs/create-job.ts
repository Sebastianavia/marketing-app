import { saveJob, type RenderJob } from './job-store';
import { wakeRunner } from './runner';
import { getPersonName, getSettings } from '@/lib/data/settings';
import { assertWithinDailyLimit } from '@/lib/usage/usage-store';
import { errorMessage } from '@/lib/errors';
import { assertVideoModelAvailable } from '@/lib/video/video-catalog';
import { GenerationError, assertOpenRouterKey } from '@/lib/generation/errors';

/**
 * Crea un trabajo de render (avatar o toma de apoyo) y despierta el runner, que lo procesa en
 * segundo plano. Compartido por /api/render-jobs (Avatar Studio) y el Director.
 * Comprueba la clave, que el modelo siga en el catálogo de OpenRouter y el límite diario.
 */

export interface NewRenderJob {
  tool: string;
  title: string;
  model: string;
  kind?: RenderJob['kind'];
  input: RenderJob['input'];
  estimatedCostUSD: number;
  productionId?: string;
  productionSceneId?: string;
}

export const MISSING_VIDEO_KEY = 'Falta OPENROUTER_API_KEY en .env.local: no se puede generar video.';

export async function createRenderJob(params: NewRenderJob): Promise<RenderJob> {
  assertOpenRouterKey(MISSING_VIDEO_KEY);
  try {
    await assertVideoModelAvailable(params.model);
  } catch (e) {
    throw new GenerationError(errorMessage(e, 'Modelo no disponible.'), 400);
  }

  const settings = await getSettings();
  await assertWithinDailyLimit(params.estimatedCostUSD, settings.dailyLimitUSD);

  const now = new Date().toISOString();
  const job: RenderJob = {
    id: crypto.randomUUID(),
    tool: params.tool,
    title: params.title,
    provider: 'openrouter',
    model: params.model,
    ...(params.kind ? { kind: params.kind } : {}),
    input: params.input,
    ...(params.productionId ? { productionId: params.productionId, productionSceneId: params.productionSceneId } : {}),
    status: 'queued',
    phase: 'En cola',
    attempts: 0,
    person: await getPersonName(),
    estimatedCostUSD: params.estimatedCostUSD,
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);
  wakeRunner();
  return job;
}
