import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import { ProfileInputSchema } from '@/config/editor-looks';
import { errorMessage } from '@/lib/errors';
import { listProfiles, normalizeProfile } from './profile-store';
import { runAction } from './actions';
import { EditError, getEdit, logActivity, updateEdit } from './edit-store';
import { ffmpeg, probeVideo } from './media';
import { keptIntervals, phraseText, subtitleWords } from './timeline';
import { snapToFrames } from './render';
import { ACTIVE_STATUSES, type EditProject } from './types';
import { isInside } from '@/lib/fs/inside';

/**
 * Herramientas de Claude sobre UNA edición (chat "Claude" de la pantalla de Edición).
 * Las ve por MCP (frontend/mcp/lulo-mcp.mjs con LULO_TOOLSET=editor); la edición la fija
 * el servidor al lanzar la sesión, así que Claude no puede tocar otras ediciones.
 * Ninguna gasta dinero: transcribir de nuevo o generar con proveedores no está aquí.
 * Aprobar sigue siendo solo de la persona, en la app.
 */

export class AgentToolError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (editId: string, input: z.infer<S>) => Promise<unknown>;
}

const tool = <S extends z.ZodType>(t: AgentTool<S>) => t as unknown as AgentTool;

/** Lo que Claude necesita ver de la edición, sin las palabras sueltas (pesan mucho). */
function snapshot(p: EditProject) {
  return {
    titulo: p.titulo,
    estado: p.estado,
    carpeta: p.carpeta,
    pedidoOriginal: p.pedido,
    original: p.original,
    perfil: p.perfil,
    gancho: p.gancho,
    resaltar: p.resaltar,
    resumenIA: p.resumenIA,
    frases: p.frases.map((f) => ({
      id: f.id,
      desde: Number(f.s.toFixed(2)),
      hasta: Number(f.e.toFixed(2)),
      texto: f.textoEditado ?? phraseText(f),
      cortar: f.cortar,
      motivo: f.motivo,
    })),
    graficos: p.graficos ?? [],
    borrador: p.borrador,
    error: p.error?.mensaje,
    ultimaActividad: p.actividad.slice(-8),
  };
}

function assertIdle(p: EditProject) {
  if (ACTIVE_STATUSES.includes(p.estado) || p.tarea) {
    throw new AgentToolError('La edición se está procesando (análisis o render). Usa esperar_render o espera un momento.', 409);
  }
}

/** Mezcla profunda (solo objetos planos) para aplicar un cambio parcial al perfil. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

async function waitForRender(editId: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const p = await getEdit(editId);
    const busy = ACTIVE_STATUSES.includes(p.estado) || !!p.tarea;
    if (!busy) {
      if (p.estado === 'error') return { listo: false, error: p.error?.mensaje ?? 'Error sin detalle.' };
      return { listo: true, estado: p.estado, borrador: p.borrador };
    }
    if (Date.now() > until) return { listo: false, sigueTrabajando: true, progreso: p.progreso, detalle: p.progresoTexto };
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Ruta dentro de la carpeta de la edición (nunca fuera de ella). */
function insideFolder(p: EditProject, rel: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ p.carpeta, rel);
  if (!isInside(p.carpeta, abs) || abs === path.resolve(/*turbopackIgnore: true*/ p.carpeta)) throw new AgentToolError('El archivo tiene que estar dentro de la carpeta de la edición.');
  return abs;
}

const verEdicion = tool({
  name: 'ver_edicion',
  description:
    'Estado completo de la edición: perfil de estilo (subtítulos, gancho, ritmo, sonido, gráficos, formato), frases con tiempos del video ORIGINAL y si se cortan, gráficos, borrador actual y carpeta de trabajo. Úsala siempre antes de cambiar algo.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    const perfiles = (await listProfiles()).map((x) => ({ id: x.id, nombre: x.nombre, descripcion: x.descripcion }));
    return { ...snapshot(p), perfilesDisponibles: perfiles };
  },
});

