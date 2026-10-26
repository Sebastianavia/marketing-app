import { NextResponse } from 'next/server';
import { directorToolsManifest } from '@/lib/director/tools';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista de herramientas del Director (la usa el servidor MCP). Solo desde este equipo. */
export async function GET(req: Request) {
  try {
    await assertLocalRequest(req);
    return NextResponse.json({ tools: directorToolsManifest() });
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron listar las herramientas.') }, { status });
  }
}
