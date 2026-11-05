import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { agentTurnResponse } from '@/lib/ai/claude-code/agent-runner';
import { getStudioProject } from '@/lib/studio/store';
import { resetStudioChat, sendToStudio, stopStudioTurn, studioTurnKey } from '@/lib/studio/claude-studio';
import { studioError } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Sin turno en curso: { activo: false, modo }. Con turno: NDJSON con los eventos desde `?desde=`. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await getStudioProject(id);
    return agentTurnResponse(studioTurnKey(id), Math.max(0, Number(req.nextUrl.searchParams.get('desde')) || 0));
  } catch (err) {
    return studioError(err, 'No se pudo leer el chat.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('enviar'), mensaje: z.string().trim().min(1).max(6000) }),
  z.object({ accion: z.literal('detener') }),
  z.object({ accion: z.literal('nueva_conversacion') }),
]);

/** Solo desde la ventana de la app. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    const a = parsed.data;
    if (a.accion === 'detener') return NextResponse.json({ ok: stopStudioTurn(id) });
    if (a.accion === 'nueva_conversacion') {
      await resetStudioChat(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await sendToStudio(id, a.mensaje, `http://localhost:${req.nextUrl.port || '3000'}`));
  } catch (err) {
    return studioError(err, 'No se pudo enviar a Claude.');
  }
}
