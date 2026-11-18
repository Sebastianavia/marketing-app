import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { cancelResume } from '@/lib/ai/claude-code/quota-resume';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  accion: z.literal('cancelar'),
  clave: z.string().regex(/^(edit|director|studio):[A-Za-z0-9_-]+$/, 'Clave no válida.'),
});

/** Cancela la reanudación automática de un chat con Claude (la que espera a que vuelva el cupo). */
export async function POST(req: Request) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' }, { status: 400 });
    return NextResponse.json({ ok: true, cancelada: await cancelResume(parsed.data.clave) });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: 'No se pudo cancelar.' }, { status: 500 });
  }
}
