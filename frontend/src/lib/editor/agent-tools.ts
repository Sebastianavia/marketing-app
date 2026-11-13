import fs from 'fs/promises';
import { originFeedbackForClaude, respondFromAgent, takeFeedbackFromAgent } from '@/lib/feedback/feedback';
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
import { buildPlate, snapToFrames } from './render';
import { PersonUnavailable, ensurePersonTrack, lightStats, matchLightFilter, measureShake, personSummary } from './person';
import { formatSize } from '@/config/editor-looks';
import { placeGraphics } from './graphics';
import { AREA_LABEL, LessonSchema, learnLessons, loadManual } from './manual';
import { ACTIVE_STATUSES, type EditProject } from './types';
import { isInside } from '@/lib/fs/inside';
import { RHYTHM_BUDGET, analyzeRhythm, directedProfile, CAMERA_TYPES, DirectionError, DirectionInputSchema, ELEMENT_ENTRIES, ELEMENT_MODES, ELEMENT_POSITIONS, KEY_EFFECTS, TRANSITION_TYPES, AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, describeDirection, directionInFinal, editAsset, prepareDirection, resolveDirection } from './direction';
import { SFX_CATALOG } from './sfx';
import { MUSIC_CATALOG } from './music';
import { LOUDNESS_BY_NETWORK, listMusic, musicDir } from './audio';
import { AMBIENT_INFO, VOICE_FX_INFO } from './voice';
import { beatAlignment, detectBeats, generatedBeats, nearestBeat, type BeatGrid } from './beats';
import { NETWORKS, NETWORK_LABEL, OutputError, PostInputSchema, VariantInputSchema, exportForNetwork, outputBusy, renderVariant } from './outputs';
import { scoreEdit } from './score';
import { MetricInputSchema, analyzeRetention, bestTime, measureReference, metricsDoc, newMetric, referencesDoc, saveReference, shareMetric } from './learning';
import { DUB_LANGS, PaidError, correctionCost, dubDraft, dubEstimate, generateCorrection, requestApproval, spendApproval } from './paid';
import { getStoredVoices } from '@/lib/storage/voice-storage';
import { applyBackgroundReport, detectBackgroundVoices } from './voices';
import { ENGINE_LIMITS, brandOf } from './brand-standard';
import { cutWordsByText, detectRestarts } from './restarts';
import { canVerifyFree, verifyCost, verifyFinalAudio } from './verify-audio';
import { installGoogleFont, listFonts } from './fonts';
import { KIT_CATALOG, KitError, KitInputSchema, buildKitPiece, changeZones, designCover } from './kit/kit';
import { loadBrands } from './kit/brands';
import { AUDIO_KINDS, ensureLocal, findItem, libraryForClaude, loadLibrary, materializeLibraryRefs } from './audio-library';
import { fontsDir } from './media';
import { totalDuration } from './timeline';
import { FONT_SUGGESTIONS, SUBTITLE_STYLES } from '@/config/editor-looks';
import { CODE_CHECK_DESCRIPTION, CODE_VIDEO_DESCRIPTION, CodeCheckSchema, CodeVideoError, CodeVideoSchema, checkCodeVideo, renderCodeVideo } from '@/lib/ai/claude-code/code-video';

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
    ...(p.marcaId ? { marcaId: p.marcaId, nota_marca: 'Esta edición tiene marca: mira estandar_marca.' } : {}),
    frases: p.frases.map((f) => ({
      id: f.id,
      desde: Number(f.s.toFixed(2)),
      hasta: Number(f.e.toFixed(2)),
      texto: f.textoEditado ?? phraseText(f),
      cortar: f.cortar,
      motivo: f.motivo,
      ...(f.voz === 'fondo' ? { vozDeFondo: true } : {}),
      ...(f.palabras.some((w) => w.cortar) ? { palabrasQuitadas: f.palabras.filter((w) => w.cortar).map((w) => w.t).join(' ') } : {}),
      ...(f.huecos?.length ? { vozAjenaCerca: f.huecos } : {}),
    })),
    graficos: p.graficos ?? [],
    direccion: p.direccion ? planInFinal(p) : null,
    borrador: p.borrador,
    error: p.error?.mensaje,
    ultimaActividad: p.actividad.slice(-8),
  };
}

/**
 * Con arranque en frío o pausas, el borrador final dura más que la línea principal: cómo pasar de uno
 * a otro (las notas del equipo [mm:ss] vienen en tiempos del BORRADOR).
 */
function structureNote(p: EditProject) {
  if (!p.direccion?.arranque && !p.direccion?.pausas?.length) return {};
  const plan = planInFinal(p);
  const avance = plan.arranque ? Number((plan.arranque.hasta - plan.arranque.desde).toFixed(2)) : 0;
  const pausas = (plan.pausas ?? []).map((x) => ({ enPrincipal: x.t, duracion: x.duracion }));
  return {
    estructura: {
      avanceAlInicioSeg: avance,
      pausas,
      comoConvertir:
        'Estos tiempos (y los del plan) son de la línea PRINCIPAL. En el borrador final: tiempo = principal + avanceAlInicioSeg + la suma de las pausas que caen antes. Para una nota del equipo en [mm:ss] del borrador, haz la cuenta al revés.',
    },
  };
}

/** El plan de dirección con tiempos del video final (los cortes actuales). */
function planInFinal(p: EditProject) {
  const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
  return directionInFinal(p.direccion!, intervals, totalDuration(intervals));
}

/** Cuadrícula de beats de la música del plan, en tiempos del video (línea principal). */
async function planBeats(p: EditProject): Promise<{ grid: BeatGrid; musica: string } | null> {
  if (!p.direccion?.musica || p.direccion.musica.modo === 'ninguna') return null;
  const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
  const total = totalDuration(intervals);
  const m = resolveDirection(p, p.direccion, intervals, total, await musicDir()).musica;
  if (!m) return null;
  if (m.modo === 'generada' && m.estilo) return { grid: generatedBeats(m.estilo, total, m.secciones), musica: `generada ${m.estilo}` };
  if (m.modo === 'archivo' && m.abs) return { grid: await detectBeats(m.abs, m.inicioArchivo, total), musica: path.basename(m.abs) };
  return null;
}

/** ¿Los cortes visuales del plan caen en el beat? (solo si la pulsación es clara) */
function beatReport(plan: ReturnType<typeof directionInFinal>, grid: BeatGrid) {
  const cuts = [
    ...(plan.camara ?? []).map((c) => c.desde).filter((t) => t > 0.2),
    ...(plan.transiciones ?? []).map((t) => t.t),
    ...(plan.elementos ?? []).map((e) => e.desde),
  ].sort((a, b) => a - b);
  const al = beatAlignment(cuts, grid.beats, 0.08);
  const clear = grid.fuente === 'generada' || (grid.confianza ?? 0) >= 0.35;
  const avisos: string[] = [];
  if (clear && cuts.length >= 4 && al.fraccion < 0.5) {
    const ej = al.fuera.slice(0, 5).map((t) => `${t}→${nearestBeat(t, grid.beats)}`).join(', ');
    avisos.push(`Solo ${al.alineados} de ${al.total} cortes visuales caen en el beat de la música (${grid.bpm} BPM). Donde la voz lo permita, mueve cortes de cámara, transiciones y entradas al beat más cercano (ej.: ${ej}); los cambios grandes, al inicio de compás.`);
  }
  return { bpm: grid.bpm, confianza: grid.confianza, cortesEnElBeat: `${al.alineados}/${al.total}`, avisos };
}