const cambiarPerfil = tool({
  name: 'cambiar_perfil',
  description:
    'Cambia el estilo SOLO de esta edición (no toca la biblioteca de perfiles). Recibe un cambio parcial con la misma forma que `perfil` de ver_edicion, p. ej. {"subtitulos":{"colorTexto":"#FFE600","posicion":"centro"}} o {"sonido":{"musica":"pulso"}}. Se valida igual que en la app. Después hay que renderizar.',
  schema: z.object({ cambios: z.record(z.string(), z.unknown()) }),
  run: async (editId, { cambios }) => {
    const { edit } = await updateEdit(editId, (p) => {
      assertIdle(p);
      const base = normalizeProfile(p.perfil);
      const merged = deepMerge(base as unknown as Record<string, unknown>, cambios);
      const parsed = ProfileInputSchema.safeParse(merged);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new AgentToolError(`${issue?.path.join(' › ') || 'perfil'}: ${issue?.message ?? 'valor no válido'}`);
      }
      p.perfil = { ...base, ...parsed.data, id: base.id, creado: base.creado, actualizado: new Date().toISOString() };
      logActivity(p, 'Claude cambió el estilo de esta edición.');
    });
    return { ok: true, perfil: edit.perfil };
  },
});

const cambiarGuion = tool({
  name: 'cambiar_guion',
  description:
    'Cambia qué frases se cortan, el texto de los subtítulos, el gancho, las palabras resaltadas, los gráficos o el perfil base. `frases`: [{id, cortar, textoEditado?}] (solo las que cambian; textoEditado cambia el subtítulo, no el audio). `graficos`: la lista COMPLETA que debe quedar ({id,tipo,titulo,texto,items,activo}; los que no vengan se quitan; solo se pueden editar los que ya existen). `perfilId`: cambia a otro perfil de la biblioteca. Después hay que renderizar.',
  schema: z.object({
    frases: z.array(z.object({ id: z.string(), cortar: z.boolean(), textoEditado: z.string().max(600).optional() })).optional(),
    gancho: z.string().max(120).optional(),
    resaltar: z.array(z.string().max(40)).max(20).optional(),
    graficos: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
    perfilId: z.string().optional(),
  }),
  run: async (editId, input) => {
    const current = await getEdit(editId);
    if (input.frases) {
      const byId = new Map(input.frases.map((f) => [f.id, f]));
      const unknownIds = input.frases.filter((f) => !current.frases.some((x) => x.id === f.id)).map((f) => f.id);
      if (unknownIds.length) throw new AgentToolError(`Frases que no existen: ${unknownIds.join(', ')}. Mira los id en ver_edicion.`);
      // La acción de la app espera todas las frases: se completan con su estado actual
      input.frases = current.frases.map((f) => {
        const c = byId.get(f.id);
        return c ?? { id: f.id, cortar: f.cortar, ...(f.textoEditado ? { textoEditado: f.textoEditado } : {}) };
      });
    }
    const edit = await runAction(editId, { accion: 'guardar_revision', ...input }).catch((err) => {
      throw new AgentToolError(errorMessage(err), err instanceof EditError ? err.status : 400);
    });
    await updateEdit(editId, (p) => logActivity(p, 'Claude ajustó el guion de la edición.'));
    return { ok: true, edicion: snapshot(edit) };
  },
});

const palabrasBorrador = tool({
  name: 'palabras_borrador',
  description:
    'Cada palabra que se dice con su inicio y fin EN EL VIDEO DEL BORRADOR (ya con los cortes del motor), y el texto de cada frase. Úsala para sincronizar textos, capturas, zooms o efectos con lo que se va diciendo. La transcripción es la de la app: no la deduzcas de subtitulos.ass (allí las palabras van troceadas en bloques y etiquetas).',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
    const palabras = subtitleWords(p.frases, intervals);
    const kept = p.frases.filter((f) => !f.cortar);
    return {
      nota: 'Tiempos del borrador que hace el motor (renderizar). Si tu versión cambia la duración o el orden, recalcula a partir de estos.',
      frases: kept.map((f, i) => ({
        frase: i,
        texto: f.textoEditado ?? phraseText(f),
        desde: palabras.find((w) => w.frase === i)?.s ?? null,
        hasta: [...palabras].reverse().find((w) => w.frase === i)?.e ?? null,
      })),
      palabras,
    };
  },
});

