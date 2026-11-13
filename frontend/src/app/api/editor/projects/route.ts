import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { NewEditMetaSchema, createEdit } from '@/lib/editor/actions';
import { MaterialError, setMaterialFolder, validateMaterialFolder } from '@/lib/material/material';
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
 *    y los datos van AL PRINCIPIO del cuerpo (cabecera X-Edit-Meta-En-Cuerpo: 8 dígitos con el largo
 *    en bytes + JSON; ver splitMetaPrefix). Se admite aún la cabecera X-Edit-Meta antigua.
 *  - Video de Proyectos: JSON con { ...datos, rutaLocal }.
 */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
    let raw: unknown;
    let body: ReadableStream<Uint8Array> | null = req.body;
    if (isJson) {
      raw = await req.json().catch(() => null);
    } else if (req.headers.get('x-edit-meta-en-cuerpo') === '1' && req.body) {
      const split = await splitMetaPrefix(req.body);
      raw = split.meta;
      body = split.rest;
    } else {
      try {
        raw = JSON.parse(decodeURIComponent(req.headers.get('x-edit-meta') ?? ''));
      } catch {
        throw new EditError('Faltan los datos de la edición.');
      }
    }
    const parsed = NewEditMetaSchema.safeParse(raw);
    if (!parsed.success) throw new EditError(metaProblem(parsed.error.issues));
    const meta = parsed.data;
    if (isJson && !meta.rutaLocal) throw new EditError('Falta el video.');
    if (!isJson && meta.rutaLocal) throw new EditError('Datos de la edición no válidos.');
    // La carpeta de material se valida antes de crear (si no vale, no queda una edición a medias) y
    // se guarda enseguida: el primer pase de Claude empieza después de transcribir
    const material = meta.carpetaMaterial ? await validateMaterialFolder(meta.carpetaMaterial) : null;
    const edit = await createEdit(meta, isJson ? null : body);
    if (material) await setMaterialFolder(`edit:${edit.id}`, material);
    return NextResponse.json({ edicion: edit });
  } catch (err) {
    if (err instanceof MaterialError) return NextResponse.json({ error: err.message }, { status: err.status });
    return editorError(err, 'No se pudo crear la edición.');
  }
}

const FIELD_NAMES: Record<string, string> = { perfilId: 'elige un estilo', pedido: 'el pedido es demasiado largo (máx. 30 000 caracteres)', titulo: 'el nombre es demasiado largo (máx. 80)', carpetaMaterial: 'la ruta de la carpeta de material es demasiado larga', marcaId: 'la marca no es válida' };

/** Mensaje claro de qué dato falló (antes decía siempre «elige un perfil»). */
function metaProblem(issues: Array<{ path: PropertyKey[] }>): string {
  const names = [...new Set(issues.map((i) => FIELD_NAMES[String(i.path[0])] ?? `dato «${String(i.path[0] ?? '?')}»`))];
  return `Datos de la edición no válidos: ${names.join('; ')}.`;
}

/** Separa los datos (8 dígitos de largo + JSON) del resto del cuerpo, que es el video. */
async function splitMetaPrefix(stream: ReadableStream<Uint8Array>): Promise<{ meta: unknown; rest: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  const need = async (n: number) => {
    while (buf.length < n) {
      const { done, value } = await reader.read();
      if (done) throw new EditError('Faltan los datos de la edición.');
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
  };
  await need(8);
  const len = Number(new TextDecoder().decode(buf.subarray(0, 8)));
  if (!Number.isInteger(len) || len <= 0 || len > 200_000) throw new EditError('Faltan los datos de la edición.');
  await need(8 + len);
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + len)));
  } catch {
    throw new EditError('Faltan los datos de la edición.');
  }
  const first = buf.subarray(8 + len);
  const rest = new ReadableStream<Uint8Array>({
    start(c) {
      if (first.length) c.enqueue(first);
    },
    async pull(c) {
      const { done, value } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel(r) {
      return reader.cancel(r);
    },
  });
  return { meta, rest };
}