function assertIdle(p: EditProject) {
  if (outputBusy(p.id)) throw new AgentToolError('Se está renderizando una variante o exportación de esta edición: espera a que termine.', 409);
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
      ...structureNote(p),
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
    'Propuesta AUTOMÁTICA de gráficos (otra IA, según el guion y el perfil). Mejor escríbelos tú en dirigir_edicion (campo graficos), con tu criterio y en el segundo exacto; usa esta solo como punto de partida si quieres. Devuelve los gráficos con su id.',
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

const verFeedback = tool({
  name: 'ver_feedback',
  description:
    'Estado y notas de los borradores de esta edición subidos a la app de feedback (En revisión del equipo, Enviado a Claude, Claude trabajando, Claude respondió, Versión anterior). Tiempos [mm:ss] DEL BORRADOR subido: ubícalos con palabras_borrador. $0.',
  schema: z.object({}),
  run: async (editId) => originFeedbackForClaude('edicion', editId),
});

const tomarFeedback = tool({
  name: 'tomar_feedback',
  description: 'Extrae las notas y el feedback que el equipo envió a Claude desde la app de feedback (estado «Enviado a Claude»): las descarga y deja esa versión en «Claude trabajando». Devuelve las notas para ejecutarlas. `key` sale de ver_feedback. $0.',
  schema: z.object({ key: z.string().min(1).max(400) }),
  run: async (editId, { key }) => takeFeedbackFromAgent(key, 'Claude · editor', { servicio: 'edicion', id: editId }),
});

const verManual = tool({
  name: 'ver_manual',
  description: 'El MANUAL DE EDICIÓN de Lulo (compartido por el equipo): todas las reglas activas con su id, área, por qué y cuántas veces el feedback las confirmó. Úsalo antes de aprender_del_feedback para confirmar reglas existentes en vez de duplicarlas. $0.',
  schema: z.object({}),
  run: async () => {
    const { manual, compartido, aviso } = await loadManual();
    return {
      version: manual.version,
      compartido,
      aviso,
      reglas: manual.reglas
        .filter((r) => r.estado === 'activa')
        .map((r) => ({ id: r.id, area: AREA_LABEL[r.area], regla: r.regla, porQue: r.porQue, confirmaciones: r.confirmaciones })),
    };
  },
});

const aprenderDelFeedback = tool({
  name: 'aprender_del_feedback',
  description:
    'Guarda en el MANUAL DE EDICIÓN (compartido por los 4 del equipo) lo aprendido del feedback o de lo que pide la persona: reglas GENERALES y accionables para cualquier video. Cada lección: area, regla, porQue, nota (la del equipo que la originó) y, si repite una regla existente, confirma = su id (ver_manual). Entran activas al momento. $0.',
  schema: z.object({ lecciones: z.array(LessonSchema).min(1).max(12) }),
  run: async (editId, { lecciones }) => {
    const p = await getEdit(editId);
    const { manual, result } = await learnLessons(lecciones, p.titulo, 'Claude');
    await updateEdit(editId, (x) => logActivity(x, `Claude guardó ${result.length} lección(es) en el manual de edición (v${manual.version}).`));
    return { ok: true, version: manual.version, lecciones: result };
  },
});

const responderFeedback = tool({
  name: 'responder_feedback',
  description: 'Al terminar de aplicar el feedback, deja tu respuesta para el equipo: nota por nota qué cambiaste y qué no se pudo (y por qué). La verán en la app de feedback y el video pasa a «Claude respondió». $0.',
  schema: z.object({ key: z.string().min(1).max(400), resumen: z.string().min(10).max(4000) }),
  run: async (editId, { key, resumen }) => ({
    ...(await respondFromAgent(key, resumen, { servicio: 'edicion', id: editId })),
    siguiente: 'Ahora guarda en el manual las lecciones generales de estas notas con aprender_del_feedback (mira ver_manual para confirmar las que ya existen).',
  }),
});

const revisarHtmlVideo = tool({
  name: 'revisar_html_video',
  description: CODE_CHECK_DESCRIPTION,
  schema: CodeCheckSchema,
  run: async (editId, input) => {
    const p = await getEdit(editId);
    return checkCodeVideo(p.carpeta, input).catch((err) => {
      throw err instanceof CodeVideoError ? new AgentToolError(err.message, err.status) : err;
    });
  },
});

const renderizarHtmlVideo = tool({
  name: 'renderizar_html_video',
  description: CODE_VIDEO_DESCRIPTION,
  schema: CodeVideoSchema,
  run: async (editId, input) => {
    const p = await getEdit(editId);
    return renderCodeVideo(p.carpeta, input).catch((err) => {
      throw err instanceof CodeVideoError ? new AgentToolError(err.message, err.status) : err;
    });
  },
});

const catalogoEdicion = tool({
  name: 'catalogo_edicion',
  description:
    'Todo lo que puedes usar en el plan de dirección (dirigir_edicion): efectos de sonido con cuándo usar cada uno, estilos de música (BPM y para qué), movimientos de cámara, transiciones, modos de elementos visuales, animaciones de subtítulos, efectos de palabra clave, fuentes, música propia de la persona y los archivos (imágenes, videos, audios) que hay en la carpeta de la edición. $0.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    const walk = async (dir: string, depth: number): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.') || e.name === '_src' || /^(plate|voz|matte|caras|borrador|portada|musica|sfx|mezcla|master|video-sin-audio|ambiente-pista)/.test(e.name)) continue;
        const full = path.join(/*turbopackIgnore: true*/ dir, e.name);
        if (e.isDirectory() && depth < 4) out.push(...(await walk(full, depth + 1)));
        else if (e.isFile()) out.push(path.relative(p.carpeta, full).split(path.sep).join('/'));
      }
      return out;
    };
    const files = (await walk(p.carpeta, 0)).filter((f) => f !== p.original.archivo);
    const of = (exts: string[]) => files.filter((f) => exts.includes(path.extname(f).toLowerCase())).slice(0, 150);
    const fuentesPropias = (await fs.readdir(await fontsDir()).catch(() => [] as string[])).filter((f) => /\.(ttf|otf)$/i.test(f));
    return {
      efectosDeSonido: SFX_CATALOG,
      musicaGenerada: MUSIC_CATALOG,
      musicaPropia: { carpeta: await musicDir(), archivos: await listMusic() },
      camara: {
        tipos: CAMERA_TYPES,
        explicacion:
          'plano = encuadre fijo con ese zoom (cambiar de plano entre tramos = corte de ángulo); punch = acercamiento brusco (0,12 s) para enfatizar; acercar/alejar = movimiento suave de zoom a zoomFinal; paneo = mueve el centro de x a xFinal; sacudida = temblor que se apaga (golpes, sorpresas). zoom 1 = normal, 1,15 medio, 1,3 primer plano, 1,5+ muy cerrado. x/y −1…1 mueven el centro respecto a la cara. Los tramos no se pueden pisar; fuera de ellos el encuadre es normal.',
      },
      transiciones: { tipos: TRANSITION_TYPES, explicacion: 'flash = destello blanco; negro = fundido a negro breve; glitch = desfase RGB; desenfoque = blur; barrido = desenfoque de movimiento horizontal (cambio de lugar o escena). Centradas en t, con su duración (0,15–0,4 s suele ir bien). Sin transición = corte seco.' },
      elementos: {
        modos: ELEMENT_MODES,
        posiciones: ELEMENT_POSITIONS,
        entradas: ELEMENT_ENTRIES,
        explicacion:
          'capa = gráfico a pantalla completa CON TRANSPARENCIA encima de la persona (lo ideal para ayudas visuales hechas con HyperFrames: render en .mov 1080×1920 transparente, con su animación de entrada y salida); pantalla_completa = el archivo tapa el video (b-roll, captura); pantalla_dividida = el archivo ocupa la mitad (posicion arriba/abajo) y la persona se encuadra en la otra mitad con su cara (los subtítulos van a la unión); flotante = recuadro (tamano = ancho respecto al video; borde opcional). Archivos de la carpeta de la edición.',
        formatos: [...IMAGE_EXT, ...VIDEO_EXT],
      },
      subtitulos: {
        animaciones: SUBTITLE_STYLES.map((x) => ({ id: x.id, que: x.hint })),
        efectosPalabraClave: KEY_EFFECTS,
        fuentesSugeridas: FONT_SUGGESTIONS,
        fuentesPropias,
        nota: 'Puedes cambiar cualquier campo de los subtítulos del perfil (fuente, tamano, colores, grosorBorde, caja, posicion, palabrasPorLinea, mayusculas, escalaClave) y además sombra/colorSombra. posicion «cara» = justo bajo el mentón, siguiendo el zoom y el encuadre (en pantalla dividida en la mitad de la persona; sin la persona en cuadro, al 68 % del alto). sombraSuave: true = sombra negra desenfocada en vez de borde. Fuentes que no estén: instalar_fuente.',
      },
      archivosEnLaCarpeta: { imagenes: of(IMAGE_EXT), videos: of(VIDEO_EXT), audios: of(AUDIO_EXT) },
      estructura: {
        pausas: 'Silencio dramático: [{t, duracion 0,25–3, zoom, capa?}] → fotograma congelado (zoom lento) y silencio TOTAL justo antes del remate; con capa (un trazo del kit: flecha o círculo) se dibuja una anotación encima mientras está congelado («mira esto»). 1–2 por video como mucho.',
        arranque: 'Arranque en frío: {desde, hasta (≤ 4,5 s), transicion corte|flash} → ese tramo se repite al inicio como avance y luego empieza el video. Usa el momento más fuerte o intrigante.',
        bucle: 'bucle: true → el final enlaza con el inicio sin silencio ni cola de música. Escribe/corta el cierre para que la última frase lleve a la primera e iguala encuadre y zoom del final con los del inicio.',
        progreso: 'Listas: {tipo barra|contador|ambos, marcas: [segundo en que empieza cada ítem], etiqueta?, color?} → barra que crece arriba y «PASO 2/5» que cambia en cada ítem.',
        colaFinal: 'colaFinal: segundos de aire después de la última palabra (p. ej. 0,8): sigue el plano real y, si el original acaba antes, el último fotograma se queda quieto.',
        tiempos: 'Todo en segundos de la línea PRINCIPAL (palabras_borrador); el borrador final dura más si hay avance o pausas.',
      },
      sonido: {
        voz: {
          campo: 'voz: {mejorar, respiraciones, efectos: [{desde, hasta, efecto}]}',
          mejorar: 'true (por defecto) = presencia a 3,5 kHz + de-esser: la voz se entiende mejor en el móvil.',
          respiraciones: 'true (por defecto) = baja 12 dB los huecos entre palabras (respiraciones, chasquidos de boca). Ponlo en false si el silencio es parte del ritmo.',
          efectos: Object.fromEntries(Object.entries(VOICE_FX_INFO).map(([k, v]) => [k, v.uso])),
          regla: 'Efecto de voz = recurso puntual (1–3 por video, 0,5–4 s cada uno), siempre por un motivo narrativo.',
        },
        ambientes: {
          campo: 'ambientes: [{desde, hasta, tipo, archivo?, bajoVozDb}]',
          sintetizados: AMBIENT_INFO,
          archivo: 'tipo «archivo» con archivo: «biblioteca:<id>» (tipo ambiente de biblioteca_audio) o ruta de la carpeta.',
          nivel: 'bajoVozDb 24–32: se siente, no se escucha. Un ambiente bajo la voz da «lugar» al video; quítalo en los tramos con música fuerte.',
        },
        bibliotecaDelEquipo: 'Efectos, música y ambientes reales que subió el equipo (con licencia): mira biblioteca_audio y úsalos con archivo «biblioteca:<id>» en sonidos (tipo archivo), musica (modo archivo) o ambientes.',
        beats: 'beats_musica da la cuadrícula de la música del plan (o de un archivo): corta, haz punch y mete efectos EN el beat; los cambios grandes al inicio de compás; los «drops» en los golpes.',
        velocidad: 'elementos[].velocidad: 0,5 = cámara lenta (momento emotivo, detalle de producto), 2–4 = rápido (proceso, timelapse). Solo en videos de apoyo, nunca en la persona hablando.',
        volumenFinal: { porRed: LOUDNESS_BY_NETWORK, nota: 'Por defecto según la red del perfil. Puedes subirlo a −12/−11 LUFS en TikTok si el video es muy enérgico; nunca por encima de −9.' },
      },
      imagenYCamara: {
        reencuadre: 'camaraSigueCara (por defecto true): con zoom, la cámara sigue la cara en cada momento (pista de persona), no un centro fijo.',
        seguir: 'elementos[].seguir cara|mano_izquierda|mano_derecha (flotante o capa) + seguirDx/seguirDy; en capa, seguirAncla = punto de la capa que se pega (crea la pieza del kit en x=0,5, y=0,5). Mira pista_persona: solo cuando la mano se ve.',
        detrasDePersona: 'elementos[].detrasDePersona: la persona queda DELANTE del elemento (gráfica, texto o imagen detrás de ella). Va dentro de la escena: se mueve con la cámara.',
        persona: 'persona: [{desde, hasta, efecto desenfocar_fondo (intensidad 8–30, «cámara cara» en un plano cerrado) | cambiar_fondo (fondo #RRGGBB o archivo: marca un cambio de tema) | clon (clonDesde = segundo de otro momento, clonLado, clonEscala, espejo: «el yo que no publica vs el que sí»)}]. Recursos puntuales, 2–6 s.',
        movimientos: 'pista_persona da los movimientos amplios del cuerpo: buenos puntos para cortar, transicionar (mano que cruza = corte «tapado») o lanzar un efecto.',
        estabilizar: 'estabilizar: true si analizar_imagen dice que tiembla (vidstab, dos pasadas).',
        igualarLuz: 'igualarLuz: true si las tomas no casan de luz o tinte.',
      },
      vozEIdioma: {
        segundoIdioma: 'segundoIdioma: {idioma, frases: [{id (de ver_edicion), texto traducido}], escala 0,4–0,9, color}: línea más pequeña bajo cada subtítulo. Gratis: traduces tú.',
        correcciones: 'corregir_palabra (de pago, con aprobación): la voz clonada dice el texto correcto en un tramo; tapa el labio con un cambio de plano o un elemento.',
        doblaje: 'doblar_video (de pago, con aprobación): todo el video en otro idioma con su voz y subtítulos nuevos.',
      },
      kitDeGraficos: { tipos: KIT_CATALOG, como: 'kit_grafico crea la pieza (.mov transparente en kit/) con la paleta del plan; colócala como elemento «capa». Una anotación (trazo) puede ir sobre un silencio dramático: pausas[].capa.' },
      paleta: 'Elige TÚ la paleta de este video (primario, acento, secundario, texto, fondo) en el campo paleta del plan: se aplica a subtítulos, gancho y gráficos. No estás atado a los colores del perfil.',
      presupuestoDeRitmo: RHYTHM_BUDGET,
      tiempos: 'Todas las marcas de tiempo del plan son del VIDEO FINAL: sácalas de palabras_borrador.',
    };
  },
});