/** Volumen momentáneo (EBU R128) cada 0,5 s, picos y silencios de un video o audio, con FFmpeg ($0). */
async function listen(file: string) {
  const out = await ffmpeg({
    args: ['-hide_banner', '-nostats', '-i', file, '-filter_complex', '[0:a]asplit[a][b];[a]ebur128=peak=true[x];[b]silencedetect=noise=-38dB:d=0.3[y]', '-map', '[x]', '-map', '[y]', '-f', 'null', '-'],
    timeoutMs: 120_000,
  }).catch((err) => {
    throw new AgentToolError(`No se pudo analizar el audio: ${errorMessage(err)}`);
  });
  const momentary: Array<{ t: number; lufs: number }> = [];
  let next = 0;
  for (const m of out.matchAll(/t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)/g)) {
    const t = Number(m[1]);
    if (t + 1e-6 < next) continue;
    next = t + 0.5;
    momentary.push({ t: Math.round(t * 10) / 10, lufs: m[2] === '-inf' ? -70 : Number(m[2]) });
  }
  const integrated = /I:\s*(-?[\d.]+) LUFS/.exec(out.slice(out.lastIndexOf('Summary')));
  const truePeak = /Peak:\s*(-?[\d.]+) dBFS/.exec(out.slice(out.lastIndexOf('Summary')));
  const silences: Array<{ desde: number; hasta: number }> = [];
  for (const m of out.matchAll(/silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g)) {
    silences.push({ desde: Number(Number(m[1]).toFixed(2)), hasta: Number(Number(m[2]).toFixed(2)) });
  }
  // Picos: subidas bruscas de 6 LU o más sobre el medio segundo anterior (golpes, whooshes, pops)
  const picos = momentary.filter((x, i) => i > 0 && x.lufs - momentary[i - 1].lufs >= 6).map((x) => ({ t: x.t, lufs: x.lufs }));
  return {
    integradoLUFS: integrated ? Number(integrated[1]) : null,
    picoVerdaderoDBFS: truePeak ? Number(truePeak[1]) : null,
    volumenCadaMedioSegundo: momentary,
    picos,
    silencios: silences,
    comoLeerlo:
      'Voz clara en redes: integrado cerca de −14 LUFS y pico ≤ −1 dBFS. Un efecto se nota como pico breve; si la voz baja mucho donde hay efectos o música, están demasiado fuertes. Silencios largos en mitad del video = algo falta.',
  };
}

const escucharAudio = tool({
  name: 'escuchar_audio',
  description:
    'Escucha el audio de un video o audio de la carpeta (por defecto el borrador actual) y devuelve el volumen cada medio segundo, el volumen total, picos (efectos, golpes) y silencios. Úsala SIEMPRE antes de publicar para comprobar que la voz se entiende, que los efectos suenan donde quieres y que no hay silencios raros.',
  schema: z.object({ archivo: z.string().max(260).optional().describe('Ruta relativa dentro de la carpeta; vacío = borrador actual') }),
  run: async (editId, { archivo }) => {
    const p = await getEdit(editId);
    const rel = archivo || p.borrador?.archivo;
    if (!rel) throw new AgentToolError('Todavía no hay borrador: indica el archivo.');
    const file = insideFolder(p, rel);
    if (!fsSync.existsSync(file)) throw new AgentToolError(`No existe ${rel}.`, 404);
    return { archivo: rel, ...(await listen(file)) };
  },
});

const planearGraficos = tool({
  name: 'planear_graficos',
  description:
    'Crea (o rehace) el plan de gráficos animados (tarjetas, números, listas, texto detrás de la persona) según el guion actual y el perfil. Devuelve los gráficos con su id; después puedes editarlos o quitarlos con cambiar_guion.',
  schema: z.object({}),
  run: async (editId) => {
    const edit = await runAction(editId, { accion: 'proponer_graficos' }).catch((err) => {
      throw new AgentToolError(errorMessage(err), err instanceof EditError ? err.status : 400);
    });
    return { ok: true, graficos: edit.graficos ?? [] };
  },
});

const renderizar = tool({
  name: 'renderizar',
  description:
    'Arma el video con el motor de la app (cortes, zoom, subtítulos, gráficos, música) usando el perfil y el guion actuales, y espera hasta 15 min. Devuelve el borrador (archivo dentro de la carpeta, duración, control de calidad). Si tarda más, usa esperar_render.',
  schema: z.object({}),
  run: async (editId) => {
    await runAction(editId, { accion: 'renderizar' }).catch((err) => {
      throw new AgentToolError(errorMessage(err), err instanceof EditError ? err.status : 400);
    });
    return waitForRender(editId, 15 * 60_000);
  },
});

