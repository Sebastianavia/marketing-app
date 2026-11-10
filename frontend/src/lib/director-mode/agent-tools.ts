import { z } from 'zod';
import { originFeedbackForClaude, respondFromAgent, takeFeedbackFromAgent } from '@/lib/feedback/feedback';
import { listAvatars } from '@/lib/avatars/avatar-store';
import { BROLL_MODELS, VOICE_MODES, brollPriceLabel, clipCostUSD } from '@/config/broll-models';
import { imageUnitPrice } from '@/lib/generation/image';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/config/image-models';
import { sceneClipChoice } from './durations';
import type { DirectorScene, DirectorState } from './types';
import { ProductionError } from '@/lib/director/production-store';
import { errorMessage } from '@/lib/errors';
import { getDirectorProduction, runDirectorAction } from './engine';
import { ActionBody } from './schemas';
import { assembleFinal, generationStatus, prepareGeneration, runGeneration } from './generation';
import type { Production } from '@/lib/director/production-store';

/**
 * Herramientas de Claude sobre UNA producción del modo Director (chat "Claude · director").
 * Las ve por MCP (lulo-mcp.mjs con LULO_TOOLSET=director-mode); la producción la fija el servidor.
 * Las de texto son $0 con la suscripción. Lo que gasta (imágenes, voces, clips) solo se ejecuta
 * tras la aprobación de la persona en la app (preparar_produccion → aprobar → generar). La acción de
 * pago del motor (transcribir la locución con ElevenLabs) está bloqueada.
 */

export class DirectorAgentToolError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** JSON Schema que ve Claude (si no, el de `schema`). Debe ser un objeto sin oneOf/anyOf arriba. */
  publicJsonSchema?: () => object;
  run: (productionId: string, input: z.infer<S>) => Promise<unknown>;
}

const tool = <S extends z.ZodType>(t: AgentTool<S>) => t as unknown as AgentTool;

/** Lo que Claude necesita ver del proyecto. */
function snapshot(p: Production) {
  const d = p.director!;
  return {
    nombre: p.nombre,
    carpeta: p.carpeta,
    plantilla: d.skill ?? null,
    confidencial: d.confidencial,
    entrada: { tipo: d.entrada.tipo, texto: d.entrada.texto, mantenerPalabras: d.entrada.mantenerPalabras, pdf: d.entrada.pdf ?? null },
    etapas: Object.fromEntries(Object.entries(d.etapas).map(([k, v]) => [k, { estado: v.estado, error: v.error }])),
    preguntas: d.preguntas,
    ajustes: d.ajustes,
    guion: d.guion && {
      titulo: d.guion.titulo,
      escenas: d.guion.escenas.map((s) => ({
        id: s.id,
        orden: s.orden,
        tipo: s.tipo,
        duracionSeg: s.duracionSeg,
        desde: s.inicio,
        hasta: s.fin,
        queSeVe: s.queSeVe,
        dialogo: s.dialogo,
        prompt: s.prompt ? { texto: s.prompt.texto, desactualizado: s.prompt.deVersion !== s.version } : null,
        ...(s.tipo === 'broll' ? { clip: clipSummary(s, d) } : {}),
      })),
    },
    etiquetas: (d.etiquetas ?? []).map((t) => ({ id: t.id, tipo: t.tipo, mencion: `@${t.mencion}`, descripcion: t.descripcion, confirmada: t.confirmada })),
    referencias: (d.referencias ?? []).map((r) => ({ id: r.id, archivo: r.archivo, medio: r.medio, escenaId: r.escenaId, etiquetaId: r.etiquetaId })),
    locucion: d.locucion
      ? { duracionSeg: d.locucion.duracionSeg, usarComoVoz: d.locucion.usarComoVoz, transcrita: Boolean(d.locucion.transcripcion) }
      : null,
  };
}