const bibliotecaAudio = tool({
  name: 'biblioteca_audio',
  description:
    'Biblioteca de audio DEL EQUIPO (compartida): efectos, música y ambientes reales con licencia que subieron las personas. Filtra por tipo (efecto|musica|ambiente) y/o texto (nombre, etiquetas, nota). Úsalos en dirigir_edicion con archivo «biblioteca:<id>» (la app los copia a la carpeta). Los marcados soloEnApp son sonidos en tendencia: no van en el MP4, recomiéndalos en tu respuesta para añadirlos al publicar. $0.',
  schema: z.object({ tipo: z.enum(AUDIO_KINDS).optional(), texto: z.string().max(80).optional() }),
  run: async (_editId, input) => {
    const { biblioteca, compartida, aviso } = await loadLibrary();
    const items = libraryForClaude(biblioteca, input);
    return {
      compartida,
      ...(aviso ? { aviso } : {}),
      total: items.length,
      items: items.slice(0, 120),
      ...(items.length ? {} : { nota: 'No hay nada con ese filtro. Usa los efectos y la música generados por la app (catalogo_edicion) o pídele a la persona que suba audios en la pestaña «Audio».' }),
    };
  },
});

const beatsMusica = tool({
  name: 'beats_musica',
  description:
    'Cuadrícula de beats de la música (en segundos del video, línea principal): bpm, cada tiempo (beats), inicio de compás (compases) y golpes fuertes (golpes/«drops»). Sin argumentos usa la música del plan; también acepta archivo («biblioteca:<id>», nombre de la música propia o ruta en la carpeta) con inicioArchivo, o estilo de música generada. Úsala para cortar, hacer punch y poner efectos EN el beat. $0.',
  schema: z.object({
    desde: z.number().min(0).optional(),
    hasta: z.number().min(0).optional(),
    archivo: z.string().max(300).optional(),
    inicioArchivo: z.number().min(0).max(600).default(0),
    estilo: z.enum(Object.keys(MUSIC_CATALOG) as [keyof typeof MUSIC_CATALOG, ...Array<keyof typeof MUSIC_CATALOG>]).optional(),
  }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
    const total = totalDuration(intervals);
    let res: { grid: BeatGrid; musica: string } | null = null;
    if (input.estilo) res = { grid: generatedBeats(input.estilo, total), musica: `generada ${input.estilo}` };
    else if (input.archivo) {
      let abs: string;
      const ref = /^biblioteca:([a-z0-9]+)$/i.exec(input.archivo);
      if (ref) abs = await ensureLocal(await findItem(ref[1]));
      else {
        const own = path.join(/*turbopackIgnore: true*/ await musicDir(), path.basename(input.archivo));
        abs = !/[\\/]/.test(input.archivo) && fsSync.existsSync(own) ? own : editAsset(p.carpeta, input.archivo);
      }
      if (!fsSync.existsSync(abs)) throw new AgentToolError(`No encuentro «${input.archivo}».`);
      res = { grid: await detectBeats(abs, input.inicioArchivo, total), musica: path.basename(abs) };
    } else res = await planBeats(p);
    if (!res) throw new AgentToolError('El plan no tiene música: indica archivo o estilo, o pon música en dirigir_edicion.');
    const a = input.desde ?? 0;
    const b = input.hasta ?? total;
    const win = (xs: number[]) => xs.filter((t) => t >= a && t <= b);
    const g = res.grid;
    const beats = win(g.beats);
    return {
      musica: res.musica,
      bpm: g.bpm,
      segundosPorBeat: Math.round((60 / g.bpm) * 1000) / 1000,
      ...(g.confianza !== undefined ? { confianza: g.confianza } : {}),
      beats: beats.slice(0, 240),
      ...(beats.length > 240 ? { nota: 'Hay más beats: pide un tramo con desde/hasta.' } : {}),
      compases: win(g.compases),
      golpes: win(g.golpes),
      consejo:
        g.fuente === 'archivo' && (g.confianza ?? 0) < 0.35
          ? 'La pulsación de esta música no es clara (confianza baja): guíate por los golpes, no por la cuadrícula.'
          : 'Cortes y punch en beats; cambios de sección y entradas grandes al inicio de compás; efectos de impacto en los golpes. La voz manda: no partas una palabra por caer en el beat.',
    };
  },
});

