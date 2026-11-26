import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { LibraryError } from '@/lib/editor/audio-library';
import { cancelImport, getImportJob, listImportJobs, startImport } from '@/lib/editor/audio-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Estado de una importación (?id=) o de todas las de esta sesión de la app. */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ importaciones: listImportJobs() });
    const job = getImportJob(id);
    if (!job) return NextResponse.json({ error: 'Esa importación ya no existe.' }, { status: 404 });
    return NextResponse.json({ importacion: job });
  } catch (err) {
    return fail(err, 'No se pudo leer la importación.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('importar'), carpeta: z.string().trim().min(2).max(1000), pack: z.string().trim().max(60).optional() }),
  z.object({ accion: z.literal('cancelar'), id: z.string().max(20) }),
]);

/** importar = empieza a importar una carpeta (en segundo plano); cancelar = la detiene. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' }, { status: 400 });
    const b = parsed.data;
    if (b.accion === 'cancelar') return NextResponse.json({ ok: cancelImport(b.id) });
    return NextResponse.json({ importacion: await startImport(b.carpeta, b.pack) });
  } catch (err) {
    return fail(err, 'No se pudo importar la carpeta.');
  }
}
