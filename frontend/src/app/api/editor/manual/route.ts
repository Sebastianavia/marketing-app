import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { learnLessons, loadManual, manualSkillMarkdown, ManualError, MANUAL_AREAS, updateManual } from '@/lib/editor/manual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof ManualError) return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** El manual de edición (compartido en R2 o la copia de este PC). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const r = await loadManual();
    return NextResponse.json({ ...r, skill: manualSkillMarkdown(r.manual) });
  } catch (err) {
    return fail(err, 'No se pudo leer el manual.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('retirar'), id: z.string().max(20) }),
  z.object({ accion: z.literal('reactivar'), id: z.string().max(20) }),
  z.object({
    accion: z.literal('editar'),
    id: z.string().max(20),
    regla: z.string().trim().min(10).max(300),
    porQue: z.string().trim().max(300).optional(),
    area: z.enum(MANUAL_AREAS),
  }),
  z.object({ accion: z.literal('crear'), regla: z.string().trim().min(10).max(300), porQue: z.string().trim().max(300).optional(), area: z.enum(MANUAL_AREAS) }),
]);

/** Cambios hechos por una persona desde la pestaña «Manual». Solo desde la ventana de la app. */
export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ManualError('Datos no válidos.');
    const a = parsed.data;
    if (a.accion === 'crear') {
      const r = await learnLessons([{ area: a.area, regla: a.regla, porQue: a.porQue }], 'Añadida a mano', 'Persona');
      return NextResponse.json({ manual: r.manual, compartido: true, skill: manualSkillMarkdown(r.manual) });
    }
    const { manual } = await updateManual((m) => {
      const rule = m.reglas.find((r) => r.id === a.id);
      if (!rule) throw new ManualError('Esa regla ya no existe.', 404);
      rule.actualizada = new Date().toISOString();
      if (a.accion === 'retirar') rule.estado = 'retirada';
      else if (a.accion === 'reactivar') rule.estado = 'activa';
      else {
        rule.regla = a.regla;
        rule.porQue = a.porQue;
        rule.area = a.area;
      }
    });
    return NextResponse.json({ manual, compartido: true, skill: manualSkillMarkdown(manual) });
  } catch (err) {
    return fail(err, 'No se pudo cambiar el manual.');
  }
}
