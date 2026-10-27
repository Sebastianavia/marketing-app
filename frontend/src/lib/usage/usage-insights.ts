import path from 'path';
import { getJob } from '@/lib/jobs/job-store';
import { getProject as getSceneProject, projectDir } from '@/lib/scenes/scene-store';
import { getProduction } from '@/lib/director/production-store';
import type { UsageEvent } from '@/lib/usage/usage-store';
import type { UsageGroupInfo, UsageRowWithGroup } from '@/lib/usage/usage-stats';

/**
 * Solo lectura: une cada registro de costos con el "video" al que pertenece, para la vista Costos.
 * El registro (usage-store) no cambia; aquí se mira el trabajo de render (`jobs/<id>.json`)
 * cuando el registro solo trae `jobId`:
 *   producción del Director → `prod:<id>` · proyecto de Guion a video → `scene:<id>` · video suelto → `job:<id>`.
 */

export async function groupUsageRows(...lists: UsageEvent[][]): Promise<{ lists: UsageRowWithGroup[][]; groups: Record<string, UsageGroupInfo> }> {
  const groups: Record<string, UsageGroupInfo> = {};
  const jobCache = new Map<string, Awaited<ReturnType<typeof getJob>>>();

  const job = async (id: string) => {
    if (!jobCache.has(id)) jobCache.set(id, await getJob(id).catch(() => null));
    return jobCache.get(id) ?? null;
  };

  const ensureProduction = async (id: string) => {
    const key = `prod:${id}`;
    if (!groups[key]) {
      const p = await getProduction(id).catch(() => null);
      groups[key] = { key, kind: 'produccion', nombre: p?.nombre ?? 'Producción', carpeta: p?.carpeta };
    }
    return key;
  };

  const ensureScene = async (id: string) => {
    const key = `scene:${id}`;
    if (!groups[key]) {
      const s = await getSceneProject(id).catch(() => null);
      const carpeta = s?.outputPath ? path.dirname(s.outputPath) : await projectDir(id).catch(() => undefined);
      groups[key] = { key, kind: 'escenas', nombre: s?.title ?? 'Guion a video', carpeta };
    }
    return key;
  };

  const out: UsageRowWithGroup[][] = [];
  for (const rows of lists) {
    const enriched: UsageRowWithGroup[] = [];
    for (const r of rows) {
      let groupKey: string | undefined;
      if (r.productionId) groupKey = await ensureProduction(r.productionId);
      else if (r.jobId) {
        const j = await job(r.jobId);
        if (j?.productionId) groupKey = await ensureProduction(j.productionId);
        else if (j?.sceneProjectId) groupKey = await ensureScene(j.sceneProjectId);
        else {
          groupKey = `job:${r.jobId}`;
          if (!groups[groupKey]) {
            const file = j?.outputPath ?? r.filePath;
            groups[groupKey] = {
              key: groupKey,
              kind: 'suelto',
              nombre: j?.title || r.description.split(' · ')[0] || 'Video',
              carpeta: j?.projectPath ?? (file ? path.dirname(file) : undefined),
            };
          }
        }
      }
      enriched.push(groupKey ? { ...r, groupKey } : r);
    }
    out.push(enriched);
  }
  return { lists: out, groups };
}
