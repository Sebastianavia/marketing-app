import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { DEFAULT_ELEVEN_MODEL } from '@/config/elevenlabs-models';
import { getConfiguredVoiceId } from '@/services/elevenlabs/elevenlabs.service';
import { frameSize, probeMedia, runFfmpeg, stitchScenes } from '@/lib/video/ffmpeg';
import { computeSceneStarts, safeCrossfade, type Alignment } from '@/lib/scenes/scene-timing';
import { sendToClaudeEditor } from '@/lib/editor/claude-handoff';
import {
  ProductionError,
  currentFiles,
  pendingApproval,
  productionSpent,
  requireProduction,
  updateProduction,
  type Production,
  type ProductionScene,
  type SceneSpec,
} from '@/lib/director/production-store';
import { changeScene, proposeScenes, runAvatarScene, runBrollScene, runImageScene, runVoiceScene } from '@/lib/director/production';
import { reconcileProduction } from '@/lib/director/production-jobs';
import { clipChoiceProblem } from '@/config/broll-models';
import { NINE_SYMPTOMS, composeImagePrompt, composeVideoPrompt } from './prompts';
import { refAbsPath } from './references';
import { sceneClipChoice } from './durations';
import { sceneRefs, sceneTags, tagRefs } from './mentions';
import type { DirectorGeneration, DirectorScene, DirectorState } from './types';

/**
 * Fase de generación del modo Director: guion + prompts aprobados → escenas de pago con presupuesto
 * → la persona aprueba EN LA APP (aviso del Director en la barra superior) → se generan → se monta
 * el video final con FFmpeg → (modo Claude) pasa al editor para que Claude lo pula.
 *
 * Las reglas de gasto son las de lib/director/production.ts: solo se ejecuta lo aprobado, con
 * margen del 10 %, presupuesto y límite diario; cambiar algo vuelve a pedir aprobación.
 */

function needGuion(d: DirectorState) {
  if (d.etapas.prompts.estado !== 'aprobada') throw new ProductionError('Primero aprueba los prompts: el video se genera a partir de ellos.', 409);
  const escenas = d.guion?.escenas ?? [];
  if (!escenas.length) throw new ProductionError('No hay guion.', 409);
  const sinPrompt = escenas.filter((s) => !s.prompt || s.prompt.deVersion !== s.version).map((s) => s.orden);
  if (sinPrompt.length) throw new ProductionError(`Faltan o están desactualizados los prompts de las escenas ${sinPrompt.join(', ')}.`, 409);
  return escenas;
}

/** Fotos de referencia para la imagen inicial: las de la escena, las de sus etiquetas y las del proyecto. */
function imageRefsFor(s: DirectorScene, d: DirectorState, maxRefs = 14): string[] {
  const refs = d.referencias ?? [];
  const tags = sceneTags(d, s);
  const ordered = [
    ...sceneRefs(d, s.id),
    // Las etiquetas con avatar ya mandan las fotos del avatar
    ...tags.filter((t) => !t.avatarId).flatMap((t) => tagRefs(d, t.id)),
    ...refs.filter((r) => !r.escenaId && !r.etiquetaId),
  ].filter((r) => r.medio === 'imagen');
  return [...new Set(ordered.map((r) => r.archivo))].slice(0, maxRefs);
}

/** Avatar cuya identidad se usa en la escena: el de un personaje que nombra; en voz nativa, el de los ajustes. */
function sceneAvatarId(s: DirectorScene, d: DirectorState): string | undefined {
  const fromTag = sceneTags(d, s).find((t) => t.tipo === 'personaje' && t.avatarId)?.avatarId;
  if (fromTag) return fromTag;
  return d.ajustes.modoVoz === 'native' && d.ajustes.avatarId ? d.ajustes.avatarId : undefined;
}

