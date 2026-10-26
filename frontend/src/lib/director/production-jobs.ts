import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { getJob, type RenderJob } from '@/lib/jobs/job-store';
import {
  findScene,
  placeInProduction,
  roundUSD,
  sceneFileName,
  updateProduction,
  type Production,
  type ProductionScene,
} from './production-store';

/**
 * Enlace entre el runner de renders y las producciones del Director: cuando termina o falla un
 * trabajo con `productionId`, el MP4 se pone en la carpeta de la producción, se suma el gasto a la
 * escena y se borran los temporales de Cloudinary. Nunca lanza: un fallo aquí no debe tumbar el runner.
 */

async function cleanTemporaries(scene: ProductionScene) {
  for (const t of scene.temporales ?? []) {
    try {
      await cloudinaryStorageService.deleteAsset(t.publicId, t.resourceType);
    } catch (err) {
      console.warn('[produccion] No se pudo borrar un temporal de Cloudinary:', err);
    }
  }
  scene.temporales = [];
}

/** Aplica un trabajo terminado a su escena. Idempotente: si el clip ya está anotado, no hace nada. */
async function applyCompleted(p: Production, scene: ProductionScene, job: RenderJob) {
  if (scene.archivos.some((f) => f.jobId === job.id)) return;
  if (!job.outputPath) return;
  const ruta = await placeInProduction(p, job.outputPath, sceneFileName(scene, 'clip', 'mp4'));
  const costUSD = job.costUSD ?? 0;
  scene.archivos.push({
    id: crypto.randomUUID(),
    rol: 'clip',
    herramienta: job.kind === 'broll' ? 'toma_de_apoyo' : 'video_avatar',
    modelo: job.model,
    prompt: job.input.prompt || job.input.motionPrompt,
    costoEstimadoUSD: job.estimatedCostUSD ?? 0,
    costoUSD: costUSD,
    ruta,
    jobId: job.id,
    version: scene.version,
    creado: new Date().toISOString(),
  });
  scene.gastoUSD = roundUSD(scene.gastoUSD + costUSD);
  if (scene.jobId === job.id) {
    scene.estado = 'lista';
    scene.error = undefined;
  }
  await cleanTemporaries(scene);
}

function applyFailed(scene: ProductionScene, job: RenderJob, message: string) {
  if (scene.jobId !== job.id || scene.estado !== 'generando') return;
  scene.estado = 'fallida';
  scene.error = message;
}

export async function onProductionJobCompleted(job: RenderJob) {
  if (!job.productionId || !job.productionSceneId) return;
  try {
    await updateProduction(job.productionId, (p) => applyCompleted(p, findScene(p, job.productionSceneId!), job));
  } catch (err) {
    console.error('[produccion] No se pudo anotar el clip terminado:', err);
  }
}

export async function onProductionJobFailed(job: RenderJob, message: string) {
  if (!job.productionId || !job.productionSceneId) return;
  try {
    await updateProduction(job.productionId, async (p) => {
      const scene = findScene(p, job.productionSceneId!);
      applyFailed(scene, job, message);
      await cleanTemporaries(scene);
    });
  } catch (err) {
    console.error('[produccion] No se pudo anotar el trabajo fallido:', err);
  }
}

/** Escenas "generando" sin trabajo que lleven más de esto se dan por interrumpidas (la app se cerró). */
const STALE_MS = 15 * 60 * 1000;

/**
 * Pone al día las escenas con lo que dicen sus trabajos (por si la app se cerró justo al terminar)
 * y marca como fallidas las generaciones sin trabajo que quedaron colgadas.
 */
export async function reconcileProduction(id: string): Promise<Production> {
  const { production } = await updateProduction(id, async (p) => {
    for (const scene of p.escenas) {
      if (scene.estado !== 'generando') continue;
      if (scene.jobId) {
        const job = await getJob(scene.jobId);
        if (job?.status === 'completed') await applyCompleted(p, scene, job);
        else if (job?.status === 'failed') applyFailed(scene, job, job.error || 'El render falló.');
        else if (!job) applyFailed(scene, { id: scene.jobId } as RenderJob, 'No se encontró el trabajo de render.');
      } else if (Date.now() - Date.parse(p.actualizada) > STALE_MS) {
        scene.estado = 'fallida';
        // No se sabe si llegó a cobrar: por seguridad, reintentar pedirá aprobación nueva
        scene.falloConCobro = true;
        scene.error = 'La generación se interrumpió (¿se cerró la app?).';
      }
    }
  });
  return production;
}