const esperarRender = tool({
  name: 'esperar_render',
  description: 'Espera (hasta 10 min) a que termine el análisis o render en curso y devuelve el resultado.',
  schema: z.object({}),
  run: (editId) => waitForRender(editId, 10 * 60_000),
});

const publicarBorrador = tool({
  name: 'publicar_borrador',
  description:
    'Muestra en la app un video que hiciste tú (con FFmpeg, Python u otra herramienta) como nueva versión del borrador. `archivo`: ruta relativa dentro de la carpeta de la edición (MP4 H.264 + AAC). `nota`: qué hiciste, en una frase para la persona. La persona lo ve, lo compara y decide si lo aprueba.',
  schema: z.object({ archivo: z.string().min(1).max(260), nota: z.string().min(3).max(300) }),
  run: async (editId, { archivo, nota }) => {
    const p = await getEdit(editId);
    assertIdle(p);
    const src = insideFolder(p, archivo);
    if (!fsSync.existsSync(src)) throw new AgentToolError(`No existe ${archivo} en la carpeta de la edición.`, 404);
    if (path.extname(src).toLowerCase() !== '.mp4') throw new AgentToolError('El borrador tiene que ser .mp4 (H.264 + AAC).');
    if (path.basename(src) === p.original.archivo) throw new AgentToolError('Ese es el video original, no un borrador.');
    if (/^borrador-v\d+\.mp4$/i.test(path.basename(src)) && path.dirname(src) === path.resolve(p.carpeta)) {
      throw new AgentToolError('Ese borrador ya está en la app (lo dejó renderizar). publicar_borrador es solo para videos que hiciste tú.');
    }
    const info = await probeVideo(src);
    if (!info.tieneVideo || info.duracion <= 0) throw new AgentToolError('Ese archivo no tiene una pista de video válida.');

    const version = (p.borrador?.version ?? 0) + 1;
    const nombre = `borrador-v${version}.mp4`;
    const portada = `portada-v${version}.jpg`;
    const dest = path.join(/*turbopackIgnore: true*/ p.carpeta, nombre);
    if (path.resolve(src) !== path.resolve(dest)) await fs.copyFile(src, dest);
    const thumbAt = Math.min(1, info.duracion / 3).toFixed(2);
    await ffmpeg({
      args: ['-y', '-hide_banner', '-ss', thumbAt, '-i', dest, '-frames:v', '1', '-q:v', '3', path.join(/*turbopackIgnore: true*/ p.carpeta, portada)],
      timeoutMs: 60_000,
    }).catch(() => undefined);
    const hasThumb = fsSync.existsSync(path.join(/*turbopackIgnore: true*/ p.carpeta, portada));

    const { edit } = await updateEdit(editId, (x) => {
      x.borrador = {
        archivo: nombre,
        duracion: info.duracion,
        creado: new Date().toISOString(),
        version,
        portada: hasThumb ? portada : undefined,
        calidad: [{ ok: null, texto: `Hecho por Claude fuera del motor de la app: ${nota}` }],
        notas: [nota],
      };
      x.estado = 'borrador';
      x.error = undefined;
      logActivity(x, `Claude publicó la versión ${version}: ${nota}`);
    });
    return { ok: true, borrador: edit.borrador };
  },
});

export const EDITOR_AGENT_TOOLS: AgentTool[] = [verEdicion, palabrasBorrador, escucharAudio, cambiarPerfil, cambiarGuion, planearGraficos, renderizar, esperarRender, publicarBorrador];

export function editorAgentToolsManifest() {
  return EDITOR_AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema, { io: 'input' }),
  }));
}

export async function runEditorAgentTool(editId: string, name: string, raw: unknown): Promise<unknown> {
  const t = EDITOR_AGENT_TOOLS.find((x) => x.name === name);
  if (!t) throw new AgentToolError(`Herramienta desconocida: "${name}".`, 404);
  const parsed = t.schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AgentToolError(`Datos no válidos — ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
  }
  try {
    return await t.run(editId, parsed.data);
  } catch (err) {
    if (err instanceof AgentToolError) throw err;
    if (err instanceof EditError) throw new AgentToolError(err.message, err.status);
    throw new AgentToolError(errorMessage(err, 'No se pudo completar.'), 500);
  }
}
