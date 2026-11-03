import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { runAction } from '@/lib/editor/actions';
import { archiveEdit, getEdit } from '@/lib/editor/edit-store';
import { editorError } from '@/lib/editor/http';
import { ACTIVE_STATUSES } from '@/lib/editor/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ edicion: await getEdit(id) });
  } catch (err) {
    return editorError(err, 'No se pudo leer la edición.');
  }
}

/** { accion: 'guardar_revision' | 'renderizar' | 'reanalizar' | 'reintentar' | 'volver_a_revisar' | 'aprobar' | 'renombrar', … } */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    return NextResponse.json({ edicion: await runAction(id, body) });
  } catch (err) {
    return editorError(err, 'No se pudo completar la acción.');
  }
}

/** Quita la edición de la lista (los archivos se quedan en su carpeta). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const p = await getEdit(id);
    if (ACTIVE_STATUSES.includes(p.estado)) {
      return NextResponse.json({ error: 'Espera a que termine de procesarse para quitarla.' }, { status: 409 });
    }
    await archiveEdit(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return editorError(err, 'No se pudo quitar la edición.');
  }
}