/** Modelo, resolución, imagen inicial y costo estimado del clip de una escena. */
function clipSummary(s: DirectorScene, d: DirectorState) {
  const c = sceneClipChoice(s, d.ajustes);
  const seg = s.clipSeg ?? s.duracionSeg;
  const conAudio = d.ajustes.modoVoz === 'native' && Boolean(s.dialogo.trim());
  const imgRes = c.imageModel.resolutions.includes('1K') ? '1K' : c.imageModel.resolutions[0];
  const imagenUSD = c.imagenInicial ? imageUnitPrice(c.imageModel.id, imgRes).unit : 0;
  return {
    modelo: c.model.id,
    resolucion: c.resolucion,
    imagenInicial: c.imagenInicial,
    continuarAnterior: c.continuarAnterior,
    modeloImagen: c.imageModel.id,
    elegidoParaEstaEscena: c.propia,
    estimadoUSD: Math.round((clipCostUSD(c.model, seg, { withAudio: conAudio, resolution: c.resolucion }) + imagenUSD) * 1000) / 1000,
  };
}

/** Catálogo de modelos de clip para Claude: límites, precio y para qué sirve cada uno. */
function clipModelsCatalog() {
  return BROLL_MODELS.map((m) => ({
    id: m.id,
    nombre: m.name,
    proveedor: m.provider,
    duraciones: m.durationByModel ? `la decide el modelo (${m.durations[0]}–${m.durations[m.durations.length - 1]} s)` : m.durations,
    resoluciones: m.resolutions,
    resolucionPredeterminada: m.resolution,
    formatos: m.aspectRatios,
    audio: m.audio,
    maxImagenes: m.maxImages,
    videoDeReferencia: m.videoRef,
    precio: brollPriceLabel(m),
    nota: m.note,
    ...(m.porConfirmar ? { porConfirmar: m.porConfirmar } : {}),
  }));
}

const verProyecto = tool({
  name: 'ver_proyecto',
  description:
    'Estado completo del proyecto del Director: idea de entrada, estado de cada etapa (idea → preguntas → ajustes → guion → prompts), preguntas, ajustes (formato, duración, modo de voz, modelo de tomas, avatar, presupuesto), guion con escenas y prompts, etiquetas @, referencias y locución. Incluye las opciones válidas para los ajustes. Úsala siempre antes de cambiar algo.',
  schema: z.object({}),
  run: async (id) => {
    const p = await getDirectorProduction(id);
    const avatars = await listAvatars().catch(() => []);
    return {
      ...snapshot(p),
      opciones: {
        modosVoz: VOICE_MODES.map((m) => ({ id: m.id, nombre: m.label })),
        modelosToma: clipModelsCatalog(),
        modelosImagen: IMAGE_MODELS.map((im) => ({
          id: im.id,
          aliases: im.aliases,
          nombre: im.name,
          proveedor: im.provider,
          maxReferencias: im.maxRefs,
          resoluciones: im.resolutions,
          preciosUSD: im.pricePerImage,
        })),
        imagenInicial: { modelo: DEFAULT_IMAGE_MODEL, resolucion: '1K', precioUSD: imageUnitPrice(DEFAULT_IMAGE_MODEL, '1K').unit },
        avatares: avatars.map((a) => ({ id: a.id, nombre: a.name, descripcion: a.description })),
        formatos: ['9:16', '16:9', '1:1'],
      },
    };
  },
});

