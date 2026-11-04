import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { getEdit } from '@/lib/editor/edit-store';
import { editorError } from '@/lib/editor/http';
import { agentTurnResponse } from '@/lib/ai/claude-code/agent-runner';
import { resetClaudeChat, sendToClaude, stopTurn, turnKey } from '@/lib/editor/claude-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sin turno en curso: { activo: false, modo }.
 * Con turno en curso: NDJSON con los eventos desde `?desde=<n>` hasta que Claude termine.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await getEdit(id);
    const from = Math.max(0, Number(req.nextUrl.searchParams.get('desde')) || 0);
    return agentTurnResponse(turnKey(id), from);
  } catch (err) {
    return editorError(err, 'No se pudo leer el chat.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('enviar'), mensaje: z.string().trim().min(1).max(4000) }),
  z.object({ accion: z.literal('detener') }),
  z.object({ accion: z.literal('nueva_conversacion') }),
]);

/** Solo desde la ventana de la app: Claude no puede escribirse a sí mismo ni reiniciarse. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    const a = parsed.data;
    if (a.accion === 'detener') return NextResponse.json({ ok: stopTurn(id) });
    if (a.accion === 'nueva_conversacion') {
      await resetClaudeChat(id);
      return NextResponse.json({ ok: true });
    }
    // Las herramientas de Lulo (MCP) llaman a la app en el mismo puerto en que corre
    const appUrl = `http://localhost:${req.nextUrl.port || '3000'}`;
    return NextResponse.json(await sendToClaude(id, a.mensaje, appUrl));
  } catch (err) {
    return editorError(err, 'No se pudo enviar a Claude.');
  }
}