/** Escenas de pago a partir del guion, según el modo de voz de los ajustes. */
function buildPlan(d: DirectorState): { specs: SceneSpec[]; gen: Omit<DirectorGeneration, 'preparada'> } {
  const escenas = needGuion(d);
  const a = d.ajustes;
  const vozId = getConfiguredVoiceId() || undefined;
  const specs: SceneSpec[] = [];
  const mapa: DirectorGeneration['mapa'] = [];
  const add = (spec: SceneSpec) => {
    specs.push(spec);
    return `e${specs.length}`;
  };
  let vozGeneral: string | undefined;

  if (a.modoVoz === 'voiceover') {
    const texto = escenas.map((s) => s.dialogo.trim()).filter(Boolean).join(' ');
    if (texto) vozGeneral = add({ tipo: 'voz', titulo: 'Locución completa', texto, vozId, modeloVoz: DEFAULT_ELEVEN_MODEL });
  }
  for (const s of escenas) {
    if (a.modoVoz === 'avatar' && s.tipo === 'avatar') {
      if (!a.avatarId) throw new ProductionError('El modo "avatar" necesita un avatar en los ajustes.', 409);
      mapa.push({
        escenaId: s.id,
        clip: add({ tipo: 'avatar', titulo: `Escena ${s.orden} · avatar`, texto: s.dialogo, avatarId: a.avatarId, vozId, modeloVoz: DEFAULT_ELEVEN_MODEL, movimiento: s.prompt?.texto.slice(0, 400) }),
      });
      continue;
    }
    const choice = sceneClipChoice(s, a);
    // En voz nativa solo las escenas con diálogo necesitan audio del modelo
    const conAudio = a.modoVoz === 'native' && Boolean(s.dialogo.trim());
    const problem = clipChoiceProblem(choice.model, { formato: a.formato, resolucion: choice.resolucion, conAudio });
    if (problem) throw new ProductionError(`Escena ${s.orden}: ${problem}`, 409);
    const avatarId = sceneAvatarId(s, d);
    // Imagen inicial (GPT Image 2 / Nano Banana Pro / Seedream 5.0 Pro / modelo elegido) → primer fotograma del clip
    let imagen: string | undefined;
    if (choice.imagenInicial) {
      const imgModel = choice.imageModel;
      const imgRes = imgModel.resolutions.includes('1.5K')
        ? '1.5K'
        : imgModel.resolutions.includes('1K')
          ? '1K'
          : imgModel.resolutions[0];
      const maxExtraRefs = Math.min(14, avatarId ? Math.max(0, imgModel.maxRefs - 1) : imgModel.maxRefs);
      const referencias = imageRefsFor(s, d, maxExtraRefs);
      imagen = add({
        tipo: 'imagen',
        titulo: `Escena ${s.orden} · imagen inicial (${imgModel.name})`,
        prompt: composeImagePrompt(s, d),
        modelo: imgModel.id,
        resolucion: imgRes,
        cantidad: 1,
        ...(avatarId ? { avatarId } : {}),
        ...(referencias.length ? { referencias } : {}),
      });
    }
    const prevClip = choice.continuarAnterior && mapa.length > 0 ? mapa[mapa.length - 1].clip : undefined;
    const clip = add({
      tipo: 'toma_de_apoyo',
      titulo: `Escena ${s.orden} · ${s.queSeVe.slice(0, 60)}`,
      prompt: composeVideoPrompt(s, d),
      duracionSeg: s.clipSeg ?? s.duracionSeg,
      modelo: choice.model.id,
      resolucion: choice.resolucion,
      conAudio,
      ...(imagen ? { imagenDeEscena: imagen } : {}),
      ...(prevClip ? { continuarDeEscena: prevClip } : {}),
      // Fotos del avatar como referencias extra (solo Apimart admite varias imágenes)
      ...(avatarId && choice.model.provider === 'apimart' ? { avatarReferencias: avatarId } : {}),
    });
    // Avatar: las tomas de apoyo llevan su propia locución
    const voz = a.modoVoz === 'avatar' && s.dialogo.trim() ? add({ tipo: 'voz', titulo: `Escena ${s.orden} · voz`, texto: s.dialogo, vozId, modeloVoz: DEFAULT_ELEVEN_MODEL }) : undefined;
    mapa.push({ escenaId: s.id, clip, ...(voz ? { voz } : {}), ...(imagen ? { imagen } : {}) });
  }
  return { specs, gen: { mapa, ...(vozGeneral ? { vozGeneral } : {}), modoVoz: a.modoVoz } };
}

