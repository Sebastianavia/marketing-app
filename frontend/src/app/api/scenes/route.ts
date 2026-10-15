import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getPersonName, getSettings } from '@/lib/data/settings';
import { assertWithinDailyLimit, DailyLimitError } from '@/lib/usage/usage-store';
import { projectDir, saveProject, listProjects, type SceneProject } from '@/lib/scenes/scene-store';
import { estimateSceneProject } from '@/lib/scenes/scene-estimate';
import { wakeSceneRunner } from '@/lib/scenes/scene-runner';
import { ffmpegVersion } from '@/lib/video/ffmpeg';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { getElevenModel } from '@/config/elevenlabs-models';
import { BROLL_MODELS, getBrollModel } from '@/config/broll-models';
import { localMediaUrl } from '@/lib/storage/generated-library';
import { errorMessage } from '@/lib/errors';
import { assertVideoModelAvailable } from '@/lib/video/video-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Create = z.object({
  title: z.string().trim().min(1).max(80),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  brollModel: z.string().refine((m) => BROLL_MODELS.some((b) => b.id === m), 'Modelo de tomas de apoyo no válido.'),
  voiceMode: z.enum(['voiceover', 'native', 'avatar']).default('avatar'),
  avatarMotion: z
    .object({ motionPrompt: z.string().max(500).optional(), expressiveness: z.enum(['low', 'medium', 'high']).optional() })
    .optional(),
  voice: z
    .object({
      voiceId: z.string().min(1, 'Elige una voz.'),
      voiceName: z.string().optional(),
      modelId: z.string().min(1),
      settings: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
  images: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/i),
        name: z.string().max(120),
        dataBase64: z.string().max(14_000_000, 'Cada imagen debe pesar menos de 10 MB.'),
      })
    )
    .max(8)
    .default([]),
  scenes: z
    .array(
      z.object({
        type: z.enum(['avatar', 'broll']),
        narration: z.string().trim().min(1, 'Cada escena necesita texto.').max(1500),
        visualPrompt: z.string().max(1500).default(''),
        imageId: z.string().optional(),
      })
    )
    .min(1)
    .max(20),
});

/** Crea el proyecto y lo deja en cola; el proceso en segundo plano hace el resto. */
export async function POST(req: NextRequest) {
  try {
    const body = Create.parse(await req.json());
    const native = body.voiceMode === 'native';
    if (!native && !body.voice) {
      return NextResponse.json({ error: 'Elige una voz.' }, { status: 400 });
    }
    if (body.voiceMode !== 'avatar') {
      // En voz en off y en "los personajes hablan" todas las escenas son clips del modelo de video
      body.scenes = body.scenes.map((s) => ({ ...s, type: 'broll' as const }));
    }
    if (body.scenes.some((s) => s.type === 'avatar') && body.images.length === 0) {
      return NextResponse.json({ error: 'Sube la foto de la persona para las escenas donde habla.' }, { status: 400 });
    }
    if (native && !getBrollModel(body.brollModel).audio) {
      return NextResponse.json({ error: 'Ese modelo no genera voz; elige Veo, Kling o Wan.' }, { status: 400 });
    }

    // Comprobaciones antes de gastar nada
    const missing: string[] = [];
    if (!process.env.OPENROUTER_API_KEY?.trim()) missing.push('OPENROUTER_API_KEY');
    if (!native && !process.env.ELEVENLABS_API_KEY?.trim()) missing.push('ELEVENLABS_API_KEY');
    if (missing.length) {
      return NextResponse.json({ error: `Falta ${missing.join(' y ')} en .env.local.` }, { status: 400 });
    }
    if (!cloudinaryStorageService.configured) {
      return NextResponse.json({ error: 'Cloudinary no está configurado: hace falta para pasar imágenes y audio al proveedor de video.' }, { status: 400 });
    }
    if (!(await ffmpegVersion())) {
      return NextResponse.json(
        { error: 'No se encontró FFmpeg, necesario para montar el video. En la carpeta frontend ejecuta: npm i ffmpeg-static, y reinicia la app.', code: 'no_ffmpeg' },
        { status: 400 }
      );
    }
    try {
      if (body.scenes.some((s) => s.type === 'avatar')) await assertVideoModelAvailable('heygen/avatar-iv');
      if (body.scenes.some((s) => s.type === 'broll')) await assertVideoModelAvailable(body.brollModel);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Modelo no disponible.') }, { status: 400 });
    }
    const fullText = body.scenes.map((s) => s.narration).join(' ');
    if (body.voice) {
      const spec = getElevenModel(body.voice.modelId);
      if (!native && fullText.length > spec.charLimit) {
        return NextResponse.json({ error: `El guion completo supera los ${spec.charLimit.toLocaleString()} caracteres de ${spec.name}.` }, { status: 400 });
      }
    }

    const estimate = estimateSceneProject({
      voiceModelId: body.voice?.modelId ?? '',
      brollModel: body.brollModel,
      voiceMode: body.voiceMode,
      scenes: body.scenes,
    });
    const settings = await getSettings();
    await assertWithinDailyLimit(estimate.totalUSD, settings.dailyLimitUSD);

    const id = crypto.randomUUID();
    const dir = await projectDir(id);
    const images: SceneProject['images'] = [];
    for (const img of body.images) {
      const ext = (img.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const file = path.join(/*turbopackIgnore: true*/ dir, `imagen_${img.id}.${ext}`);
      await fs.writeFile(file, Buffer.from(img.dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
      images.push({ id: img.id, name: img.name, path: file });
    }

    const now = new Date().toISOString();
    const project: SceneProject = {
      id,
      title: body.title,
      status: 'queued',
      phase: 'En cola',
      person: await getPersonName(),
      aspectRatio: body.aspectRatio,
      brollModel: body.brollModel,
      voiceMode: body.voiceMode,
      avatarMotion: body.avatarMotion,
      voice: body.voice ?? { voiceId: '', modelId: '', settings: {} },
      images,
      scenes: body.scenes.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type,
        narration: s.narration,
        visualPrompt: s.visualPrompt,
        imageId:
          s.type === 'broll' && s.imageId === 'none'
            ? 'none'
            : s.imageId && images.some((i) => i.id === s.imageId)
            ? s.imageId
            : images[0]?.id ?? 'none',
        status: 'pending',
      })),
      crossfade: 0.5,
      estimatedCostUSD: Math.round(estimate.totalUSD * 10000) / 10000,
      costUSD: 0,
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(project);
    wakeSceneRunner();
    return NextResponse.json({ id }, { status: 202 });
  } catch (err) {
    if (err instanceof DailyLimitError) {
      return NextResponse.json({ error: err.message, code: 'daily_limit' }, { status: 402 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    }
    return NextResponse.json({ error: errorMessage(err, 'No se pudo crear el proyecto.') }, { status: 500 });
  }
}

/** Lista de proyectos (los más recientes primero). ?active=1 solo los que siguen en curso. */
export async function GET(req: NextRequest) {
  const active = new URL(req.url).searchParams.get('active');
  const list = await listProjects(active ? { status: ['queued', 'voice', 'clips', 'stitching'] } : {});
  return NextResponse.json({
    projects: list.slice(0, 30).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      phase: p.phase,
      createdAt: p.createdAt,
      costUSD: p.costUSD,
      outputUrl: p.outputPath ? localMediaUrl(p.outputPath) : null,
    })),
  });
}
