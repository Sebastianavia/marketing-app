import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { NewEditMetaSchema, createEdit } from '@/lib/editor/actions';
import { EditError, listEdits, summarize } from '@/lib/editor/edit-store';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

/** Lista de ediciones (más recientes primero). */
export async function GET() {
  try {
    return NextResponse.json({ ediciones: (await listEdits()).map(summarize) });
  } catch (err) {
    return editorError(err, 'No se pudieron leer las ediciones.');
  }
}

/**
 * Nueva edición.
 *  - Subida: el cuerpo ES el video (se guarda en disco por partes, sin cargarlo entero en memoria)
 *    y los datos van en la cabecera X-Edit-Meta (JSON con encodeURIComponent).
 *  - Video de Proyectos: JSON con { ...datos, rutaLocal }.
 */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
    let raw: unknown;
    if (isJson) {
      raw = await req.json().catch(() => null);
    } else {
      try {
        raw = JSON.parse(decodeURIComponent(req.headers.get('x-edit-meta') ?? ''));
      } catch {
        throw new EditError('Faltan los datos de la edición.');
      }
    }
    const parsed = NewEditMetaSchema.safeParse(raw);
    if (!parsed.success) throw new EditError('Datos de la edición no válidos: elige un perfil.');
    const meta = parsed.data;
    if (isJson && !meta.rutaLocal) throw new EditError('Falta el video.');
    if (!isJson && meta.rutaLocal) throw new EditError('Datos de la edición no válidos.');
    const edit = await createEdit(meta, isJson ? null : req.body);
    return NextResponse.json({ edicion: edit });
  } catch (err) {
    return editorError(err, 'No se pudo crear la edición.');
  }
}
