import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { addToLibrary, editItem, ensureLocal, findItem, LIBRARY_EXT, LibraryError, LibraryInputSchema, loadLibrary, setItemState } from '@/lib/editor/audio-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 60 * 1024 * 1024;

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join('; ') }, { status: 400 });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Catálogo (GET) o el audio de una entrada para escucharlo (GET ?id=). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json(await loadLibrary());
    const it = await findItem(id);
    const file = await ensureLocal(it);
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': LIBRARY_EXT[it.ext] ?? 'application/octet-stream', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    return fail(err, 'No se pudo leer la biblioteca.');
  }
}

/** Subir un audio: multipart con `archivo` y `datos` (JSON con nombre, tipo, etiquetas, licencia…). */
export async function POST(req: NextRequest) {
  let tmp = '';
  try {
    assertAppUiRequest(req);
    const form = await req.formData();
    const file = form.get('archivo');
    if (!(file instanceof File)) throw new LibraryError('Falta el archivo de audio.');
    if (file.size > MAX_BYTES) throw new LibraryError('El audio pesa más de 60 MB.');
    const ext = path.extname(file.name).toLowerCase();
    if (!LIBRARY_EXT[ext]) throw new LibraryError(`Formato no admitido (${Object.keys(LIBRARY_EXT).join(', ')}).`);
    const datos = LibraryInputSchema.parse(JSON.parse(String(form.get('datos') ?? '{}')));
    tmp = path.join(os.tmpdir(), `lulo-audio-${randomUUID()}${ext}`);
    await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    const item = await addToLibrary(tmp, file.name, datos);
    return NextResponse.json({ item, ...(await loadLibrary()) });
  } catch (err) {
    return fail(err, 'No se pudo subir el audio.');
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('retirar'), id: z.string().max(20) }),
  z.object({ accion: z.literal('reactivar'), id: z.string().max(20) }),
  z.object({ accion: z.literal('editar'), id: z.string().max(20), datos: LibraryInputSchema.partial() }),
]);

export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new LibraryError('Datos no válidos.');
    const a = parsed.data;
    if (a.accion === 'editar') await editItem(a.id, a.datos);
    else await setItemState(a.id, a.accion === 'retirar' ? 'retirada' : 'activa');
    return NextResponse.json(await loadLibrary());
  } catch (err) {
    return fail(err, 'No se pudo cambiar la biblioteca.');
  }
}
