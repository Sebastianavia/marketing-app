import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { autoSaveProject } from '@/lib/storage/auto-project';
import { downloadToLibrary } from '@/lib/storage/generated-library';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  category: z.enum(['HeyGen', 'UGC', 'TextToVideo', 'Genjutsu', 'Imagenes']),
  title: z.string().trim().min(1).max(120),
  /** Video remoto terminado (p. ej. URL de HeyGen): se descarga a Generados y a la carpeta del proyecto. */
  videoUrl: z.string().url().optional(),
  script: z.string().max(20_000).optional(),
  prompt: z.string().max(20_000).optional(),
  ratio: z.string().max(10).optional(),
  avatarName: z.string().max(120).optional(),
  modelUsed: z.string().max(120).optional(),
});

/** Guarda en Proyectos un resultado que terminó en el navegador (flujos que no pasan por el runner). */
export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await req.json());
    let videoPath: string | undefined;
    if (body.videoUrl) {
      videoPath = (await downloadToLibrary(body.videoUrl, 'video', 'mp4', crypto.randomUUID())).path;
    }
    const project = await autoSaveProject(
      body.category,
      body.title,
      {
        title: body.title,
        script: body.script,
        prompt: body.prompt,
        ratio: body.ratio,
        avatarName: body.avatarName,
        modelUsed: body.modelUsed,
        videoUrl: videoPath ? undefined : body.videoUrl,
      },
      { videoPath }
    );
    if (!project) return NextResponse.json({ error: 'No se pudo guardar el proyecto.' }, { status: 500 });
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    return NextResponse.json({ error: errorMessage(err, 'No se pudo guardar el proyecto.') }, { status: 500 });
  }
}
