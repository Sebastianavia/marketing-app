import { NextResponse } from 'next/server';
import { z } from 'zod';
import { approveProduction } from '@/lib/director/production';
import { ProductionError } from '@/lib/director/production-store';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  approvalId: z.string().regex(/^apr_[a-z0-9]{8,32}$/),
  /** Lo que la persona vio en pantalla: si cambió mientras tanto, no se aprueba. */
  montoUSD: z.number().nonnegative(),
  escenas: z.array(z.string().regex(/^e\d{1,2}$/)).min(1),
});

/** Aprueba el gasto pedido por el Director. Solo desde la interfaz de la app (nunca con el token del Director). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const { result } = await approveProduction(id, body.approvalId, body.montoUSD, body.escenas);
    return NextResponse.json({ ok: true, aprobacion: result });
  } catch (err) {
    const status =
      err instanceof ForbiddenError ? 403 : err instanceof ProductionError ? err.status : err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo aprobar.') }, { status });
  }
}
