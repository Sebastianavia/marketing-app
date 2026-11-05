import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
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
import { proposeScenes, runAvatarScene, runBrollScene, runVoiceScene } from '@/lib/director/production';
import { reconcileProduction } from '@/lib/director/production-jobs';
import { composeVideoPrompt } from './prompts';
import type { DirectorGeneration, DirectorState } from './types';

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
    const clip = add({
      tipo: 'toma_de_apoyo',
      titulo: `Escena ${s.orden} · ${s.queSeVe.slice(0, 60)}`,
      prompt: composeVideoPrompt(s, d),
      duracionSeg: s.clipSeg ?? s.duracionSeg,
      modelo: a.modeloBroll,
      conAudio: a.modoVoz === 'native',
    });
    // Avatar: las tomas de apoyo llevan su propia locución
    const voz = a.modoVoz === 'avatar' && s.dialogo.trim() ? add({ tipo: 'voz', titulo: `Escena ${s.orden} · voz`, texto: s.dialogo, vozId, modeloVoz: DEFAULT_ELEVEN_MODEL }) : undefined;
    mapa.push({ escenaId: s.id, clip, ...(voz ? { voz } : {}) });
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

/** Lanza lo aprobado: las voces primero (las necesita el avatar) y luego los clips. */
export async function runGeneration(id: string) {
  let p = await reconcileProduction(id);
  const lanzadas: string[] = [];
  const errores: string[] = [];
  const ready = (s: ProductionScene) => s.estado === 'aprobada' || (s.estado === 'fallida' && !s.falloConCobro && !s.reintentoUsado && s.aprobadaUSD !== null);
  const order = [...p.escenas].sort((a, b) => Number(b.spec.tipo === 'voz') - Number(a.spec.tipo === 'voz'));
  for (const s of order) {
    if (!ready(s)) continue;
    try {
      if (s.spec.tipo === 'voz') await runVoiceScene(id, s.id);
      else if (s.spec.tipo === 'avatar') await runAvatarScene(id, s.id);
      else if (s.spec.tipo === 'toma_de_apoyo') await runBrollScene(id, s.id);
      else continue;
      lanzadas.push(s.id);
    } catch (err) {
      errores.push(`${s.id}: ${err instanceof Error ? err.message : 'error'}`);
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

export async function generationStatus(id: string) {
  return generationSummary(await reconcileProduction(id));
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

/**
 * Monta el video final (FFmpeg, $0). Voz en off: voz continua encima y cortes según los tiempos
 * de la voz. Voz nativa / avatar: cada clip con su propio audio, uno tras otro con fundido.
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
      await stitchScenes({ clips: clips.map((c) => ({ path: c })), starts, total, audioPath: voz.ruta, output, width, height, crossfade: safeCrossfade(starts, total, 0.3) });
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
