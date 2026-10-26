import { NextResponse } from 'next/server';
import { listProductions, pendingApproval, productionSpent } from '@/lib/director/production-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Producciones del Director. ?pendientes=1 devuelve solo las que esperan aprobación (aviso de la barra superior). */
export async function GET(req: Request) {
  try {
    const onlyPending = new URL(req.url).searchParams.get('pendientes') === '1';
    const all = await listProductions();
    const rows = all
      .map((p) => ({ p, a: pendingApproval(p) }))
      .filter(({ a }) => !onlyPending || a)
      .map(({ p, a }) => ({
        id: p.id,
        nombre: p.nombre,
        estado: p.estado,
        formato: p.formato,
        presupuestoUSD: p.presupuestoUSD,
        gastadoUSD: productionSpent(p),
        creada: p.creada,
        aprobacionPendiente: a
          ? {
              id: a.id,
              montoUSD: a.montoUSD,
              motivo: a.motivo,
              pedida: a.pedida,
              escenas: a.escenas.map((id) => {
                const s = p.escenas.find((x) => x.id === id)!;
                return {
                  id: s.id,
                  orden: s.orden,
                  tipo: s.spec.tipo,
                  titulo: s.spec.titulo,
                  texto: s.spec.texto,
                  prompt: s.spec.prompt,
                  detalle: s.detalle,
                  costoUSD: s.estimadoUSD,
                };
              }),
            }
          : null,
      }));
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron leer las producciones.') }, { status: 500 });
  }
}
