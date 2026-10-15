import { NextRequest, NextResponse } from 'next/server';
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

export const runtime = 'nodejs';
export const maxDuration = 300;

const FRAME_SIZES: Record<string, Record<string, { width: number; height: number }>> = {
  '480p': { '9:16': { width: 480, height: 854 }, '16:9': { width: 854, height: 480 }, '1:1': { width: 480, height: 480 } },
  '768p': { '9:16': { width: 768, height: 1366 }, '16:9': { width: 1366, height: 768 }, '1:1': { width: 768, height: 768 } },
};

/** Une las escenas renderizadas en un MP4 final y lo guarda como proyecto UGC. */
export async function POST(req: NextRequest) {
  const dir = await makeTempDir();
  try {
    const body = (await req.json()) as {
      storyboard: Storyboard;
      references: UgcReference[];
      settings: Partial<StudioSettings>;
      projectName?: string;
    };
    const settings = sanitizeSettings(body.settings);
    const scenes = [...body.storyboard.scenes].sort((a, b) => a.index - b.index);
    const missing = scenes.filter((s) => !s.render?.videoUrl).map((s) => s.index);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Faltan por renderizar las escenas: ${missing.join(', ')}` }, { status: 409 });
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
    const size = FRAME_SIZES[settings.resolution]?.[settings.aspectRatio] ?? FRAME_SIZES['480p']['9:16'];
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
    const uploaded = await cloudinaryStorageService.uploadVideo(finalBuffer, `${body.storyboard.id}_final.mp4`);

    const totalCost = scenes.reduce((sum, s) => sum + (s.render?.costUSD ?? 0), 0);
    const totalSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0); // segundos cobrados
    const finalSeconds = Number((await probeDurationSeconds(output)).toFixed(2)); // tras recortes
    const projectData = {
      title: body.storyboard.title,
      script: scenes.map((s) => `[Escena ${s.index}] ${s.dialogue.map((d) => `${d.speaker}: ${d.line}`).join(' ')}`).join('\n'),
      prompt: scenes.map((s) => `[Escena ${s.index}] ${s.videoPrompt}`).join('\n\n'),
      imageUrl: body.references.find((r) => r.role === 'personaje')?.url ?? body.references[0]?.url,
      ratio: settings.aspectRatio,
      videoUrl: uploaded.publicUrl,
      status: 'rendered' as const,
      tags: ['ugc-studio', 'multi-agente'],
      finalCostUSD: Number(totalCost.toFixed(4)),
      videoDurationReal: finalSeconds,
      modelUsed: UGC_VIDEO_MODEL,
      costPerSecondVerified: totalSeconds > 0 ? Number((totalCost / totalSeconds).toFixed(4)) : undefined,
      ugcStudio: { storyboard: body.storyboard, references: body.references, settings },
    };

    // No pisar otro proyecto con el mismo nombre: solo se sobrescribe si es este mismo storyboard
    const baseName = body.projectName?.trim() || body.storyboard.title;
    let name = baseName;
    for (let n = 2; ; n++) {
      const existing = await getProject('UGC', sanitizeProjectName(name));
      const existingStoryboardId = (existing?.ugcStudio?.storyboard as Storyboard | undefined)?.id;
      if (!existing || existingStoryboardId === body.storyboard.id) break;
      name = `${baseName} ${n}`;
    }
    const { project } = await saveProject('UGC', name, projectData);
    const videoPath = path.join(project.path, 'final.mp4');
    await fs.copyFile(output, videoPath);
    const saved = await saveProject('UGC', name, { ...projectData, id: project.id, createdAt: project.createdAt, videoPath });

    return NextResponse.json({ videoUrl: uploaded.publicUrl, project: saved.project, trimmedSeconds: trims });
  } catch (error: any) {
    console.error('[UGC Studio Assemble]:', error);
    return NextResponse.json({ error: error.message || 'Error al ensamblar el video final.' }, { status: 500 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
