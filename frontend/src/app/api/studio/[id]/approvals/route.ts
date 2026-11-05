import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { StudioError, updateStudioProject } from '@/lib/studio/store';
import { studioError } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ accion: z.enum(['aprobar', 'rechazar']), aprobacionId: z.string().min(3), montoUSD: z.number() });

/**
 * La persona aprueba o rechaza un gasto que pidió Claude. Solo desde la ventana de la app
 * (assertAppUiRequest rechaza el token del Director y exige Origin + Sec-Fetch-Site same-origin).
 * Se exige el monto que vio: si Claude lo cambió, 409.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const b = Body.parse(await req.json());
    const { result } = await updateStudioProject(id, (p) => {
      const a = p.aprobaciones.find((x) => x.id === b.aprobacionId);
      if (!a) throw new StudioError('Esa solicitud ya no existe.', 404);
      if (a.estado !== 'pendiente') throw new StudioError('Esa solicitud ya se resolvió.', 409);
      if (Math.abs(a.montoUSD - b.montoUSD) > 1e-4) throw new StudioError('El monto cambió; vuelve a revisarlo.', 409);
      a.estado = b.accion === 'aprobar' ? 'aprobada' : 'rechazada';
      a.resuelta = new Date().toISOString();
      return a;
    });
    return NextResponse.json({ aprobacion: result });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos no válidos.' }, { status: 400 });
    return studioError(err, 'No se pudo guardar la decisión.');
  }
}