const kitGrafico = tool({
  name: 'kit_grafico',
  description:
    'Kit de gráficos de Lulo: piezas animadas con la paleta del video, listas en segundos y con calidad constante (HyperFrames por debajo, .mov transparente en kit/). Tipos: ' +
    Object.entries(KIT_CATALOG)
      .map(([k, v]) => `${k} — ${v}`)
      .join(' | ') +
    ' Devuelve el archivo y el elemento listo para el plan (modo «capa»). Con colocarEn (segundo del video final) y agregar: true se añade solo al plan. La misma pieza no se vuelve a renderizar. $0.',
  schema: KitInputSchema,
  run: async (editId, input) => {
    const p = await getEdit(editId);
    const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
    const words = subtitleWords(p.frases, intervals);
    let r;
    try {
      r = await buildKitPiece(p, input, words);
    } catch (err) {
      if (err instanceof KitError) throw new AgentToolError(err.message, err.status);
      throw err;
    }
    // Texto kinético y capítulos ya dicen el texto: los subtítulos se esconden mientras se ven
    const hideSubs = input.tipo === 'texto_kinetico' || input.tipo === 'capitulo';
    const elemento =
      input.colocarEn !== undefined
        ? { archivo: r.archivo, modo: 'capa' as const, desde: input.colocarEn, hasta: Math.round((input.colocarEn + r.duracion) * 100) / 100, ...(hideSubs ? { ocultarSubtitulos: true } : {}) }
        : undefined;
    let agregado = false;
    if (input.agregar && elemento) {
      const total = totalDuration(intervals);
      const prev = p.direccion ? directionInFinal(p.direccion, intervals, total).elementos ?? [] : [];
      const lib = await musicDir();
      await updateEdit(editId, (q) => {
        assertIdle(q);
        try {
          const res = prepareDirection(q, DirectionInputSchema.parse({ elementos: [...prev, elemento] }), intervals, total, q.direccion, lib);
          q.direccion = res.direccion;
        } catch (err) {
          if (err instanceof DirectionError) throw new AgentToolError(err.message);
          throw err;
        }
        logActivity(q, `Claude añadió una pieza del kit (${input.tipo}).`);
      });
      agregado = true;
    }
    return {
      ok: true,
      ...r,
      ...(elemento ? { elemento } : {}),
      agregadoAlPlan: agregado,
      siguiente: agregado
        ? 'Ya está en el plan. Añade su sonido (pop, swish, click…) en sonidos y renderiza cuando termines.'
        : 'Ponlo en dirigir_edicion → elementos como { archivo, modo: "capa", desde, hasta } (o vuelve a llamar con colocarEn y agregar: true). Míralo con fotogramas si dudas.',
    };
  },
});

const zonasDeCambio = tool({
  name: 'zonas_de_cambio',
  description:
    'Analiza una grabación de pantalla (archivo de la carpeta) y devuelve dónde y cuándo cambia algo: tramos con su recuadro (x, y, w, h de 0 a 1) y un zoom sugerido. Úsalo para los enfoques (zoom + cursor + clic) de kit_grafico tipo «pantalla». $0.',
  schema: z.object({ archivo: z.string().min(1).max(300) }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    let abs: string;
    try {
      abs = editAsset(p.carpeta, input.archivo);
    } catch (err) {
      throw new AgentToolError(err instanceof Error ? err.message : String(err));
    }
    if (!fsSync.existsSync(abs)) throw new AgentToolError(`No existe «${input.archivo}» en la carpeta de la edición.`);
    const zonas = await changeZones(abs);
    return {
      zonas,
      nota: zonas.length
        ? 'Para «pantalla»: enfoques [{ t: desde de la zona (relativo al inicio de la pieza, restando inicioVideo), x, y, zoom }]. Varias zonas seguidas en el mismo sitio = un solo enfoque.'
        : 'No hay cambios claros: la pantalla está quieta (usa un enfoque al punto que se nombra en la voz).',
    };
  },
});

const disenarPortada = tool({
  name: 'disenar_portada',
  description:
    'Diseña la portada del borrador actual: un fotograma LIMPIO del video base (t = segundo de la línea principal, como en palabras_borrador; sin subtítulos ni gráficos) con la persona recortada (MediaPipe, si está instalado), texto GRANDE detrás de ella con la paleta del video y palabras destacadas. Queda como portada del borrador (Proyectos y feedback la usan). Elige un fotograma con gesto fuerte y la cara limpia (sin elementos encima). $0.',
  schema: z.object({
    t: z.number().min(0).max(3600),
    texto: z.string().trim().min(2).max(60),
    destacar: z.array(z.string().max(30)).max(4).default([]),
    posicion: z.enum(['arriba', 'abajo']).default('arriba'),
    recorte: z.boolean().default(true),
    fuente: z.string().max(60).optional(),
  }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    assertIdle(p);
    const { plate } = await editPlate(p);
    let r;
    try {
      r = await designCover(p, { ...input, frame: plate });
    } catch (err) {
      if (err instanceof KitError) throw new AgentToolError(err.message, err.status);
      throw err;
    }
    await updateEdit(editId, (q) => {
      if (q.borrador && q.borrador.version === p.borrador?.version) q.borrador.portada = r.archivo;
      logActivity(q, 'Claude diseñó la portada.');
    });
    return { ok: true, ...r, siguiente: `Mírala (Read ${r.archivo}) y corrígela si hace falta.` };
  },
});