function sceneSummary(s: ProductionScene) {
  return {
    id: s.id,
    titulo: s.spec.titulo ?? s.spec.tipo,
    tipo: s.spec.tipo,
    estado: s.estado,
    estimadoUSD: s.estimadoUSD,
    gastoUSD: s.gastoUSD,
    error: s.error,
    archivos: currentFiles(s).map((f) => ({ rol: f.rol, archivo: path.relative(path.dirname(f.ruta), f.ruta) })),
  };
}

export function generationSummary(p: Production) {
  const a = pendingApproval(p);
  return {
    estado: p.estado,
    presupuestoUSD: p.presupuestoUSD,
    gastadoUSD: productionSpent(p),
    aprobacionPendiente: a ? { id: a.id, montoUSD: a.montoUSD, escenas: a.escenas } : null,
    escenas: p.escenas.map(sceneSummary),
    final: p.director?.produccion?.final ?? null,
  };
}

/** Prepara las escenas de pago y pide la aprobación (no gasta). */
export async function prepareGeneration(id: string) {
  const p = await requireProduction(id);
  const d = p.director;
  if (!d) throw new ProductionError('Este proyecto no es del modo Director.');
  const { specs, gen } = buildPlan(d);
  const { result } = await proposeScenes(id, specs, `Video de "${p.nombre}"`);
  const { production } = await updateProduction(id, (x) => {
    x.director!.produccion = { ...gen, preparada: new Date().toISOString() };
  });
  const monto = result.approval.montoUSD;
  return {
    aprobacion: { id: result.approval.id, montoUSD: monto },
    // Dilo tal cual a la persona: es el único sitio donde se aprueba
    dondeAprobar: `Botón amarillo «El Director pide $${monto.toFixed(3)}» en la barra superior de Lulo Studio → revisar y aprobar. Mientras tanto, los clips del lienzo dicen «Espera tu aprobación».`,
    suposiciones: result.suposiciones,
    ...generationSummary(production),
  };
}

/** Imágenes iniciales a la vez (GPT Image 2 tarda ~30–60 s cada una). */
const IMAGE_PARALLEL = 4;

export interface RunGenerationOptions {
  /** 'storyboard' = solo voces e imágenes iniciales; 'clips' = solo clips de video; 'todo' = ambos. */
  fase?: 'todo' | 'storyboard' | 'clips';
  /** Si se indica, ejecuta únicamente esa escena de pago (p. ej. 'e2'). */
  escenaPagoId?: string;
  /** Paso 11 de Buzzy: lanza primero el Clip 1, espera a que termine y lanza 2…N usando un fotograma del Clip 1 como referencia. */
  anclarAlClip1?: boolean;
}

/**
 * Lanza lo aprobado: las voces primero (las necesita el avatar), luego las imágenes iniciales
 * (de 4 en 4, se esperan: son el primer fotograma de cada clip) y por último los clips, que el
 * runner procesa en segundo plano (máx. 4 a la vez).
 */
