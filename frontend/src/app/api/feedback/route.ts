import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ForbiddenError, assertAppUiRequest } from '@/lib/director/local-guard';
import { AgentBusyError } from '@/lib/ai/claude-code/agent-runner';
import { errorMessage, errorStatus } from '@/lib/errors';
import {
  FeedbackSourceSchema,
  REVIEW_LABEL,
  entryForSource,
  listFeedback,
  reviewUrl,
  stateOf,
  sendFeedbackToClaude,
  syncFeedback,
  uploadToFeedback,
  type FeedbackEntry,
} from '@/lib/feedback/feedback';
import { feedbackAppUrl } from '@/lib/feedback/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

/** Lo que ve la pantalla (sin rutas absolutas). */
function view(e: FeedbackEntry) {
  const estado = stateOf(e);
  return {
    estado,
    estadoTexto: REVIEW_LABEL[estado],
    decision: e.feedback?.decision ?? null,
    respuesta: e.respuesta ?? null,
    key: e.key,
    proyecto: e.proyecto,
    nombre: e.nombre,
    origen: e.origen,
    subidoEn: e.subidoEn ?? null,
    enBucket: e.enBucket !== false,
    notas: e.feedback?.notes.length ?? 0,
    general: Boolean(e.feedback?.general.trim()),
    feedbackEn: e.feedback?.updatedAt ?? null,
    claude: e.claude ?? null,
    siguiente: e.siguiente ?? null,
    enlace: reviewUrl(e.key),
  };
}

function fail(err: unknown, fallback: string) {
  const status = err instanceof AgentBusyError ? 409 : err instanceof ForbiddenError ? 403 : errorStatus(err);
  const msg =
    err instanceof AgentBusyError
      ? 'Claude está trabajando en ese proyecto: espera a que termine o detenlo.'
      : err instanceof ForbiddenError
        ? 'Esto solo se puede hacer desde la ventana de Lulo Studio.'
        : errorMessage(err, fallback);
  if (status >= 500) console.error('[feedback]', err);
  return NextResponse.json({ error: msg }, { status });
}

/** GET [?sync=1]: bandeja de feedback. Con sync=1 lee el bucket (solo cuando se abre la bandeja; nunca en segundo plano). */
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('sync') === '1') await syncFeedback();
    const r = await listFeedback();
    const entradas = r.entradas.filter((e) => e.enBucket !== false).map(view);
    return NextResponse.json({
      configurado: r.configurado,
      app: feedbackAppUrl(),
      ultimaSync: r.ultimaSync,
      errorSync: r.errorSync,
      // Videos con cambios pedidos que esperan a Claude
      pendientes: entradas.filter((e) => e.estado === 'cambios_pedidos').length,
      entradas,
    });
  } catch (err) {
    return fail(err, 'No se pudo leer el feedback.');
  }
}

const Body = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('estado'), fuente: FeedbackSourceSchema }),
  z.object({
    accion: z.literal('subir'),
    fuente: FeedbackSourceSchema,
    proyecto: z.string().trim().max(120).optional(),
    nombre: z.string().trim().max(120).optional(),
  }),
  z.object({ accion: z.literal('claude'), key: z.string().min(1).max(400) }),
]);

/**
 * estado: ¿ya se subió este video y en qué estado está? (lee ese video del bucket: 2 lecturas)
 * subir: sube el video a R2 · claude: manda los cambios pedidos al Claude que lo hizo.
 * Todo solo desde la ventana de la app.
 */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 });
    const a = parsed.data;

    if (a.accion === 'estado') {
      const r = await entryForSource(a.fuente);
      return NextResponse.json({ entrada: r.entry ? view(r.entry) : null, disponible: r.disponible, sugerido: r.sugerido ?? null, error: r.error ?? null });
    }
    if (a.accion === 'subir') {
      const e = await uploadToFeedback(a.fuente, { proyecto: a.proyecto, nombre: a.nombre });
      return NextResponse.json({ entrada: view(e) });
    }
    const out = await sendFeedbackToClaude(a.key, `http://localhost:${req.nextUrl.port || '3000'}`);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return fail(err, 'No se pudo completar la acción de feedback.');
  }
}
