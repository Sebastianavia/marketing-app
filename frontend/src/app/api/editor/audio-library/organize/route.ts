import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { FreeQuotaError } from '@/lib/ai/orchestrator';
import { LibraryError } from '@/lib/editor/audio-library';
import { applyOrganization, cancelOrganize, getOrganizeJob, startOrganize, tidyLibrary } from '@/lib/editor/audio-organize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof FreeQuotaError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join('; ') }, { status: 400 });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Estado de las propuestas (?id=). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const job = getOrganizeJob(req.nextUrl.searchParams.get('id') ?? '');
    if (!job) return NextResponse.json({ error: 'Esa organización ya no existe.' }, { status: 404 });
    return NextResponse.json({ organizacion: job });
  } catch (err) {
    return fail(err, 'No se pudo leer la organización.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('ordenar') }),
  z.object({ accion: z.literal('proponer'), todos: z.boolean().default(false), ids: z.array(z.string().max(20)).max(400).optional() }),
  z.object({ accion: z.literal('cancelar'), id: z.string().max(20) }),
  z.object({ accion: z.literal('aplicar'), cambios: z.array(z.unknown()).min(1).max(400) }),
]);

/** ordenar = limpiar etiquetas y tipos (gratis); proponer = Claude propone; aplicar = guardar lo elegido. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' }, { status: 400 });
    const b = parsed.data;
    if (b.accion === 'ordenar') return NextResponse.json(await tidyLibrary());
    if (b.accion === 'cancelar') return NextResponse.json({ ok: cancelOrganize(b.id) });
    if (b.accion === 'aplicar') return NextResponse.json(await applyOrganization({ cambios: b.cambios }));
    return NextResponse.json({ organizacion: await startOrganize({ todos: b.todos, ids: b.ids }) });
  } catch (err) {
    return fail(err, 'No se pudo organizar la biblioteca.');
  }
}