/** Video base de la edición (el mismo que usa el render: misma clave, se reutiliza). */
async function editPlate(p: EditProject) {
  const perfil = p.direccion ? directedProfile(p.perfil, p.direccion) : p.perfil;
  const intervals = snapToFrames(keptIntervals(p.frases, perfil.ritmo, p.original.duracion));
  const r = await buildPlate(p, perfil, intervals);
  return { ...r, intervals, perfil };
}

const pistaPersona = tool({
  name: 'pista_persona',
  description:
    'Analiza a la persona con MediaPipe (una vez por video, ~20 s por minuto; luego queda en caché): dónde está su cara y cuánto se mueve, cuándo se ven sus manos y los MOVIMIENTOS amplios del cuerpo (gesto rápido, mano que cruza delante, inclinación, mano que entra) con su segundo exacto en la línea principal. Úsalo para cortar o transicionar «con el cuerpo», para que un elemento siga una mano (elementos[].seguir) y antes de usar persona (fondo desenfocado/cambiado, clon) o detrasDePersona. $0.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    assertIdle(p);
    const { key, plate, total, perfil } = await editPlate(p);
    const { width: W, height: H } = formatSize(perfil.formato);
    try {
      const r = await ensurePersonTrack({ carpeta: p.carpeta, plate, key, W, H, frames: Math.round(total * 30) });
      return { ok: true, nueva: r.nueva, ...personSummary(r.track), nota: 'Tiempos de la línea principal (palabras_borrador). manos: % del video en que se ve cada mano (izquierda/derecha de la persona).' };
    } catch (err) {
      if (err instanceof PersonUnavailable) throw new AgentToolError(err.message, 503);
      throw err;
    }
  },
});

const analizarImagen = tool({
  name: 'analizar_imagen',
  description:
    'Mide la toma: temblor de la cámara (quieto/leve/tiembla, en píxeles) y brillo y tinte de cada tramo (si las tomas son de momentos distintos y no casan). Te dice si conviene estabilizar: true o igualarLuz: true en dirigir_edicion. $0.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    assertIdle(p);
    const { plate, intervals } = await editPlate(p);
    const shake = await measureShake(p.carpeta, plate).catch(() => null);
    const tramos = intervals.map((iv) => [iv.out, iv.out + (iv.e - iv.s)] as [number, number]);
    const luz = await lightStats(p.carpeta, plate, tramos).catch(() => []);
    const lm = matchLightFilter(luz);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const ys = luz.map((x) => x.y);
    return {
      temblor: shake ?? { nota: 'Este FFmpeg no trae vidstab: no se puede medir (la estabilización usaría deshake).' },
      luz: {
        tramos: luz.length,
        brillo: ys.length ? { min: r1(Math.min(...ys)), max: r1(Math.max(...ys)) } : null,
        tramosQueSeDesvian: lm.ajustados,
      },
      recomendacion: [
        shake && shake.nivel === 'tiembla' ? 'estabilizar: true (la cámara tiembla).' : shake && shake.nivel === 'leve' ? 'Temblor leve: estabiliza solo si vas a hacer zoom fuerte.' : 'No hace falta estabilizar.',
        lm.ajustados ? `igualarLuz: true (${lm.ajustados} tramo(s) con otra luz o tinte).` : 'La luz es pareja entre tramos.',
      ],
    };
  },
});

const crearVariante = tool({
  name: 'crear_variante',
  description:
    'Renderiza una VARIANTE del borrador actual sin tocarlo (queda junto al borrador en la app): ganchos A/B (otro texto de gancho, otro avance al inicio o sin avance, un primer plano al empezar con zoomInicio) o versión corta/larga (conservarFrases = ids de las frases que se quedan; quitarFrases = las que se quitan). Tiempos del avance en la línea principal ACTUAL. Usa nombres cortos: «A», «B», «corta». Tarda como un render. $0.',
  schema: VariantInputSchema,
  run: async (editId, input) => {
    const p = await getEdit(editId);
    assertIdle(p);
    let v;
    try {
      v = await renderVariant(p, input);
    } catch (err) {
      if (err instanceof OutputError) throw new AgentToolError(err.message, err.status);
      throw err;
    }
    await updateEdit(editId, (q) => {
      q.variantes = [...(q.variantes ?? []).filter((x) => x.id !== v.id), v];
      logActivity(q, `Claude creó la variante «${v.nombre}» (${Math.round(v.duracion)} s).`);
    });
    return { ok: true, variante: v, siguiente: `Mírala con fotogramas (${v.archivo}) y dile a la persona qué cambia entre las variantes y cuál subiría primero.` };
  },
});

const exportarRedes = tool({
  name: 'exportar_redes',
  description:
    'Exporta el borrador actual para cada red (tiktok, instagram = Reels, shorts): su zona segura, su volumen y un .srt de subtítulos al lado. La persona también puede hacerlo con un botón; úsalo cuando te lo pidan o al aprobar. Tarda un render por red. $0.',
  schema: z.object({ redes: z.array(z.enum(NETWORKS)).min(1).max(3) }),
  run: async (editId, input) => {
    const out = [];
    for (const red of input.redes) {
      const p = await getEdit(editId);
      assertIdle(p);
      try {
        const e = await exportForNetwork(p, red);
        await updateEdit(editId, (q) => {
          q.exportaciones = [...(q.exportaciones ?? []).filter((x) => x.red !== red), e];
          logActivity(q, `Exportado para ${NETWORK_LABEL[red]}.`);
        });
        out.push(e);
      } catch (err) {
        if (err instanceof OutputError) throw new AgentToolError(err.message, err.status);
        throw err;
      }
    }
    return { ok: true, exportaciones: out };
  },
});

const textoPost = tool({
  name: 'texto_post',
  description:
    'Guarda el texto para publicar el video: descripción (primera línea = gancho, frases cortas, una llamada a comentar), hashtags (3–8 relevantes, mezcla de amplios y de nicho; sin relleno) y un primer comentario para fijar (pregunta o recurso). porRed si alguna red pide otro tono o largo. La persona lo copia desde la app. Escríbelo con el contenido REAL del video y el manual. $0.',
  schema: PostInputSchema,
  run: async (editId, input) => {
    await updateEdit(editId, (q) => {
      q.post = { descripcion: input.descripcion, hashtags: input.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)), comentario: input.comentario, porRed: input.porRed, actualizado: new Date().toISOString() };
      logActivity(q, 'Claude escribió el texto del post.');
    });
    return { ok: true };
  },
});

const puntuarBorrador = tool({
  name: 'puntuar_borrador',
  description:
    'Nota de retención 0–100 del borrador actual (gancho, ritmo y re-ganchos, variedad, sonido, cierre, legibilidad) con las 3 mejoras que más puntos suben. No predice vistas: mide si cumple lo que sabemos que retiene. Se calcula sola tras cada render; úsala antes de dar por bueno un borrador. $0.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    const nota = await scoreEdit(p);
    if (!nota) throw new AgentToolError('La nota necesita un plan de dirección (dirigir_edicion).');
    if (p.borrador) await updateEdit(editId, (q) => {
      if (q.borrador && q.borrador.version === p.borrador?.version) q.borrador.nota = nota;
    });
    return nota;
  },
});

const registrarMetricas = tool({
  name: 'registrar_metricas',
  description:
    'Registra las métricas reales de este video publicado (de una captura o CSV que la persona adjuntó: léelos tú con Read) y cruza la curva de retención con el plan: en cada caída fuerte te dice qué había en pantalla, cuántos segundos llevaba sin cambio visual y qué se decía. Con eso guarda lecciones con evidencia (aprender_del_feedback). retencion: [{t (segundo del video publicado), pct}] con todos los puntos que puedas leer de la gráfica. Se comparte con el equipo (para comparar y la mejor hora). $0.',
  schema: MetricInputSchema,
  run: async (editId, input) => {
    const p = await getEdit(editId);
    const m = await newMetric(p, input);
    await updateEdit(editId, (q) => {
      q.metricas = [...(q.metricas ?? []), m];
      logActivity(q, `Métricas de ${input.red} registradas${input.vistas !== undefined ? ` (${input.vistas} vistas)` : ''}.`);
    });
    await shareMetric(p, m).catch(() => undefined);
    const { compartido } = await metricsDoc.load();
    return { ok: true, compartido, ...analyzeRetention(p, input) };
  },
});

