import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { getEdit } from '@/lib/editor/edit-store';
import { editorError } from '@/lib/editor/http';
import { openInExplorer } from '@/lib/storage/project-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Abre la carpeta de trabajo de la edición en el Explorador. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const p = await getEdit(id);
    const ok = await openInExplorer(p.carpeta);
    return NextResponse.json({ ok });
  } catch (err) {
    return editorError(err, 'No se pudo abrir la carpeta.');
  }
}
