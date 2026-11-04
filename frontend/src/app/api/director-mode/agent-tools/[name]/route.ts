import { NextRequest, NextResponse } from 'next/server';
import { DirectorAgentToolError, runDirectorAgentTool } from '@/lib/director-mode/agent-tools';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { FreeQuotaError } from '@/lib/ai/orchestrator';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Ejecuta una herramienta sobre la producción `?prod=<id>` (la fija el servidor al lanzar a Claude). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    await assertLocalRequest(req);
    const { name } = await params;
    const id = req.nextUrl.searchParams.get('prod') ?? '';
    if (!id) throw new DirectorAgentToolError('Falta la producción.');
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ result: await runDirectorAgentTool(id, name, body) });
  } catch (err) {
    const status =
      err instanceof ForbiddenError ? 403 : err instanceof DirectorAgentToolError ? err.status : err instanceof FreeQuotaError ? 409 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo ejecutar la herramienta.') }, { status });
  }
}
