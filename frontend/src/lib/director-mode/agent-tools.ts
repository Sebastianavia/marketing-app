import { z } from 'zod';
import { listAvatars } from '@/lib/avatars/avatar-store';
import { BROLL_MODELS, VOICE_MODES } from '@/config/broll-models';
import { ProductionError } from '@/lib/director/production-store';
import { errorMessage } from '@/lib/errors';
import { getDirectorProduction, runDirectorAction } from './engine';
import { ActionBody } from './schemas';
import type { Production } from '@/lib/director/production-store';

/**
 * Herramientas de Claude sobre UNA producción del modo Director (chat "Claude · director").
 * Las ve por MCP (lulo-mcp.mjs con LULO_TOOLSET=director-mode); la producción la fija el servidor.
 * Todas son de texto ($0 con la suscripción): no hay herramientas que gasten. La única acción de
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
      })),
    },
    etiquetas: (d.etiquetas ?? []).map((t) => ({ id: t.id, tipo: t.tipo, mencion: `@${t.mencion}`, descripcion: t.descripcion, confirmada: t.confirmada })),
    referencias: (d.referencias ?? []).map((r) => ({ id: r.id, archivo: r.archivo, medio: r.medio, escenaId: r.escenaId, etiquetaId: r.etiquetaId })),
    locucion: d.locucion
      ? { duracionSeg: d.locucion.duracionSeg, usarComoVoz: d.locucion.usarComoVoz, transcrita: Boolean(d.locucion.transcripcion) }
      : null,
  };
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
        modelosToma: BROLL_MODELS.map((m) => ({ id: m.id, nombre: m.name })),
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
- {"accion":"guardar_ajustes","ajustes":{formato, duracionSeg, modoVoz, modeloBroll, avatarId|null, presupuestoUSD}}
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

export const DIRECTOR_AGENT_TOOLS: AgentTool[] = [verProyecto, accion];

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