export async function runGeneration(id: string, opts: RunGenerationOptions = {}) {
  if (opts.anclarAlClip1 !== undefined) {
    await updateProduction(id, (x) => {
      if (x.director?.produccion) x.director.produccion.anclarAlClip1 = opts.anclarAlClip1;
    });
  }
  let p = await reconcileProduction(id);
  const fase = opts.fase ?? 'todo';
  const targetId = opts.escenaPagoId;
  const lanzadas: string[] = [];
  const errores: string[] = [];
  const ready = (s: ProductionScene) => s.estado === 'aprobada' || (s.estado === 'fallida' && !s.falloConCobro && !s.reintentoUsado && s.aprobadaUSD !== null);
  const run = async (s: ProductionScene) => {
    try {
      if (s.spec.tipo === 'voz') await runVoiceScene(id, s.id);
      else if (s.spec.tipo === 'imagen') await runImageScene(id, s.id);
      else if (s.spec.tipo === 'avatar') await runAvatarScene(id, s.id);
      else if (s.spec.tipo === 'toma_de_apoyo') await runBrollScene(id, s.id);
      else return;
      lanzadas.push(s.id);
    } catch (err) {
      errores.push(`${s.id}: ${err instanceof Error ? err.message : 'error'}`);
    }
  };

  if (targetId) {
    const target = p.escenas.find((s) => s.id === targetId);
    if (!target) throw new ProductionError(`No existe la escena de pago "${targetId}".`, 404);
    // Si pide lanzar un clip cuya imagen inicial aún está aprobada por generar, se genera primero la imagen
    if (target.spec.imagenDeEscena) {
      const imgScene = p.escenas.find((s) => s.id === target.spec.imagenDeEscena);
      if (imgScene && ready(imgScene)) await run(imgScene);
    }
    p = await reconcileProduction(id);
    const refreshed = p.escenas.find((s) => s.id === targetId);
    if (refreshed && ready(refreshed)) await run(refreshed);
  } else {
    const todo = p.escenas.filter(ready);
    if (fase === 'todo' || fase === 'storyboard') {
      for (const s of todo.filter((x) => x.spec.tipo === 'voz')) await run(s);
      const images = todo.filter((x) => x.spec.tipo === 'imagen');
      for (let i = 0; i < images.length; i += IMAGE_PARALLEL) await Promise.all(images.slice(i, i + IMAGE_PARALLEL).map(run));
    }
    if (fase === 'todo' || fase === 'clips') {
      p = await reconcileProduction(id);
      const anchorClip1 = Boolean(p.director?.produccion?.anclarAlClip1);
      const clip1Id = p.director?.produccion?.mapa[0]?.clip;
      const clip1Scene = clip1Id ? p.escenas.find((x) => x.id === clip1Id) : undefined;
      const clipsReady = p.escenas.filter(ready).filter((x) => x.spec.tipo === 'avatar' || x.spec.tipo === 'toma_de_apoyo');
      for (const s of clipsReady) {
        // Paso 11 de Buzzy: si Anclar al Clip 1 está activo y el Clip 1 aún no terminó, solo lanza el Clip 1 primero
        if (anchorClip1 && clip1Scene && s.id !== clip1Scene.id && clip1Scene.estado !== 'lista') {
          continue;
        }
        // Si depende del último fotograma del clip anterior y ese clip aún se está generando, se lanzará en generationStatus al terminar
        if (s.spec.continuarDeEscena) {
          const prev = p.escenas.find((x) => x.id === s.spec.continuarDeEscena);
          if (prev && prev.estado !== 'lista') continue;
        }
        await run(s);
      }
    }
  }

  p = await reconcileProduction(id);
  const pendientes = p.escenas.filter((s) => s.estado === 'pendiente').map((s) => s.id);
  return {
    lanzadas,
    errores,
    nota: pendientes.length ? `Las escenas ${pendientes.join(', ')} esperan aprobación en la app.` : undefined,
    ...generationSummary(p),
  };
}

/** Pide rehacer una sola escena de pago (imagen o clip) archivando su versión anterior y pidiendo aprobación. */
export async function redoPaidScene(id: string, escenaPagoId: string) {
  await changeScene(id, escenaPagoId, {}, true);
  return generationSummary(await reconcileProduction(id));
}

