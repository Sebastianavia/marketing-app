import { NextResponse } from 'next/server';
import { studioToolsManifest } from '@/lib/studio/tools';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Herramientas de Claude en el Estudio (las pide el servidor MCP). Solo desde este equipo con el token. */
export async function GET(req: Request) {
  try {
    await assertLocalRequest(req);
    return NextResponse.json({ tools: studioToolsManifest() });
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron listar las herramientas.') }, { status });
  }
}
