import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { ProductionError } from '@/lib/director/production-store';
import { addReferences, getDirectorProduction } from '@/lib/director-mode/engine';
import { refAbsPath, refType, type IncomingRef } from '@/lib/director-mode/references';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET ?ref=<id>: sirve una referencia de la producción (miniaturas, audio con saltos por Range, PDF).
 * Solo archivos registrados en produccion.json, nunca una ruta libre.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refId = req.nextUrl.searchParams.get('ref') ?? '';
    const p = await getDirectorProduction(id);
    const ref = p.director!.referencias?.find((r) => r.id === refId);
    if (!ref) return new NextResponse('Referencia no encontrada', { status: 404 });
    const file = refAbsPath(p.carpeta, ref.archivo);
    if (!fs.existsSync(file)) return new NextResponse('El archivo ya no está en la carpeta de la producción', { status: 404 });
    const size = fs.statSync(file).size;
    const type = refType(ref.archivo)?.mime ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300' };

    // El audio necesita Range para poder saltar a una escena (#t=inicio,fin)
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
    return new NextResponse(errorMessage(err, 'No se pudo leer la referencia.'), { status });
  }
}

/**
 * POST multipart: `archivos` (uno o varios), `escenaId` (opcional: solo para esa escena), `etiquetaId` (opcional).
 * Guarda en <carpeta de la producción>/referencias/ y registra en produccion.json. $0.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const form = await req.formData();
    const files: IncomingRef[] = [];
    for (const v of form.getAll('archivos')) {
      if (typeof v === 'string') continue;
      files.push({ name: v.name || 'archivo', bytes: Buffer.from(await v.arrayBuffer()) });
    }
    const escenaId = String(form.get('escenaId') ?? '').trim() || undefined;
    const etiquetaId = String(form.get('etiquetaId') ?? '').trim() || undefined;
    return NextResponse.json(await addReferences(id, files, { escenaId, etiquetaId }));
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    const status = err instanceof ProductionError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron guardar las referencias.') }, { status });
  }
}
