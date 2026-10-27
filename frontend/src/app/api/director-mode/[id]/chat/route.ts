import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { ProductionError } from '@/lib/director/production-store';
import { chatWithDirector } from '@/lib/director-mode/engine';
import { orchestratorErrorResponse } from '@/lib/ai/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Chat libre del modo Director: { mensaje, historial, enfoque } → { respuesta, plan, motivo }.
 * No cambia nada: si hay un cambio, devuelve la acción propuesta y la interfaz la ejecuta
 * (sola o con botón, según decide lib/director-mode/chat.ts). $0 con Gemini gratis.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { orchestrator, ...input } = body;
    return NextResponse.json(await chatWithDirector(id, input, orchestrator));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof ProductionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return orchestratorErrorResponse(err);
  }
}
