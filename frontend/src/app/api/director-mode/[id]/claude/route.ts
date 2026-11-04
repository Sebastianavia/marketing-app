import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { ProductionError } from '@/lib/director/production-store';
import { agentTurnResponse } from '@/lib/ai/claude-code/agent-runner';
import { getDirectorProduction } from '@/lib/director-mode/engine';
import {
  directorTurnKey,
  isDirectorTurnActive,
  resetDirectorChat,
  sendToDirector,
  startDirectorFirstPass,
  stopDirectorTurn,
} from '@/lib/director-mode/claude-director';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof ProductionError) return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Sin turno en curso: { activo: false, modo }. Con turno: NDJSON con los eventos desde `?desde=`. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await getDirectorProduction(id);
    const from = Math.max(0, Number(req.nextUrl.searchParams.get('desde')) || 0);
    return agentTurnResponse(directorTurnKey(id), from);
  } catch (err) {
    return fail(err, 'No se pudo leer el chat.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('enviar'), mensaje: z.string().trim().min(1).max(4000) }),
  z.object({ accion: z.literal('detener') }),
  z.object({ accion: z.literal('nueva_conversacion') }),
  /** Proyecto recién creado (ya con sus referencias): Claude lo arma desde la idea. Solo si el chat está vacío. */
  z.object({ accion: z.literal('iniciar') }),
]);

/** Solo desde la ventana de la app. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    const a = parsed.data;
    if (a.accion === 'detener') return NextResponse.json({ ok: stopDirectorTurn(id) });
    if (a.accion === 'nueva_conversacion') {
      await resetDirectorChat(id);
      return NextResponse.json({ ok: true });
    }
    const appUrl = `http://localhost:${req.nextUrl.port || '3000'}`;
    if (a.accion === 'iniciar') {
      const p = await getDirectorProduction(id);
      if (isDirectorTurnActive(id) || (p.director?.claude?.mensajes.length ?? 0) > 0) return NextResponse.json({ ok: false });
      await startDirectorFirstPass(id, appUrl);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await sendToDirector(id, a.mensaje, appUrl));
  } catch (err) {
    return fail(err, 'No se pudo enviar a Claude.');
  }
}
