import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { editorError } from '@/lib/editor/http';
import { batchAction, getBatch } from '@/lib/editor/batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRead(req);
    return NextResponse.json({ lote: await getBatch((await params).id) });
  } catch (err) {
    return editorError(err, 'No se pudo leer el lote.');
  }
}

const Body = z.object({ accion: z.enum(['pausar', 'seguir', 'cancelar', 'reintentar']) });

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    return NextResponse.json({ lote: await batchAction((await params).id, parsed.data.accion) });
  } catch (err) {
    return editorError(err, 'No se pudo cambiar el lote.');
  }
}
