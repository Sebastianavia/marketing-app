import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { ProductionError } from '@/lib/director/production-store';
import { getDirectorProduction, runDirectorAction } from '@/lib/director-mode/engine';
import { orchestratorErrorResponse } from '@/lib/ai/orchestrator';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ production: await getDirectorProduction(id) });
  } catch (err) {
    const status = err instanceof ProductionError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo leer la producción.') }, { status });
  }
}

/**
 * Una acción sobre las etapas: { accion, ... } (ver lib/director-mode/schemas.ts).
 * Solo texto ($0 con Gemini gratis). `orchestrator` llega cuando la persona aceptó usar Claude.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { orchestrator, ...action } = body;
    const result = await runDirectorAction(id, action, orchestrator);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof ProductionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return orchestratorErrorResponse(err);
  }
}