export async function generationStatus(id: string) {
  let p = await reconcileProduction(id);
  const anchorClip1 = Boolean(p.director?.produccion?.anclarAlClip1);
  const clip1Id = p.director?.produccion?.mapa[0]?.clip;
  const clip1Scene = clip1Id ? p.escenas.find((x) => x.id === clip1Id) : undefined;
  const clip1Ready = clip1Scene?.estado === 'lista';

  // Lanza automáticamente escenas encadenadas (continuarDeEscena) o escenas 2…N ancladas al Clip 1 cuando su referencia ya está lista
  for (const s of p.escenas) {
    if (s.estado !== 'aprobada' || (s.spec.tipo !== 'toma_de_apoyo' && s.spec.tipo !== 'avatar')) continue;
    const waitingChain = Boolean(s.spec.continuarDeEscena);
    const waitingAnchor = anchorClip1 && Boolean(clip1Scene && s.id !== clip1Scene.id);
    if (!waitingChain && !waitingAnchor) continue;
    if (waitingAnchor && !clip1Ready) continue;
    if (waitingChain) {
      const prev = p.escenas.find((x) => x.id === s.spec.continuarDeEscena);
      if (prev?.estado !== 'lista') continue;
    }
    try {
      if (s.spec.tipo === 'avatar') await runAvatarScene(id, s.id);
      else await runBrollScene(id, s.id);
    } catch {
      // el error ya queda anotado en la escena
    }
  }
  p = await reconcileProduction(id);
  return generationSummary(p);
}

function clipOf(p: Production, sceneId: string): string {
  const s = p.escenas.find((x) => x.id === sceneId);
  const f = s && currentFiles(s, 'clip')[0];
  if (!s || s.estado !== 'lista' || !f || !fsSync.existsSync(f.ruta)) throw new ProductionError(`La escena ${sceneId} aún no tiene su clip listo.`, 409);
  return f.ruta;
}

function voiceOf(p: Production, sceneId: string): { ruta: string; tiempos?: string } {
  const s = p.escenas.find((x) => x.id === sceneId);
  const f = s && currentFiles(s, 'voz')[0];
  if (!s || s.estado !== 'lista' || !f) throw new ProductionError(`La voz ${sceneId} aún no está lista.`, 409);
  return { ruta: f.ruta, tiempos: currentFiles(s, 'tiempos')[0]?.ruta };
}

/** Pista de música de fondo subida por la persona (etiqueta de tipo 'musica' o audio suelto que no sea la locución). */
function resolveMusicPath(p: Production, d: DirectorState): string | undefined {
  const musicTags = new Set((d.etiquetas ?? []).filter((t) => t.tipo === 'musica').map((t) => t.id));
  const refs = (d.referencias ?? []).filter((r) => r.medio === 'audio' && r.id !== d.locucion?.refId);
  const chosen = refs.find((r) => r.etiquetaId && musicTags.has(r.etiquetaId)) ?? refs[0];
  if (!chosen) return undefined;
  const abs = refAbsPath(p.carpeta, chosen.archivo);
  return fsSync.existsSync(abs) ? abs : undefined;
}

const ClipQaSchema = z.object({
  ok: z.boolean().describe('true si el clip se ve realista y libre de síntomas evidentes de IA'),
  sintomas: z.array(z.string()).describe('Síntomas detectados de la lista de 9 síntomas (vacío si ok=true)'),
  resumen: z.string().describe('Breve diagnóstico en español (máx. 20 palabras)'),
});

/**
 * Audita un clip terminado extrayendo 3 fotogramas (inicio, mitad y cierre) con FFmpeg ($0)
 * y revisándolos con Gemini Visión contra los 9 síntomas de IA de Buzzy.
 */