const mejorHora = tool({
  name: 'mejor_hora',
  description: 'Mejor día y franja para publicar según las métricas reales del equipo (registrar_metricas con fecha y hora). Con pocos datos devuelve solo una orientación general por red (y lo dice). $0.',
  schema: z.object({}),
  run: async () => bestTime(),
});

const analizarReferencia = tool({
  name: 'analizar_referencia',
  description:
    'Mide un video de referencia viral (url de YouTube/TikTok/Instagram que se baja con yt-dlp, o un archivo de la carpeta o del material): cortes por minuto, duración media y máxima de los planos, primer corte, volumen y BPM, y deja una HOJA de 12 fotogramas (Read) para que veas subtítulos, colores, gráficos y encuadres. Luego guarda tu ficha con guardar_referencia. El video es solo para medir: nunca lo uses dentro de una edición. $0.',
  schema: z.object({ url: z.string().url().optional(), archivo: z.string().max(400).optional(), nombre: z.string().max(80).optional() }),
  run: async (editId, input) => {
    let archivo: string | undefined;
    if (input.archivo) {
      const p = await getEdit(editId);
      archivo = path.isAbsolute(input.archivo) ? input.archivo : editAsset(p.carpeta, input.archivo);
      if (!fsSync.existsSync(archivo)) throw new AgentToolError(`No existe «${input.archivo}».`);
    }
    if (!input.url && !archivo) throw new AgentToolError('Indica url o archivo.');
    try {
      const r = await measureReference({ url: input.url, archivo, nombre: input.nombre });
      return { ...r, siguiente: r.hoja ? `Mira la hoja (Read ${r.hoja}) y guarda la ficha con guardar_referencia { id: "${r.ficha.id}", estilo, ideas, cuandoUsar }.` : 'Guarda la ficha con guardar_referencia.' };
    } catch (err) {
      throw new AgentToolError(errorMessage(err, 'No se pudo analizar la referencia.'), 400);
    }
  },
});

const guardarReferencia = tool({
  name: 'guardar_referencia',
  description:
    'Guarda (compartida con el equipo) la ficha de una referencia medida con analizar_referencia, con lo que viste: estilo (subtítulos, colores, gráficos, encuadres, ritmo), ideas concretas para imitar y cuándo usarla. Después cualquier Claude puede imitarla (referencias). $0.',
  schema: z.object({ id: z.string().max(20), nombre: z.string().max(80).optional(), estilo: z.string().trim().min(20).max(1200), ideas: z.array(z.string().max(200)).min(1).max(10), cuandoUsar: z.string().max(300).optional() }),
  run: async (_editId, input) => {
    try {
      return { ok: true, ...(await saveReference(input.id, input)) };
    } catch (err) {
      throw new AgentToolError(errorMessage(err, 'No se pudo guardar.'), 400);
    }
  },
});

const referenciasTool = tool({
  name: 'referencias',
  description: 'Fichas de videos de referencia que el equipo analizó (ritmo medido + estilo e ideas): para imitar una en un video concreto cuando la persona lo pida o encaje. $0.',
  schema: z.object({}),
  run: async () => {
    const { data, compartido, aviso } = await referencesDoc.load();
    return { compartido, ...(aviso ? { aviso } : {}), fichas: data.fichas };
  },
});

const pedirAprobacion = tool({
  name: 'pedir_aprobacion',
  description:
    'Pide a la persona que apruebe un gasto (doblaje, palabras corregidas con su voz). Sale una tarjeta en la app con el concepto y el monto; nada se cobra sin su aprobación. Pide el total de una vez (mira costo_voz_e_idioma). Después TERMINA tu turno: cuando la persona decida te llegará un mensaje con el resultado.',
  schema: z.object({ concepto: z.string().min(3).max(200), montoUSD: z.number().positive().max(20) }),
  run: async (editId, input) => {
    const ap = await requestApproval(editId, input.concepto, input.montoUSD);
    return { aprobacionId: ap.id, nota: 'Tarjeta mostrada en la app. Termina tu turno y espera la decisión.' };
  },
});

const costoVozIdioma = tool({
  name: 'costo_voz_e_idioma',
  description: 'Cuánto costaría doblar el borrador actual (ElevenLabs Dubbing $0,50/min + transcripción) y corregir textos con la voz clonada (por caracteres). Úsalo antes de pedir_aprobacion. $0.',
  schema: z.object({ correcciones: z.array(z.string().max(200)).max(20).optional() }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    const d = p.borrador ? dubEstimate(p.borrador.duracion) : null;
    const c = (input.correcciones ?? []).reduce((sum, t) => sum + correctionCost(t), 0);
    return {
      doblajePorIdioma: d ? { ...d, nota: `Borrador de ${Math.round(p.borrador!.duracion)} s.` } : 'Sin borrador todavía.',
      correcciones: input.correcciones?.length ? { total: Number(c.toFixed(4)), textos: input.correcciones.length } : undefined,
      idiomasDeDoblaje: DUB_LANGS,
    };
  },
});

const vocesTool = tool({
  name: 'voces',
  description: 'Voces de ElevenLabs guardadas en la app (las clonadas son las de las personas del equipo o sus clientes). Para corregir_palabra usa la voz clonada de la persona del video. $0.',
  schema: z.object({}),
  run: async () => ({ voces: (await getStoredVoices()).map((v) => ({ id: v.id, nombre: v.name, tipo: v.category === 'cloned' ? 'clonada' : 'de catálogo', descripcion: v.description })) }),
});

const corregirPalabra = tool({
  name: 'corregir_palabra',
  description:
    'Corrige una palabra o frase mal dicha: genera el texto con la voz CLONADA de la persona (ElevenLabs, de pago: necesita aprobacionId aprobado) y lo pone en lugar del audio original en desde–hasta (segundos de la línea principal; ajusta el tempo al hueco y el volumen al de la voz). Para que no se note el labio, pon en ese tramo un cambio de plano, un punch o un elemento encima. Después renderiza.',
  schema: z.object({ desde: z.number().min(0), hasta: z.number().min(0), texto: z.string().trim().min(1).max(200), vozId: z.string().min(5), aprobacionId: z.string().min(3), idioma: z.string().max(5).optional() }),
  run: async (editId, input) => {
    if (input.hasta <= input.desde + 0.05 || input.hasta - input.desde > 6) throw new AgentToolError('El tramo debe durar entre 0,05 y 6 s.');
    const voz = (await getStoredVoices()).find((v) => v.id === input.vozId);
    if (!voz) throw new AgentToolError('Esa voz no está guardada en la app (mira voces).');
    const p0 = await getEdit(editId);
    assertIdle(p0);
    const cost = correctionCost(input.texto);
    try {
      await spendApproval(editId, input.aprobacionId, cost);
    } catch (err) {
      if (err instanceof PaidError) throw new AgentToolError(err.message, err.status);
      throw err;
    }
    let gen;
    try {
      gen = await generateCorrection(p0, { texto: input.texto, vozId: voz.id, vozNombre: voz.name, idioma: input.idioma });
    } catch (err) {
      // No se cobró: se devuelve el saldo
      await updateEdit(editId, (q) => {
        const a = (q.aprobaciones ?? []).find((x) => x.id === input.aprobacionId);
        if (a) a.usadoUSD = Math.max(0, Number((a.usadoUSD - cost).toFixed(4)));
      });
      throw new AgentToolError(errorMessage(err, 'No se pudo generar la voz.'), 502);
    }
    const intervals = snapToFrames(keptIntervals(p0.frases, normalizeProfile(p0.perfil).ritmo, p0.original.duracion));
    const total = totalDuration(intervals);
    const lib = await musicDir();
    await updateEdit(editId, (q) => {
      const prev = q.direccion ? directionInFinal(q.direccion, intervals, total).correcciones ?? [] : [];
      try {
        const r = prepareDirection(q, DirectionInputSchema.parse({ correcciones: [...prev, { desde: input.desde, hasta: input.hasta, archivo: gen.archivo, texto: input.texto }] }), intervals, total, q.direccion, lib);
        q.direccion = r.direccion;
      } catch (err) {
        if (err instanceof DirectionError) throw new AgentToolError(err.message);
        throw err;
      }
      logActivity(q, `Claude corrigió «${input.texto}» con la voz de ${voz.name}.`);
    });
    return { ok: true, archivo: gen.archivo, costoUSD: Number(gen.costUSD.toFixed(4)), siguiente: `Tapa el labio en ${input.desde}–${input.hasta} s (cambio de plano, punch o un elemento) y renderiza.` };
  },
});

