import { NextRequest, NextResponse } from 'next/server';
import { runStudioTool } from '@/lib/studio/tools';
import { StudioError } from '@/lib/studio/store';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 2400;

/** Ejecuta una herramienta sobre el proyecto `?studio=<id>` (lo fija el servidor al lanzar a Claude). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    await assertLocalRequest(req);
    const { name } = await params;
    const id = req.nextUrl.searchParams.get('studio') ?? '';
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ result: await runStudioTool(id, name, body) });
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : err instanceof StudioError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo ejecutar la herramienta.') }, { status });
  }
}
