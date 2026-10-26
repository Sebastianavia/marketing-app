import { NextResponse } from 'next/server';
import { DirectorToolError, runDirectorTool } from '@/lib/director/tools';
import { assertLocalRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ejecuta una herramienta del Director con el JSON del cuerpo. Solo desde este equipo. */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    await assertLocalRequest(req);
    const { name } = await params;
    const body = await req.json().catch(() => {
      throw new DirectorToolError('El cuerpo debe ser JSON.');
    });
    const result = await runDirectorTool(name, body);
    return NextResponse.json({ result });
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : err instanceof DirectorToolError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo ejecutar la herramienta.') }, { status });
  }
}
