import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectProduction } from '@/lib/director/production';
import { ProductionError } from '@/lib/director/production-store';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ approvalId: z.string().regex(/^apr_[a-z0-9]{8,32}$/) });

/** Rechaza el gasto pedido por el Director. Solo desde la interfaz de la app. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const { approvalId } = Body.parse(await req.json());
    const { result } = await rejectProduction(id, approvalId);
    return NextResponse.json({ ok: true, aprobacion: result });
  } catch (err) {
    const status =
      err instanceof ForbiddenError ? 403 : err instanceof ProductionError ? err.status : err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo rechazar.') }, { status });
  }
}
