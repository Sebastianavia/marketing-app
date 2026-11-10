import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { getEdit } from '@/lib/editor/edit-store';
import { editorError } from '@/lib/editor/http';
import { MaterialError } from '@/lib/material/material';
import { saveAttachments } from '@/lib/material/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Adjuntos del chat «Claude · editor» (multipart `archivos`) → <carpeta de la edición>/adjuntos/. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const p = await getEdit(id);
    return NextResponse.json({ archivos: await saveAttachments(p.carpeta, await req.formData()) });
  } catch (err) {
    if (err instanceof MaterialError) return NextResponse.json({ error: err.message }, { status: err.status });
    return editorError(err, 'No se pudieron guardar los archivos.');
  }
}