const doblarVideo = tool({
  name: 'doblar_video',
  description:
    'Dobla el borrador actual a otro idioma con ElevenLabs (la voz de la persona en ese idioma, mantiene música y efectos) y le pone subtítulos en el idioma nuevo con el estilo del video. De pago: necesita aprobacionId aprobado (costo_voz_e_idioma → pedir_aprobacion). gancho = el texto del gancho ya traducido (si no, va sin gancho). Los textos del kit y gráficos siguen en español: avísalo. Queda como variante «doblaje-<idioma>». Tarda varios minutos.',
  schema: z.object({ idioma: z.enum(Object.keys(DUB_LANGS) as [string, ...string[]]), gancho: z.string().max(120).optional(), aprobacionId: z.string().min(3) }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    assertIdle(p);
    if (!p.borrador) throw new AgentToolError('Primero hace falta un borrador.');
    let r;
    try {
      r = await dubDraft(editId, input);
    } catch (err) {
      if (err instanceof PaidError) throw new AgentToolError(err.message, err.status);
      throw err;
    }
    const v = { id: `doblaje-${input.idioma}`, nombre: `Doblaje ${DUB_LANGS[input.idioma]}`, descripcion: `Doblado con ElevenLabs y subtítulos en ${DUB_LANGS[input.idioma]}`, archivo: r.archivo, duracion: r.duracion, creado: new Date().toISOString(), deVersion: p.borrador.version };
    await updateEdit(editId, (q) => {
      q.variantes = [...(q.variantes ?? []).filter((x) => x.id !== v.id), v];
      logActivity(q, `Doblaje a ${DUB_LANGS[input.idioma]} listo (~$${r.costoUSD.toFixed(2)}).`);
    });
    return { ok: true, variante: v, costoUSD: r.costoUSD, siguiente: 'Míralo con fotogramas y escucha un tramo; avisa de los textos en pantalla que siguen en español.' };
  },
});

const vocesDeFondo = tool({
  name: 'voces_de_fondo',
  description:
    'Voces que NO son de la persona del video (alguien que le dicta detrás de cámara, gente de fondo): frases transcritas de otra voz (separación de hablantes, labios quietos) y zonas de voz ajena sin transcribir en pausas y márgenes. Se analiza sola al crear la edición; con revisar: true vuelve a analizar (gratis, local) y lo aplica: corta las frases de fondo (si te dictan y la persona repite, se queda su repetición) y quita o silencia las zonas. Úsala si la persona dice que se oye a alguien de fondo. Después renderiza.',
  schema: z.object({ revisar: z.boolean().default(false) }),
  run: async (editId, input) => {
    let p = await getEdit(editId);
    if (input.revisar || !p.vocesFondo) {
      assertIdle(p);
      const report = await detectBackgroundVoices(p);
      ({ edit: p } = await updateEdit(editId, (q) => {
        applyBackgroundReport(q, report);
        logActivity(q, `Claude revisó las voces de fondo. ${report.resumen}`);
      }));
    }
    const r = p.vocesFondo!;
    return {
      resumen: r.resumen,
      hablantesDetectados: r.hablantes,
      conAnalisisDeLabios: r.conLabios,
      frasesDeFondo: r.frasesDeFondo,
      zonasDeVozAjena: r.zonas.filter((z) => z.fuente === 'sin_transcribir'),
      comoSeAplica: `Las frases de fondo quedan cortadas. Las zonas de ${'≥'} 0,35 s se cortan; las más cortas se silencian en el render. Si una frase marcada SÍ es de la persona, vuelve a ponerla con cambiar_guion (cortar: false).`,
    };
  },
});

const estandarMarca = tool({
  name: 'estandar_marca',
  description:
    'Estándar de edición de la marca de esta edición (el que entregó el cliente): manda sobre el manual y el criterio general. Devuelve el texto completo, la marca y lo que el motor aún no hace (para avisarlo antes de entregar). Si la edición no tiene marca, mira marcas y usar_marca. $0.',
  schema: z.object({}),
  run: async (editId) => {
    const p = await getEdit(editId);
    const b = await brandOf(p);
    if (!b) return { marca: null, nota: 'Esta edición no tiene marca. Si el video es de una marca guardada, usar_marca.' };
    return { marca: { id: b.id, nombre: b.nombre, colores: b.colores, fuente: b.fuente }, estandar: b.estandar ?? null, limitacionesDelMotor: ENGINE_LIMITS };
  },
});

const usarMarca = tool({
  name: 'usar_marca',
  description: 'Asigna esta edición a una marca guardada (nombre o id de marcas); desde el siguiente mensaje su estándar de edición manda. marca: null la quita. $0.',
  schema: z.object({ marca: z.string().max(60).nullable() }),
  run: async (editId, input) => {
    if (input.marca === null) {
      await updateEdit(editId, (q) => {
        q.marcaId = undefined;
        logActivity(q, 'Claude quitó la marca de la edición.');
      });
      return { ok: true, marca: null };
    }
    const { findBrand } = await import('./kit/brands');
    const b = await findBrand(input.marca).catch(() => null);
    if (!b) throw new AgentToolError(`No hay ninguna marca «${input.marca}» (mira marcas).`, 404);
    await updateEdit(editId, (q) => {
      q.marcaId = b.id;
      logActivity(q, `Edición asignada a la marca ${b.nombre}.`);
    });
    return { ok: true, marca: b.nombre, tieneEstandar: !!b.estandar?.trim(), siguiente: b.estandar ? 'Lee estandar_marca y síguelo.' : 'La marca no tiene estándar de edición: sigue el manual.' };
  },
});

const cortarPalabras = tool({
  name: 'cortar_palabras',
  description:
    'Corte POR PALABRA dentro de una frase que se conserva: quita (o restaura con restaurar: true) la secuencia exacta de palabras «quitar» de la frase (id de ver_edicion; sin importar mayúsculas, tildes ni signos; ocurrencia si aparece varias veces). Úsalo para arranques repetidos, muletillas, palabras sueltas o una toma repetida dentro de la frase (queda la última). Con detectar: true vuelve a buscar arranques repetidos en todo el guion. Después renderiza. $0.',
  schema: z.object({
    cortes: z.array(z.object({ frase: z.string(), quitar: z.string().min(1).max(200), ocurrencia: z.number().int().min(1).max(10).default(1), restaurar: z.boolean().default(false) })).max(40).default([]),
    detectar: z.boolean().default(false),
  }),
  run: async (editId, input) => {
    const resultados: unknown[] = [];
    await updateEdit(editId, (q) => {
      assertIdle(q);
      for (const c of input.cortes) {
        const f = q.frases.find((x) => x.id === c.frase);
        if (!f) {
          resultados.push({ frase: c.frase, ok: false, error: 'No existe esa frase (mira ver_edicion).' });
          continue;
        }
        resultados.push({ frase: c.frase, ...cutWordsByText(f, c.quitar, !c.restaurar, c.ocurrencia) });
      }
      if (input.detectar) resultados.push({ detectados: detectRestarts(q.frases) });
      logActivity(q, `Claude cortó por palabra (${input.cortes.length} cambio(s)${input.detectar ? ' + detección de arranques repetidos' : ''}).`);
    });
    return { resultados, siguiente: 'Comprueba con palabras_borrador que no quedan medias palabras ni repeticiones y renderiza.' };
  },
});

