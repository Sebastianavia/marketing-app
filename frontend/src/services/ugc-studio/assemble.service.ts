import fs from 'fs/promises';
import path from 'path';
import {
  colorMatchFilter,
  colorMidpoint,
  ColorRamp,
  CONTINUOUS_LEAD_TRIM_SECONDS,
  concatClips,
  frameColorStats,
  makeTempDir,
  probeDurationSeconds,
  probeVideoWindow,
} from '@/lib/video/ffmpeg';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { getProject, saveProject, sanitizeProjectName } from '@/lib/storage/project-storage';
import { sanitizeSettings, Storyboard, StudioSettings, UGC_VIDEO_MODEL, UgcReference } from '@/types/ugc-studio.types';

/**
 * Montaje del video final de UGC Studio (lo usan la ruta /api/ugc-studio/assemble y el Estudio Claude):
 * descarga las escenas renderizadas, las une con FFmpeg y lo guarda como proyecto UGC.
 */

export class AssembleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const FRAME_SIZES: Record<string, Record<string, { width: number; height: number }>> = {
  '480p': { '9:16': { width: 480, height: 854 }, '16:9': { width: 854, height: 480 }, '1:1': { width: 480, height: 480 } },
  '768p': { '9:16': { width: 768, height: 1366 }, '16:9': { width: 1366, height: 768 }, '1:1': { width: 768, height: 768 } },
};

export async function assembleStoryboard(o: {
  storyboard: Storyboard;
  references: UgcReference[];
  settings: Partial<StudioSettings>;
  projectName?: string;
}) {
  const dir = await makeTempDir();
  try {
    const settings = sanitizeSettings(o.settings);
    const scenes = [...o.storyboard.scenes].sort((a, b) => a.index - b.index);
    const missing = scenes.filter((s) => !s.render?.videoUrl).map((s) => s.index);
    if (missing.length > 0) {
      throw new AssembleError(`Faltan por renderizar las escenas: ${missing.join(', ')}`, 409);
    }

    const files = await Promise.all(
      scenes.map(async (s) => {
        const res = await fetch(s.render!.videoUrl!);
        if (!res.ok) throw new Error(`No se pudo descargar la escena ${s.index}`);
        const file = path.join(dir, `scene_${s.index}.mp4`);
        await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
        return file;
      })
    );

    // Escenas "continua" ya arrancan en el último fotograma de la anterior: corte directo.
    // Un plano nuevo ("corte_con_referencias") lleva un fundido corto para suavizar el salto.
    const crossfades = scenes.slice(1).map((s) => (s.transition.type === 'corte_con_referencias' ? 0.25 : 0));
    // Las escenas "continua" arrancan casi quietas y en silencio: se recorta ese arranque lento
    const trims = scenes.map((s) => (s.transition.type === 'continua' ? CONTINUOUS_LEAD_TRIM_SECONDS : 0));
    // Degradado de color en cada corte hacia una escena "continua": la anterior migra hacia un punto
    // intermedio en sus últimos segundos y la nueva arranca ahí y vuelve a su color natural
    // El cuadro final sale de cómo se renderizaron los clips, no de los ajustes actuales (pueden haber cambiado)
    const aspects = scenes.map((s) => s.render?.aspectRatio ?? settings.aspectRatio);
    const mixed = scenes.filter((_, i) => aspects[i] !== aspects[0]).map((s) => s.index);
    if (mixed.length > 0) {
      throw new AssembleError(`La escena ${mixed.join(', ')} se renderizó en otro formato de pantalla que la escena 1: vuelve a renderizarla en ${aspects[0]}.`, 409);
    }
    const resolution = scenes[0].render?.resolution ?? settings.resolution;
    const size = FRAME_SIZES[resolution]?.[aspects[0]] ?? FRAME_SIZES['480p']['9:16'];
    const colorRamps: ColorRamp[] = scenes.map(() => ({}));
    for (let i = 1; i < scenes.length; i++) {
      if (scenes[i].transition.type !== 'continua') continue;
      const [previousEnd, start] = await Promise.all([
        frameColorStats(files[i - 1], { fromEnd: 0.15 }, size),
        probeVideoWindow(files[i]).then((w) => frameColorStats(files[i], { start: w.start + trims[i] }, size)),
      ]);
      const meeting = colorMidpoint(previousEnd, start);
      colorRamps[i - 1].out = colorMatchFilter(meeting, previousEnd);
      colorRamps[i].in = colorMatchFilter(meeting, start);
    }
    const output = path.join(dir, 'final.mp4');
    await concatClips(files, crossfades, output, size, trims, colorRamps);

    const finalBuffer = await fs.readFile(output);
    const uploaded = await cloudinaryStorageService.uploadVideo(finalBuffer, `${o.storyboard.id}_final.mp4`);

    const totalCost = scenes.reduce((sum, s) => sum + (s.render?.costUSD ?? 0), 0);
    const totalSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0); // segundos cobrados
    const finalSeconds = Number((await probeDurationSeconds(output)).toFixed(2)); // tras recortes
    const projectData = {
      title: o.storyboard.title,
      script: scenes.map((s) => `[Escena ${s.index}] ${s.dialogue.map((d) => `${d.speaker}: ${d.line}`).join(' ')}`).join('\n'),
      prompt: scenes.map((s) => `[Escena ${s.index}] ${s.videoPrompt}`).join('\n\n'),
      imageUrl: o.references.find((r) => r.role === 'personaje')?.url ?? o.references[0]?.url,
      ratio: aspects[0],
      videoUrl: uploaded.publicUrl,
      status: 'rendered' as const,
      tags: ['ugc-studio', 'multi-agente'],
      finalCostUSD: Number(totalCost.toFixed(4)),
      videoDurationReal: finalSeconds,
      modelUsed: UGC_VIDEO_MODEL,
      costPerSecondVerified: totalSeconds > 0 ? Number((totalCost / totalSeconds).toFixed(4)) : undefined,
      ugcStudio: { storyboard: o.storyboard, references: o.references, settings },
    };

    // No pisar otro proyecto con el mismo nombre: solo se sobrescribe si es este mismo storyboard
    const baseName = o.projectName?.trim() || o.storyboard.title;
    let name = baseName;
    for (let n = 2; ; n++) {
      const existing = await getProject('UGC', sanitizeProjectName(name));
      const existingStoryboardId = (existing?.ugcStudio?.storyboard as Storyboard | undefined)?.id;
      if (!existing || existingStoryboardId === o.storyboard.id) break;
      name = `${baseName} ${n}`;
    }
    const { project } = await saveProject('UGC', name, projectData);
    const videoPath = path.join(project.path, 'final.mp4');
    await fs.copyFile(output, videoPath);
    const saved = await saveProject('UGC', name, { ...projectData, id: project.id, createdAt: project.createdAt, videoPath });

    return { videoUrl: uploaded.publicUrl, project: saved.project, trimmedSeconds: trims, videoPath, name };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
