import { NextRequest, NextResponse } from 'next/server';
import { AgentToolError, runEditorAgentTool } from '@/lib/editor/agent-tools';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ejecuta una herramienta sobre la edición `?edit=<id>` (la fija el servidor al lanzar a Claude). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    await assertLocalRequest(req);
    const { name } = await params;
    const editId = req.nextUrl.searchParams.get('edit') ?? '';
    if (!editId) throw new AgentToolError('Falta la edición.', 400);
    const body = await req.json().catch(() => ({}));
    const result = await runEditorAgentTool(editId, name, body);
    return NextResponse.json({ result });
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : err instanceof AgentToolError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo ejecutar la herramienta.') }, { status });
  }
}
