import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { ffmpegVersion } from '@/lib/video/ffmpeg';
import { fontsDir, hasSubtitlesFilter } from '@/lib/editor/media';
import { VIDEO_EXTENSIONS } from '@/lib/editor/actions';
import { listMusic, musicDir } from '@/lib/editor/audio';
import { editorError } from '@/lib/editor/http';
import { getAllProjects, openInExplorer } from '@/lib/storage/project-storage';
import { projectCategoryLabel } from '@/config/project-categories';
import { sttCost } from '@/config/cost-rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado de lo que necesita la edición (FFmpeg con subtítulos, clave de ElevenLabs)
 * y los videos de Proyectos que se pueden editar sin volver a subirlos.
 */
export async function GET() {
  try {
    const version = await ffmpegVersion();
    const subtitulos = version ? await hasSubtitlesFilter() : false;
    const videos = (await getAllProjects())
      .filter((p) => p.videoPath && VIDEO_EXTENSIONS.includes(path.extname(p.videoPath).toLowerCase()) && fs.existsSync(p.videoPath))
      .slice(0, 80)
      .map((p) => ({
        ruta: p.videoPath!,
        titulo: p.title || p.name,
        categoria: projectCategoryLabel(p.category),
        fecha: p.updatedAt,
      }));
    return NextResponse.json({
      ffmpeg: version,
      subtitulos,
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      carpetaFuentes: await fontsDir(),
      carpetaMusica: await musicDir(),
      musica: await listMusic(),
      /** Precio de transcribir 1 minuto (USD). */
      costoMinuto: sttCost(60),
      videos,
    });
  } catch (err) {
    return editorError(err, 'No se pudo comprobar el sistema.');
  }
}

/** { accion: 'abrir_fuentes' | 'abrir_musica' }: abre la carpeta de fuentes o de música propias. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const body = (await req.json().catch(() => ({}))) as { accion?: string };
    if (body.accion === 'abrir_fuentes') await openInExplorer(await fontsDir());
    else if (body.accion === 'abrir_musica') await openInExplorer(await musicDir());
    else return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return editorError(err, 'No se pudo abrir la carpeta.');
  }
}