const accion = tool({
  name: 'accion',
  description: `Ejecuta una acción del Director sobre el proyecto (las mismas que los botones de la app). Las principales:
- {"accion":"responder_preguntas","respuestas":{"<idPregunta>":"respuesta"}} o {"accion":"saltar_preguntas"}
- {"accion":"guardar_ajustes","ajustes":{formato, duracionSeg, modoVoz, modeloBroll, resolucionBroll?, imagenInicial?, avatarId|null, presupuestoUSD}}
- {"accion":"ajustar_clip","escenaId":"e2","modelo":"gemini-omni-1.1-flash-ext"|null,"resolucion":"720p"|null,"imagenInicial":true|false|null,"continuarAnterior":true|false|null} → modelo/resolución/imagen inicial/continuar fotograma de la escena anterior SOLO de esa escena ($0; null = volver a lo de los ajustes). Valida formato, resolución y audio; si cambia la duración, avisa.
- {"accion":"generar_guion","indicacion":"opcional"} → escribe el guion por escenas (las duraciones se ajustan solas al modelo)
- {"accion":"rehacer_escena","escenaId":"e2","indicacion":"…"} / {"accion":"editar_escena","escenaId":"e2","cambios":{tipo?, duracionSeg?, queSeVe?, dialogo?}}
- {"accion":"generar_prompts","soloFaltantes":false} / {"accion":"rehacer_prompt",…} / {"accion":"editar_prompt","escenaId":"e2","texto":"prompt en inglés"}
- {"accion":"aprobar","etapa":"ajustes"|"guion"|"prompts"} (solo cuando la persona lo confirma)
- etiquetas: proponer_etiquetas, guardar_etiqueta, borrar_etiqueta, unir_etiquetas; referencias: mover_referencia, borrar_referencia; locución: usar_locucion, quitar_locucion, transcribir_locucion (solo motor "gemini"), editar_transcripcion.
Devuelve el proyecto actualizado. Si una etapa está bloqueada, primero completa la anterior.`,
  // Se valida con ActionBody dentro de run (tras deshacer objetos que lleguen como texto JSON)
  schema: z.object({ accion: z.string() }).passthrough(),
  publicJsonSchema: flatActionSchema,
  run: async (id, input) => {
    const parsed = ActionBody.safeParse(unstringify(input));
    if (!parsed.success) {
      throw new DirectorAgentToolError(
        `Acción no válida — ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`
      );
    }
    const a = parsed.data;
    if (a.accion === 'transcribir_locucion' && a.motor !== 'gemini') {
      throw new DirectorAgentToolError('Transcribir con ElevenLabs cuesta dinero: pídeselo a la persona en la app. Usa motor "gemini".', 402);
    }
    const r = await runDirectorAction(id, a);
    return { ok: true, aviso: r.aviso, proyecto: snapshot(r.production) };
  },
});

/**
 * La API de Claude no admite oneOf/anyOf en el nivel superior del esquema de una herramienta
 * (la descarta entera). Se publica un objeto plano: `accion` como enum + todos los campos posibles.
 * La validación de verdad la hace ActionBody (zod) en run.
 */
function flatActionSchema(): object {
  const names: string[] = [];
  const props: Record<string, unknown> = {};
  for (const option of ActionBody.options) {
    const js = z.toJSONSchema(option, { io: 'input' }) as { properties?: Record<string, { const?: string }> };
    for (const [k, v] of Object.entries(js.properties ?? {})) {
      if (k === 'accion') {
        if (v.const) names.push(v.const);
      } else if (!(k in props)) props[k] = v;
    }
  }
  return { type: 'object', properties: { accion: { type: 'string', enum: names }, ...props }, required: ['accion'] };
}

/** Algunos clientes MCP mandan los objetos anidados como texto JSON ("ajustes": "{…}"): se deshacen. */
function unstringify(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // no era JSON: se deja como texto
      }
    }
    out[k] = v;
  }
  return out;
}

const prepararProduccion = tool({
  name: 'preparar_produccion',
  description:
    'Con los prompts aprobados, convierte el guion en escenas de pago con su costo y PIDE APROBACIÓN a la persona en la app (no gasta): voz de ElevenLabs, imagen inicial de cada toma con GPT Image 2 (si está activada), clip de cada toma con el modelo de su escena o de los ajustes (Grok, Gemini Omni… con la resolución elegida) y avatar HeyGen según el modo de voz. Devuelve el costo por escena, el total y las suposiciones (duraciones ajustadas al modelo). Si ya hay algo generado, no se puede volver a preparar.',
  schema: z.object({}),
  run: (id) => prepareGeneration(id),
});

const generar = tool({
  name: 'generar',
  description:
    'Genera SOLO las escenas que la persona ya aprobó en la app: voces primero, luego las imágenes iniciales (espera a que estén, ~1 min) y por último los clips, que tardan unos minutos en segundo plano (máx. 4 a la vez). Si algo espera aprobación, lo dice. Usa estado_produccion para seguir el avance.',
  schema: z.object({}),
  run: (id) => runGeneration(id),
});

