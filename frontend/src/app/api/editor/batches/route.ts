import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { MaterialError } from '@/lib/material/material';
import { editorError } from '@/lib/editor/http';
import { BatchInputSchema, createBatch, listBatches, previewBatch } from '@/lib/editor/batch';
import { heavyStatus } from '@/lib/editor/heavy-queue';
import { isKeepingAwake } from '@/lib/system/keep-awake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof MaterialError) return NextResponse.json({ error: err.message }, { status: err.status });
  return editorError(err, fallback);
}

/** Lotes nocturnos + cola de trabajo pesado + si el PC se mantiene despierto. */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    return NextResponse.json({ lotes: await listBatches(), pesado: heavyStatus(), despierto: isKeepingAwake() });
  } catch (err) {
    return fail(err, 'No se pudieron leer los lotes.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('previsualizar'), carpeta: z.string().trim().min(2).max(1000), archivos: z.array(z.string().max(260)).max(60).optional() }),
  BatchInputSchema.extend({ accion: z.literal('crear') }),
]);

/** previsualizar = videos de la carpeta y su duración; crear = empezar el lote. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' }, { status: 400 });
    const b = parsed.data;
    if (b.accion === 'previsualizar') return NextResponse.json({ vista: await previewBatch(b.carpeta, b.archivos) });
    const { accion: _a, ...input } = b;
    void _a;
    return NextResponse.json({ lote: await createBatch(input) });
  } catch (err) {
    return fail(err, 'No se pudo crear el lote.');
  }
}