export async function auditPaidClip(id: string, escenaPagoId: string) {
  const p = await reconcileProduction(id);
  const d = p.director;
  if (!d) throw new ProductionError('No es una producción del modo Director.', 400);
  const clipPath = clipOf(p, escenaPagoId);
  const dur = (await probeMedia(clipPath)).duration ?? 5;
  const times = [0.2, Math.max(0.5, dur / 2), Math.max(0.8, dur - 0.3)];
  const tmpDir = path.join(/*turbopackIgnore: true*/ p.carpeta, `.qa-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    const files: Array<{ data: Uint8Array; mediaType: string; filename: string }> = [];
    for (let i = 0; i < times.length; i++) {
      const frameOut = path.join(/*turbopackIgnore: true*/ tmpDir, `f-${i + 1}.jpg`);
      await runFfmpeg(['-y', '-hide_banner', '-ss', times[i].toFixed(2), '-i', clipPath, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '4', frameOut]);
      if (fsSync.existsSync(frameOut)) {
        files.push({
          data: new Uint8Array(await fs.readFile(frameOut)),
          mediaType: 'image/jpeg',
          filename: `frame-${i + 1}.jpg`,
        });
      }
    }
    if (!files.length) throw new ProductionError('No se pudieron extraer fotogramas del clip para revisarlo.', 500);

    const { object } = await orchestrateObject({
      tool: 'text-to-video',
      description: `Director · QA clip ${escenaPagoId}`,
      system: 'Eres supervisor de control de calidad visual para videos de marketing realistas. Evalúas fotogramas de un clip contra los 9 síntomas de video sintético.',
      prompt: `Revisa estos 3 fotogramas (inicio, mitad y final) del clip y comprueba si sufren alguno de estos 9 síntomas de IA:
${NINE_SYMPTOMS.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}
Devuelve ok=true si el clip luce natural y creíble, o lista únicamente los síntomas que sean claramente visibles y un resumen corto en español.`,
      files,
      schema: ClipQaSchema,
      temperature: 0.2,
      confidential: d.confidencial,
    });

    return {
      escenaPagoId,
      ok: object.ok,
      sintomas: object.sintomas.slice(0, 5),
      resumen: object.resumen.trim().slice(0, 140),
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Monta el video final (FFmpeg, $0). Voz en off: voz continua encima y cortes según los tiempos
 * de la voz. Voz nativa / avatar: cada clip con su propio audio, uno tras otro con fundido.
 * Si el proyecto tiene pista de música (@musica), la mezcla con auto-ducking bajo la voz.
 * Con "Claude · mi suscripción", el resultado pasa al editor para que Claude lo pula.
 */
export async function assembleFinal(id: string, opts: { pulirConClaude?: boolean } = {}) {
  const p = await reconcileProduction(id);
  const d = p.director;
  const gen = d?.produccion;
  if (!d || !gen) throw new ProductionError('Primero prepara y genera la producción.', 409);
  const escenas = (d.guion?.escenas ?? []).filter((s) => gen.mapa.some((m) => m.escenaId === s.id));
  const { width, height } = frameSize(p.formato);
  const version = (gen.final?.version ?? 0) + 1;
  const archivo = `final-v${version}.mp4`;
  const output = path.join(/*turbopackIgnore: true*/ p.carpeta, archivo);
  const musicPath = resolveMusicPath(p, d);
  const tmpDir = path.join(/*turbopackIgnore: true*/ p.carpeta, `.montaje-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    const clips = gen.mapa.map((m) => clipOf(p, m.clip));
    if (gen.modoVoz === 'voiceover' && gen.vozGeneral) {
      const voz = voiceOf(p, gen.vozGeneral);
      let alignment: Alignment | null = null;
      if (voz.tiempos) {
        try {
          const t = JSON.parse(await fs.readFile(voz.tiempos, 'utf8'));
          if (Array.isArray(t.characters)) alignment = { characters: t.characters, starts: t.starts, ends: t.ends };
        } catch {
          // sin tiempos: se reparte por longitud del texto
        }
      }
      const dur = (await probeMedia(voz.ruta)).duration ?? escenas.reduce((t, s) => t + s.duracionSeg, 0);
      let starts: number[];
      let total: number;
      if (escenas.every((s) => s.dialogo.trim())) {
        // Cada escena empieza donde empieza su frase en la voz
        ({ starts, total } = computeSceneStarts(
          escenas.map((s) => s.dialogo.trim()),
          alignment,
          dur
        ));
      } else {
        // Hay escenas sin diálogo: no tienen frase que buscar en la voz, así que los cortes siguen
        // las duraciones planeadas, ajustadas a lo que dura la voz de verdad
        const planned = escenas.reduce((t, s) => t + s.duracionSeg, 0) || 1;
        const k = dur / planned;
        starts = [];
        let t = 0;
        for (const s of escenas) {
          starts.push(Number(t.toFixed(3)));
          t += s.duracionSeg * k;
        }
        total = dur;
      }
      await stitchScenes({
        clips: clips.map((c) => ({ path: c })),
        starts,
        total,
        audioPath: voz.ruta,
        musicPath,
        output,
        width,
        height,
        crossfade: safeCrossfade(starts, total, 0.3),
      });
    } else {
      // Avatar: a cada toma de apoyo se le pone su locución antes de unir
      const withAudio: string[] = [];
      for (const [i, m] of gen.mapa.entries()) {
        if (!m.voz) {
          withAudio.push(clips[i]);
          continue;
        }
        const voz = voiceOf(p, m.voz);
        const out = path.join(/*turbopackIgnore: true*/ tmpDir, `escena-${i + 1}.mp4`);
        const vd = (await probeMedia(voz.ruta)).duration ?? 3;
        await runFfmpeg([
          '-y', '-hide_banner', '-i', clips[i], '-i', voz.ruta,
          '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${Math.ceil(vd)}[v]`,
          '-map', '[v]', '-map', '1:a', '-t', vd.toFixed(2), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out,
        ]);
        withAudio.push(out);
      }
      const probes = await Promise.all(withAudio.map((c) => probeMedia(c)));
      const fade = 0.3;
      const lens = probes.map((pr) => pr.duration ?? 4);
      const starts: number[] = [];
      let t = 0;
      for (const l of lens) {
        starts.push(t);
        t += l - fade;
      }
      await stitchScenes({
        clips: withAudio.map((c) => ({ path: c })),
        starts,
        lens,
        total: t + fade,
        clipHasAudio: probes.map((pr) => pr.hasAudio),
        musicPath,
        output,
        width,
        height,
        crossfade: fade,
      });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const duracionSeg = Math.round(((await probeMedia(output)).duration ?? 0) * 100) / 100;
  let edicionId: string | undefined;
  let edicion: Awaited<ReturnType<typeof sendToClaudeEditor>> = null;
  if (opts.pulirConClaude !== false) {
    edicion = await sendToClaudeEditor({
      videoPath: output,
      titulo: `${p.nombre} · Claude`,
      pedido: `Video de marketing generado con IA a partir de este guion (escenas unidas). Púlelo para redes a tu criterio: ritmo, subtítulos dinámicos, gancho al inicio, color y un cierre claro. No cambies el sentido de lo que se dice. Guion: ${escenas.map((s) => s.dialogo).filter(Boolean).join(' ')}`,
    });
    if (edicion && 'id' in edicion) edicionId = edicion.id;
  }
  const { production } = await updateProduction(id, (x) => {
    x.director!.produccion = { ...x.director!.produccion!, final: { archivo, duracionSeg, creado: new Date().toISOString(), version, ...(edicionId ? { edicionId } : {}) } };
  });
  return { final: production.director!.produccion!.final, carpeta: production.carpeta, edicionClaude: edicion };
}
