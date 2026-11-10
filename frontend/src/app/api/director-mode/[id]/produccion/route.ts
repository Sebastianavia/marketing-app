import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { currentFiles, ProductionError } from '@/lib/director/production-store';
import { getDirectorProduction } from '@/lib/director-mode/engine';
import { assembleFinal, generationStatus, prepareGeneration, redoPaidScene, runGeneration } from '@/lib/director-mode/generation';
import { DailyLimitError } from '@/lib/usage/usage-store';
import { GenerationError } from '@/lib/generation/errors';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generar espera las imágenes iniciales (~1 min cada tanda de 4)
export const maxDuration = 600;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * GET ?escena=<id de escena de pago>&rol=imagen|clip|voz — o ?final=1: sirve el archivo actual (miniaturas del
 * lienzo, clips y audio con Range). Solo archivos registrados en produccion.json, nunca una ruta libre.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const p = await getDirectorProduction(id);
    const q = req.nextUrl.searchParams;
    let file: string | undefined;
    if (q.get('final')) {
      const f = p.director?.produccion?.final;
      file = f ? path.join(/*turbopackIgnore: true*/ p.carpeta, f.archivo) : undefined;
    } else {
      const rawRol = q.get('rol');
      const rol = rawRol === 'clip' ? 'clip' : rawRol === 'voz' ? 'voz' : 'imagen';
      const scene = p.escenas.find((s) => s.id === q.get('escena'));
      file = scene ? currentFiles(scene, rol)[0]?.ruta : undefined;
    }
    if (!file || !fs.existsSync(file)) return new NextResponse('Archivo no encontrado', { status: 404 });
    const size = fs.statSync(file).size;
    const headers: Record<string, string> = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const body = fs.readFileSync(file).subarray(start, end + 1);
      return new NextResponse(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(body.length) } });
    }
    const body = fs.readFileSync(file);
    return new NextResponse(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  } catch (err) {
    const status = err instanceof ProductionError ? err.status : 500;
    return new NextResponse(errorMessage(err, 'No se pudo leer el archivo.'), { status });
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('preparar') }),
  z.object({
    accion: z.literal('generar'),
    fase: z.enum(['todo', 'storyboard', 'clips']).optional(),
    escenaPagoId: z.string().max(20).optional(),
  }),
  z.object({ accion: z.literal('rehacer_pago'), escenaPagoId: z.string().min(1).max(20) }),
  z.object({ accion: z.literal('estado') }),
  z.object({ accion: z.literal('montar'), pulirConClaude: z.boolean().default(false) }),
]);

/**
 * Generación desde los botones de la app (lo mismo que las herramientas de Claude · director).
 * preparar = presupuesto y solicitud de aprobación ($0); generar = solo lo aprobado (todo, storyboard o un nodo);
 * rehacer_pago = archiva y pide nueva aprobación para un nodo; montar = FFmpeg ($0).
 * Aprobar sigue siendo SOLO el aviso del Director en la barra superior.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    const a = parsed.data;
    const resultado =
      a.accion === 'preparar'
        ? await prepareGeneration(id)
        : a.accion === 'generar'
          ? await runGeneration(id, { fase: a.fase, escenaPagoId: a.escenaPagoId })
          : a.accion === 'rehacer_pago'
            ? await redoPaidScene(id, a.escenaPagoId)
            : a.accion === 'montar'
              ? await assembleFinal(id, { pulirConClaude: a.pulirConClaude })
              : await generationStatus(id);
    return NextResponse.json({ resultado, production: await getDirectorProduction(id) });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    const status =
      err instanceof ProductionError || err instanceof GenerationError ? err.status : err instanceof DailyLimitError ? 402 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo completar.') }, { status });
  }
}