const estadoProduccion = tool({
  name: 'estado_produccion',
  description: 'Estado de las escenas de pago (pendiente de aprobación, aprobada, generando, lista, fallida), gasto, presupuesto y video final.',
  schema: z.object({
    esperarSeg: z.number().int().min(0).max(600).default(0).describe('Esperar hasta N segundos a que terminen las escenas en curso'),
  }),
  run: async (id, { esperarSeg }) => {
    const until = Date.now() + esperarSeg * 1000;
    for (;;) {
      const st = await generationStatus(id);
      if (!st.escenas.some((e) => e.estado === 'generando') || Date.now() >= until) return st;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  },
});

const montarVideo = tool({
  name: 'montar_video',
  description:
    'Con todas las escenas listas, monta el video final con FFmpeg ($0): voz en off continua o el audio de cada clip, fundidos y formato del proyecto. Lo guarda como final-vN.mp4 en la carpeta (lo puedes mirar con FFmpeg/Read) y aparece en Proyectos. Con pulirConClaude (por defecto) pasa al editor de video para pulirlo para redes.',
  schema: z.object({ pulirConClaude: z.boolean().default(true) }),
  run: (id, { pulirConClaude }) => assembleFinal(id, { pulirConClaude }),
});

const verFeedback = tool({
  name: 'ver_feedback',
  description: 'Estado y notas de los videos finales de esta producción subidos a la app de feedback (Por revisar, Cambios pedidos, Claude trabajando, Claude respondió, Aprobado). $0.',
  schema: z.object({}),
  run: async (productionId) => originFeedbackForClaude('director', productionId),
});

const tomarFeedback = tool({
  name: 'tomar_feedback',
  description: 'Toma los cambios que pidió el equipo en un video (estado «Cambios pedidos»): descarga las notas actuales y deja el video en «Claude trabajando» en la app de feedback. Devuelve las notas para aplicarlas. `key` sale de ver_feedback. $0.',
  schema: z.object({ key: z.string().min(1).max(400) }),
  run: async (productionId, { key }) => takeFeedbackFromAgent(key, 'Claude · director', { servicio: 'director', id: productionId }),
});

const responderFeedback = tool({
  name: 'responder_feedback',
  description: 'Al terminar de aplicar el feedback, deja tu respuesta para el equipo: nota por nota qué cambiaste y qué no se pudo (y por qué). La verán en la app de feedback y el video pasa a «Claude respondió». $0.',
  schema: z.object({ key: z.string().min(1).max(400), resumen: z.string().min(10).max(4000) }),
  run: async (productionId, { key, resumen }) => respondFromAgent(key, resumen, { servicio: 'director', id: productionId }),
});

export const DIRECTOR_AGENT_TOOLS: AgentTool[] = [verProyecto, accion, prepararProduccion, generar, estadoProduccion, montarVideo, verFeedback, tomarFeedback, responderFeedback];

export function directorAgentToolsManifest() {
  return DIRECTOR_AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.publicJsonSchema ? t.publicJsonSchema() : z.toJSONSchema(t.schema, { io: 'input' }),
  }));
}

export async function runDirectorAgentTool(id: string, name: string, raw: unknown): Promise<unknown> {
  const t = DIRECTOR_AGENT_TOOLS.find((x) => x.name === name);
  if (!t) throw new DirectorAgentToolError(`Herramienta desconocida: "${name}".`, 404);
  const parsed = t.schema.safeParse(raw ?? {});
  if (!parsed.success) throw new DirectorAgentToolError(`Datos no válidos — ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  try {
    return await t.run(id, parsed.data);
  } catch (err) {
    if (err instanceof DirectorAgentToolError) throw err;
    if (err instanceof ProductionError) throw new DirectorAgentToolError(err.message, err.status);
    if (err instanceof z.ZodError) throw new DirectorAgentToolError(err.issues.map((i) => i.message).join(' '));
    throw new DirectorAgentToolError(errorMessage(err, 'No se pudo completar.'), 500);
  }
}