const instalarFuente = tool({
  name: 'instalar_fuente',
  description:
    'Instala una fuente de Google Fonts (licencia OFL, uso libre) en la carpeta de fuentes de Lulo, en los pesos pedidos (400 normal, 600 semibold, 700 bold…). Devuelve el NOMBRE a usar en subtitulos.fuente y en kit_grafico.fuente (p. ej. «Sora SemiBold»). Úsala cuando un estándar de marca pida una fuente que no está. Sin argumentos lista las instaladas. $0.',
  schema: z.object({ familia: z.string().max(40).optional(), pesos: z.array(z.number().int().min(100).max(900)).max(6).default([400]) }),
  run: async (_editId, input) => {
    if (!input.familia) return { instaladas: await listFonts() };
    try {
      return { ok: true, instaladas: await installGoogleFont(input.familia, input.pesos) };
    } catch (err) {
      throw new AgentToolError(errorMessage(err, 'No se pudo instalar la fuente.'), 400);
    }
  },
});

const verificarAudioFinal = tool({
  name: 'verificar_audio_final',
  description:
    'Transcribe el audio del BORRADOR y lo compara con el guion que debería sonar: palabras que faltan (un corte se comió algo), que sobran (voz ajena, restos de una toma) y repetidas, con su segundo en el borrador. Gratis con Whisper local si está instalado; si no, ElevenLabs (céntimos: necesita aprobacionId aprobado, mira el costo con aprobacionId vacío). Úsala antes de entregar cuando el estándar lo pida o el corte sea delicado.',
  schema: z.object({ aprobacionId: z.string().optional() }),
  run: async (editId, input) => {
    const p = await getEdit(editId);
    assertIdle(p);
    if (!p.borrador) throw new AgentToolError('Primero renderiza un borrador.');
    const free = await canVerifyFree();
    if (!free) {
      const cost = verifyCost(p.borrador.duracion);
      if (!input.aprobacionId) return { necesitaAprobacion: true, costoUSD: cost, nota: `Whisper local no está instalado: con ElevenLabs cuesta ~$${cost.toFixed(4)}. Pide aprobación (pedir_aprobacion) y vuelve a llamar con su aprobacionId.` };
      try {
        await spendApproval(editId, input.aprobacionId, cost);
      } catch (err) {
        if (err instanceof PaidError) throw new AgentToolError(err.message, err.status);
        throw err;
      }
    }
    try {
      return await verifyFinalAudio(p, !free);
    } catch (err) {
      throw new AgentToolError(errorMessage(err, 'No se pudo verificar el audio.'), 500);
    }
  },
});

const marcasTool = tool({
  name: 'marcas',
  description: 'Marcas guardadas por el equipo (logo, colores, tipografía, lema, usuario y CTA) para hacer su intro o su cierre con kit_grafico tipo «marca». Úsalas cuando el video sea de esa marca. $0.',
  schema: z.object({}),
  run: async () => {
    const { marcas, compartidas, aviso } = await loadBrands();
    return {
      compartidas,
      ...(aviso ? { aviso } : {}),
      marcas: marcas.filter((m) => m.estado === 'activa').map((m) => ({ id: m.id, nombre: m.nombre, colores: m.colores, fuente: m.fuente, lema: m.lema, usuario: m.usuario, cta: m.cta, nota: m.nota, conLogo: !!m.logoExt, tieneEstandarDeEdicion: !!m.estandar?.trim() })),
    };
  },
});

const dirigirEdicion = tool({
  name: 'dirigir_edicion',
  description:
    'Guarda TU plan de dirección y el motor lo ejecuta tal cual al renderizar (sin reglas automáticas): camara, transiciones, color, subtitulos (diseño y animación), palabrasClave (color/tamaño/efecto por palabra), gancho (texto y estilo), graficos (los escribes tú: tarjeta|numero|lista|detras en el segundo t), estiloGraficos, elementos (imágenes/videos de la carpeta en pantalla completa, flotantes o pantalla dividida), sonidos (efectos en su segundo exacto, todos los que quieras) y musica (generada por estilo con secciones suave/completa/silencio, o un archivo), voz (mejora, respiraciones, efectos de voz por tramo), ambientes de fondo y volumenFinal; los audios de la biblioteca del equipo van como «biblioteca:<id>». TIEMPOS EN SEGUNDOS DEL VIDEO FINAL (palabras_borrador). Cada sección que mandes reemplaza a la anterior; las que no mandes se conservan. `borrar: true` quita el plan entero (vuelve al estilo automático del perfil). Mira catalogo_edicion. Después, renderizar.',
  schema: DirectionInputSchema.extend({ borrar: z.boolean().optional() }),
  run: async (editId, input) => {
    const { borrar, ...plan } = input;
    let resumen = '';
    let avisos: string[] = [];
    const lib = await musicDir();
    if (!borrar) {
      // «biblioteca:<id>» → copia en la carpeta de la edición
      const probs = await materializeLibraryRefs((await getEdit(editId)).carpeta, plan);
      if (probs.length) throw new AgentToolError(`El plan tiene problemas, corrígelos y vuelve a mandarlo:\n${probs.join('\n')}`);
    }
    const { edit } = await updateEdit(editId, (p) => {
      assertIdle(p);
      if (borrar) {
        p.direccion = undefined;
        logActivity(p, 'Claude quitó su plan de dirección.');
        return;
      }
      const intervals = snapToFrames(keptIntervals(p.frases, normalizeProfile(p.perfil).ritmo, p.original.duracion));
      try {
        const r = prepareDirection(p, plan, intervals, totalDuration(intervals), p.direccion, lib);
        p.direccion = r.direccion;
        if (r.graficos) p.graficos = r.graficos;
        if (plan.gancho?.texto !== undefined) p.gancho = plan.gancho.texto;
        avisos = r.avisos;
        resumen = describeDirection(r.direccion, (p.graficos ?? []).filter((g) => g.activo).length);
        logActivity(p, `Claude dirigió la edición: ${resumen}.`);
      } catch (err) {
        if (err instanceof DirectionError) throw new AgentToolError(`El plan tiene problemas, corrígelos y vuelve a mandarlo:\n${err.message}`);
        throw err;
      }
    });
    if (borrar) return { ok: true, plan: null };
    const finalPlan = planInFinal(edit);
    const intervals = snapToFrames(keptIntervals(edit.frases, normalizeProfile(edit.perfil).ritmo, edit.original.duracion));
    const total = totalDuration(intervals);
    const graphicStarts = placeGraphics(edit, intervals, total).map((g) => g.start);
    const sub = directedProfile(edit.perfil, edit.direccion!).subtitulos;
    const ritmo = analyzeRhythm(finalPlan, graphicStarts, total, sub.activo ? sub.tamano : undefined);
    const pb = await planBeats(edit).catch(() => null);
    const beat = pb ? beatReport(finalPlan, pb.grid) : undefined;
    if (beat?.avisos.length) ritmo.avisos.push(...beat.avisos);
    return {
      ok: true,
      resumen,
      avisos,
      ritmo,
      ...(beat ? { musicaBeat: { musica: pb!.musica, bpm: beat.bpm, confianza: beat.confianza, cortesEnElBeat: beat.cortesEnElBeat } } : {}),
      siguiente: ritmo.avisos.length
        ? 'Corrige los avisos de ritmo (vuelve a llamar a dirigir_edicion solo con las secciones que cambien) y después renderizar.'
        : 'El ritmo está equilibrado: renderizar y después revisa fotogramas en los momentos clave y escuchar_audio.',
      direccion: finalPlan,
    };
  },
});

export const EDITOR_AGENT_TOOLS: AgentTool[] = [verManual, aprenderDelFeedback, catalogoEdicion, bibliotecaAudio, beatsMusica, kitGrafico, zonasDeCambio, marcasTool, disenarPortada, pistaPersona, analizarImagen, crearVariante, exportarRedes, textoPost, puntuarBorrador, registrarMetricas, mejorHora, analizarReferencia, guardarReferencia, referenciasTool, pedirAprobacion, costoVozIdioma, vocesTool, corregirPalabra, doblarVideo, vocesDeFondo, estandarMarca, usarMarca, cortarPalabras, instalarFuente, verificarAudioFinal, dirigirEdicion, verFeedback, tomarFeedback, responderFeedback, verEdicion, palabrasBorrador, escucharAudio, cambiarPerfil, cambiarGuion, planearGraficos, renderizar, esperarRender, revisarHtmlVideo, renderizarHtmlVideo, publicarBorrador];

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
