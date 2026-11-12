import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import { formatSize, networkInfo, safeZone, type EditProfile } from '@/config/editor-looks';
import { errorMessage } from '@/lib/errors';
import { buildFinalAudio, measureLoudness, musicDir, type SfxEvent } from './audio';
import { applyStructure, counterEvents, progressBarFilter } from './structure';
import { cameraFilter, colorFilter, describeDirection, directedProfile, elementsFilter, faceCenter, resolveDirection } from './direction';
import { PersonUnavailable, ensurePersonTrack, faceSeries, fitSeries, personFaces, lightStats, matchLightFilter, personEffectsGraph, seriesExpr, stabilizePlate, targetSeries, type PersonTrack } from './person';
import { buildAss, buildBehindAss, defaultSubMargin } from './ass';
import { cardStyle, faceWindow, graphicsEvents, placeGraphics } from './graphics';
import { ffmpeg, filterScriptArgs, hasSubtitlesFilter, stageFonts } from './media';
import { envStatus } from './python-env';
import { AdvancedUnavailable, runFaces, runMatte, type FaceTrack } from './advanced';
import { keptIntervals, subtitleWords, totalDuration, type KeptInterval } from './timeline';
import { editFile } from './edit-store';
import type { EditProject, QualityCheck } from './types';

/**
 * Render del reel en etapas (cada una deja un archivo; las caras se reutilizan si no cambian los cortes):
 *  A. BASE: el original a 30 fps, partido en los tramos conservados (cortes exactos a fotograma), encuadrado
 *     al formato (llenando, sin franjas) + la voz limpia con fundidos de 12 ms → plate-<clave>.mp4 / voz-<clave>.wav
 *  B. RECORTE (opcional): mate de la persona con RobustVideoMatting → matte-<clave>.mp4
 *  C. COMPOSICIÓN: capa detrás (palabras gigantes) + persona encima, zoom por plano (alterno y/o suave),
 *     gráficos y subtítulos ASS → video-sin-audio.mp4
 *  D. SONIDO: efectos, música con ducking y máster a −14 LUFS → borrador-vN.mp4 + portada + control de calidad.
 */

const FPS = 30;

/** Ajusta los tramos a la rejilla de fotogramas para que audio y video midan lo mismo. */
export function snapToFrames(intervals: KeptInterval[]): KeptInterval[] {
  const snap = (t: number) => Math.round(t * FPS) / FPS;
  let out = 0;
  const res: KeptInterval[] = [];
  for (const iv of intervals) {
    const s = snap(iv.s);
    const e = snap(iv.e);
    if (e - s < 2 / FPS) continue;
    res.push({ s, e, out });
    out += e - s;
  }
  return res;
}

const fill = (W: number, H: number) => `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

export interface RenderResult {
  archivo: string;
  duracion: number;
  portada?: string;
  calidad: QualityCheck[];
  notas: string[];
}

/**
 * A. Video base: tramos conservados, encuadrados al formato, más la voz limpia. Se reutiliza si los
 * cortes, el formato y la limpieza de voz no cambian (plate-<clave>.mp4 / voz-<clave>.wav).
 */
export async function buildPlate(
  p: EditProject,
  perfil: EditProfile,
  intervals: KeptInterval[],
  onProgress?: (pct: number, etapa?: RenderStage, detalle?: string) => void
): Promise<{ key: string; plate: string; voz: string; total: number }> {
  const total = totalDuration(intervals);
  const { width: W, height: H } = formatSize(perfil.formato);
  const f = (name: string) => editFile(p, name);
  // ── A. Base (se reutiliza si los cortes, el formato y la limpieza de voz no cambian) ──
  const key = crypto
    .createHash('sha1')
    .update(JSON.stringify([intervals, perfil.formato, perfil.sonido.limpiarVoz, p.original.archivo]))
    .digest('hex')
    .slice(0, 10);
  const plate = `plate-${key}.mp4`;
  const voz = `voz-${key}.wav`;
  if (!fsSync.existsSync(f(plate)) || !fsSync.existsSync(f(voz))) {
    onProgress?.(1, 'base', 'Cortando y encuadrando');
    const n = intervals.length;
    const g: string[] = [];
    g.push(n > 1 ? `[0:v]fps=${FPS},split=${n}${intervals.map((_, i) => `[vs${i}]`).join('')}` : `[0:v]fps=${FPS}[vs0]`);
    intervals.forEach((iv, i) => {
      g.push(`[vs${i}]trim=start=${iv.s.toFixed(4)}:end=${iv.e.toFixed(4)},setpts=PTS-STARTPTS,${fill(W, H)},setsar=1,format=yuv420p[v${i}]`);
    });
    const fade = 0.012;
    if (p.original.tieneAudio) {
      g.push(n > 1 ? `[0:a]asplit=${n}${intervals.map((_, i) => `[as${i}]`).join('')}` : `[0:a]anull[as0]`);
      intervals.forEach((iv, i) => {
        const len = iv.e - iv.s;
        g.push(
          `[as${i}]atrim=start=${iv.s.toFixed(4)}:end=${iv.e.toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, len - fade).toFixed(4)}:d=${fade}[a${i}]`
        );
      });
    } else {
      intervals.forEach((iv, i) => {
        g.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(iv.e - iv.s).toFixed(4)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      });
    }
    g.push(`${intervals.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`);
    const outFormat = 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    // Voz limpia: graves fuera, menos ruido de fondo y un compresor suave (el volumen final lo pone el máster)
    const voiceChain = 'highpass=f=80,afftdn=nf=-30:nr=8,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=140:makeup=2';
    g.push(perfil.sonido.limpiarVoz && p.original.tieneAudio ? `[ac]${voiceChain},${outFormat}[aout]` : `[ac]${outFormat}[aout]`);
    // El grafo va en un archivo: con muchos cortes la línea de comandos de Windows se quedaría corta
    await fs.writeFile(f('filtros-base.txt'), g.join(';\n'), 'utf-8');
    await ffmpeg({
      cwd: p.carpeta,
      args: [
        '-y', '-hide_banner', '-i', p.original.archivo,
        ...(await filterScriptArgs('filtros-base.txt')),
        '-map', '[vc]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-r', String(FPS), plate,
        '-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', '48000', voz,
      ],
      totalSeconds: total,
      onProgress: (pct) => onProgress?.(Math.round(pct * 0.3), 'base', 'Cortando y encuadrando'),
    });
  }
  return { key, plate, voz, total };
}

/** Semilla estable por edición (la música generada no cambia entre versiones). */
function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type RenderStage = 'base' | 'recorte' | 'composicion' | 'sonido';

export async function renderEdit(
  p: EditProject,
  version: number,
  onProgress?: (pct: number, etapa?: RenderStage, detalle?: string) => void
): Promise<RenderResult> {
  // Con plan de dirección de Claude, el perfil efectivo es el del plan y no hay reglas mecánicas
  const perfil = p.direccion ? directedProfile(p.perfil, p.direccion) : p.perfil;
  const raw = keptIntervals(p.frases, perfil.ritmo, p.original.duracion);
  const intervals = snapToFrames(raw);
  if (!intervals.length) throw new Error('Con los cortes elegidos no queda nada del video. Vuelve a marcar alguna frase para conservar.');
  const total = totalDuration(intervals);
  const { width: W, height: H } = formatSize(perfil.formato);
  const notas: string[] = [];
  const calidad: QualityCheck[] = [];
  const f = (name: string) => editFile(p, name);
  const dir = p.direccion ? resolveDirection(p, p.direccion, intervals, total, await musicDir()) : null;
  if (p.direccion) notas.push(`Dirigido por Claude: ${describeDirection(p.direccion, p.graficos?.filter((g) => g.activo).length)}.`);
  // dirigir_edicion copia el texto del gancho a p.gancho: así, si la persona lo cambia en la app, manda su cambio
  const ganchoTexto = p.gancho;

  // Gráficos y subtítulos
  const placed = placeGraphics(p, intervals, total);
  const wantsBehind = perfil.graficos.textoDetras && placed.some((x) => x.g.tipo === 'detras');

  const { key: baseKey, plate: basePlate, voz } = await buildPlate(p, perfil, intervals, onProgress);
  onProgress?.(30, 'base');
  // Estabilización (plan de Claude): la base estabilizada pasa a ser la base de todo lo demás
  let key = baseKey;
  let plate = basePlate;
  if (dir?.estabilizar) {
    const est = `plate-${baseKey}e.mp4`;
    try {
      if (!fsSync.existsSync(f(est))) {
        onProgress?.(30, 'base', 'Estabilizando la toma');
        const how = await stabilizePlate(p.carpeta, basePlate, est, W, H);
        notas.push(how === 'vidstab' ? 'Toma estabilizada (vidstab, dos pasadas).' : 'Toma estabilizada (deshake; para más calidad instala FFmpeg «full» con vidstab).');
      }
      key = `${baseKey}e`;
      plate = est;
    } catch (err) {
      await fs.rm(f(est), { force: true }).catch(() => undefined);
      calidad.push({ ok: false, texto: `No se pudo estabilizar (${errorMessage(err)}): va la toma original` });
    }
  }

  // ── B. Recorte de la persona (solo si hay palabras detrás y está instalado) ──
  let matte: string | null = null;
  if (wantsBehind) {
    const status = await envStatus();
    const prueba = process.env.LULO_MATTE_PRUEBA === '1';
    if (!status.recorteListo && !prueba) {
      calidad.push({ ok: null, texto: 'Palabras gigantes DELANTE de ti: para ponerlas detrás instala el recorte en Edición → Herramientas' });
    } else {
      const m = `matte-${key}.mp4`;
      try {
        if (!fsSync.existsSync(f(m))) {
          const frames = Math.round(total * FPS);
          onProgress?.(31, 'recorte', 'Recortando tu silueta');
          const r = await runMatte({
            src: f(plate),
            out: f(m),
            w: W,
            h: H,
            frames,
            prueba,
            onProgress: (done, tot, fps) => {
              const left = fps > 0 ? Math.max(0, (tot - done) / fps) : 0;
              onProgress?.(31 + Math.round((done / Math.max(1, tot)) * 34), 'recorte', `Recortando tu silueta · ${done}/${tot} · quedan ~${Math.ceil(left / 60)} min`);
            },
          });
          notas.push(`Recorte con ${r.dispositivo}.`);
        }
        matte = m;
      } catch (err) {
        await fs.rm(f(m), { force: true }).catch(() => undefined);
        const msg = err instanceof AdvancedUnavailable ? err.message : `El recorte falló (${errorMessage(err)})`;
        calidad.push({ ok: false, texto: `${msg}. Las palabras gigantes van delante.` });
      }
    }
  }
  // ── Dónde está la cara (para que gráficos y subtítulos no la tapen) ──
  const r = perfil.ritmo;
  const factor = 1 + Math.max(0, Math.min(25, r.zoomPct)) / 100;
  const smoothAmount = Math.min(0.06, (r.zoomPct / 100) * 0.5);
  const zoomMax = dir
    ? Math.max(1, ...dir.camara.map((c) => Math.max(c.zoom, c.zoomFinal ?? 1)))
    : (r.zoomEnCortes ? factor : 1) * (r.zoomSuave ? 1 + smoothAmount : 1);
  const hookOn = perfil.gancho.activo && ganchoTexto.trim().length > 0;
  let faces: FaceTrack | null = null;
  if (placed.length || perfil.subtitulos.activo || (dir && dir.camara.length)) {
    const cf = `caras-${key}.json`;
    try {
      if (fsSync.existsSync(f(cf))) faces = JSON.parse(await fs.readFile(f(cf), 'utf-8')) as FaceTrack;
      else {
        onProgress?.(65, 'composicion', 'Buscando tu cara');
        faces = await runFaces({ src: f(plate), out: f(cf), w: W, h: H });
      }
      if (!faces && placed.length) {
        calidad.push({ ok: null, texto: 'Instala el detector de caras en Edición → Herramientas para que los gráficos se coloquen siempre debajo de tu barbilla' });
      }
    } catch (err) {
      faces = null;
      calidad.push({ ok: null, texto: `No se pudo detectar tu cara (${errorMessage(err)}): los gráficos van en su posición normal` });
    }
  }
  // ── Pista de persona (MediaPipe): reencuadre, seguimiento, fondo, clon y persona delante ──
  let person: PersonTrack | null = null;
  let personMask: string | null = null;
  const needPerson =
    !!dir &&
    (dir.persona.length > 0 ||
      dir.elementos.some((e) => e.seguir || e.detrasDePersona) ||
      (dir.camaraSigueCara && dir.camara.some((c) => c.zoom > 1.02 || (c.zoomFinal ?? 1) > 1.02)));
  if (needPerson) {
    try {
      onProgress?.(66, 'composicion', 'Siguiendo a la persona');
      const r = await ensurePersonTrack({
        carpeta: p.carpeta,
        plate,
        key,
        W,
        H,
        frames: Math.round(total * FPS),
        onProgress: (done, tot) => onProgress?.(66, 'composicion', `Siguiendo a la persona · ${done}/${tot}`),
      });
      person = r.track;
      personMask = r.mask;
      if (r.nueva) notas.push('Pista de persona calculada (cara, manos, pose y máscara).');
    } catch (err) {
      const msg = err instanceof PersonUnavailable ? err.message : errorMessage(err);
      const lost = [dir!.persona.length ? 'efectos de fondo y clon' : '', dir!.elementos.some((e) => e.seguir) ? 'elementos que siguen' : '', dir!.elementos.some((e) => e.detrasDePersona) ? 'persona delante de elementos' : ''].filter(Boolean);
      calidad.push({ ok: lost.length ? false : null, texto: `Sin pista de persona (${msg})${lost.length ? `: sin ${lost.join(', ')}` : ''}. Instala el kit de herramientas de Claude en Edición → Herramientas.` });
    }
  }
  // Sin detector de caras (OpenCV) pero con pista de persona: las caras salen de ella
  if (!faces && person) faces = personFaces(person);
  onProgress?.(66, 'composicion', 'Gráficos, zoom y subtítulos');

  // ── C. Composición ──
  const gfx = graphicsEvents(perfil, placed, !!matte, {
    track: faces,
    zoomMax,
    hook: hookOn ? [0, perfil.gancho.duracionSeg] : undefined,
  });
  for (const a of gfx.avisos) calidad.push({ ok: a.includes('no cabían') ? false : null, texto: a });

  // Subtítulos abajo: si tu barbilla (con el zoom) llega a la línea de subtítulos, bajan hasta el límite de la zona segura
  let subMargin: number | undefined;
  const whole = faceWindow(faces, 0, total);
  if (whole && perfil.subtitulos.activo && perfil.subtitulos.posicion === 'abajo') {
    const chin = (whole.chin * H) * zoomMax - H * (zoomMax - 1) * 0.35;
    const lineTop = H - defaultSubMargin(perfil) - perfil.subtitulos.tamano * 1.3;
    if (chin > lineTop - 10) {
      subMargin = safeZone(perfil.red, perfil.formato).bottom + 30;
      calidad.push({ ok: null, texto: 'Estás cerca de la cámara: los subtítulos bajaron para no tapar tu barbilla' });
    }
  }
  const style = cardStyle(perfil);
  // Progreso de una lista (barra y contador), con el acento de la paleta
  const progressColor = dir?.progreso?.color ?? perfil.subtitulos.colorResaltado;
  const sz0 = safeZone(perfil.red, perfil.formato);
  const progressCounter = dir?.progreso ? counterEvents(dir.progreso, total, W, sz0.top, sz0.right, progressColor) : [];
  const words = subtitleWords(p.frases, intervals);
  const subs = buildAss({
    perfil,
    words,
    gancho: ganchoTexto,
    resaltar: p.resaltar,
    claves: dir?.palabrasClave,
    centrar: dir?.divididas,
    sombra: dir?.sombra,
    duracionFinal: total,
    graficos: [...gfx.front, ...progressCounter],
    // Elementos que piden esconder los subtítulos (texto kinético, capítulos)
    ocultar: [...gfx.hide, ...(dir?.elementos.filter((e) => e.ocultarSubtitulos).map((e) => [e.desde, e.hasta] as [number, number]) ?? [])],
    cardStyle: style,
    marginV: subMargin,
  });
  await fs.writeFile(f('subtitulos.ass'), subs.ass, 'utf-8');
  const burn = (perfil.subtitulos.activo && words.length > 0) || hookOn || gfx.front.length > 0 || progressCounter.length > 0 || Boolean(perfil.firma?.activo && perfil.firma.texto.trim());
  const behindOn = !!matte && gfx.behind.length > 0;
  if (behindOn) await fs.writeFile(f('detras.ass'), buildBehindAss(perfil, style, gfx.behind), 'utf-8');
  if ((burn || behindOn) && !(await hasSubtitlesFilter())) {
    throw new Error('Tu FFmpeg no trae el filtro de subtítulos (libass). Instala la versión "full" de FFmpeg (gyan.dev) y reinicia la app.');
  }
  const fonts = burn || behindOn ? await stageFonts(p.carpeta) : null;
  const fontsOpt = fonts ? `:fontsdir=${fonts}` : '';

  const c: string[] = [];
  if (behindOn) {
    c.push(`color=c=black@0.0:s=${W}x${H}:r=${FPS}:d=${total.toFixed(3)},format=rgba,subtitles=detras.ass${fontsOpt}:alpha=1[beh]`);
    c.push(`[0:v]split[p1][p2]`);
    c.push(`[p1][beh]overlay=format=auto:shortest=1[pb]`);
    c.push(`[1:v]format=gray,scale=${W}:${H}[m]`);
    c.push(`[p2][m]alphamerge[fg]`);
    c.push(`[pb][fg]overlay=format=auto,format=yuv420p[comp]`);
  } else {
    c.push(`[0:v]format=yuv420p[comp]`);
  }

  // Zoom por plano: alterno en los cortes y/o acercamiento suave continuo
  // Efectos de sonido: cada tipo se puede apagar en el perfil (Sonido)
  const sfx = perfil.sonido;
  const eventos: SfxEvent[] = hookOn && sfx.efectosGancho !== false ? [{ tipo: 'impacto', t: 0 }] : [];
  let nextInput = matte ? 2 : 1;
  const elementInputs: string[] = [];
  if (dir) {
    // Plan de Claude: luz → persona (fondo, clon) → elementos «en la escena» → cámara → color →
    // imágenes/videos → transiciones (todo con sus tiempos)
    let scene = 'comp';
    if (dir.igualarLuz) {
      const tramos = intervals.map((iv) => [iv.out, iv.out + (iv.e - iv.s)] as [number, number]);
      const lm = matchLightFilter(await lightStats(p.carpeta, plate, tramos).catch(() => []));
      if (lm.filtro) {
        c.push(`[${scene}]${lm.filtro}[lit]`);
        scene = 'lit';
        notas.push(`Luz y color igualados en ${lm.ajustados} tramo${lm.ajustados === 1 ? '' : 's'}.`);
      } else notas.push('Luz pareja: no hizo falta igualar.');
    }
    // Elementos que siguen a la persona o quedan detrás de ella: van ANTES de la cámara (son parte de la escena)
    const inScene = (e: (typeof dir.elementos)[number]) => !!person && (!!e.seguir || !!e.detrasDePersona);
    const preEls = dir.elementos.filter(inScene).map((e) => {
      if (!e.seguir || !person) return e;
      const s = targetSeries(person, e.seguir);
      if (!s) {
        calidad.push({ ok: null, texto: `No se ve ${e.seguir.replace('_', ' ')} en ${e.desde.toFixed(1)}–${e.hasta.toFixed(1)} s: el elemento queda fijo` });
        return e;
      }
      const ex = seriesExpr(fitSeries(s.x, e.desde, e.hasta, 40), 't');
      const ey = seriesExpr(fitSeries(s.y, e.desde, e.hasta, 40), 't');
      const dx = e.seguirDx ?? 0;
      const dy = e.seguirDy ?? (e.seguir === 'cara' ? -0.17 : -0.07);
      if (e.modo === 'capa') {
        // La capa es de pantalla completa: su punto «ancla» se pega al objetivo (+ desplazamiento)
        const an = e.seguirAncla ?? { x: 0.5, y: 0.5 };
        return { ...e, pos: { x: `${W}*(${ex}+${dx.toFixed(4)}-${an.x.toFixed(4)})`, y: `${H}*(${ey}+${dy.toFixed(4)}-${an.y.toFixed(4)})` } };
      }
      return { ...e, pos: { x: `${W}*(${ex}+${dx.toFixed(4)})-overlay_w/2`, y: `${H}*(${ey}+${dy.toFixed(4)})-overlay_h/2` } };
    });
    const postEls = dir.elementos.filter((e) => !inScene(e));
    if (person && personMask) {
      const pfx = personEffectsGraph({ W, H, fps: FPS, total, plateIdx: nextInput, maskIdx: nextInput + 1, firstExtraInput: nextInput + 2, efectos: dir.persona });
      elementInputs.push('-i', plate, '-i', personMask, ...pfx.inputs);
      nextInput += 2 + pfx.inputs.filter((x) => x === '-i').length;
      c.push(...pfx.build(scene, 'pfx'));
      if (dir.persona.length) notas.push(`${dir.persona.length} efecto${dir.persona.length === 1 ? '' : 's'} con la persona (${[...new Set(dir.persona.map((x) => x.efecto.replace('_', ' ')))].join(', ')}).`);
      const pre = elementsFilter(preEls, nextInput, 'pfx', 'pre', perfil, FPS, faceCenter(faces).y);
      c.push(...pre.graph);
      elementInputs.push(...pre.inputs);
      nextInput += pre.inputs.filter((x) => x === '-i').length;
      c.push(...pfx.front('pre', 'scn', preEls.filter((e) => e.detrasDePersona).map((e) => [e.desde, e.hasta] as [number, number])));
      scene = 'scn';
      if (preEls.some((e) => e.seguir)) notas.push(`${preEls.filter((e) => e.seguir).length} elemento(s) siguen a la persona.`);
    }
    // Reencuadre: la cámara sigue la cara en cada momento (suavizado)
    const fs1 = dir.camaraSigueCara ? faceSeries(person, faces) : null;
    // Solo importa donde hay zoom (con zoom 1 se ve todo el cuadro)
    const zoomed = dir.camara.filter((c) => c.zoom > 1.02 || (c.zoomFinal ?? 1) > 1.02);
    const za = zoomed.length ? Math.min(...zoomed.map((c) => c.desde)) : 0;
    const zb = zoomed.length ? Math.max(...zoomed.map((c) => c.hasta)) : 0;
    const follow = fs1 && zoomed.length ? { x: seriesExpr(fitSeries(fs1.x, za, zb, 60), `(on/${FPS})`), y: seriesExpr(fitSeries(fs1.y, za, zb, 60), `(on/${FPS})`) } : null;
    const cam = cameraFilter(dir.camara, W, H, FPS, faceCenter(faces), follow);
    if (follow && cam) notas.push('La cámara sigue tu cara.');
    const col = colorFilter(dir.color, dir.transiciones);
    // El color es de la toma (las capturas y fotos quedan con su color); los destellos y glitch, de todo
    c.push(`[${scene}]${[cam, col.grade].filter(Boolean).join(',') || 'null'}[cam]`);
    const els = elementsFilter(postEls, nextInput, 'cam', 'elx', perfil, FPS, faceCenter(faces).y);
    c.push(...els.graph);
    c.push(`[elx]${col.fx ?? 'null'}[zc]`);
    elementInputs.push(...els.inputs);
  } else if (r.zoomEnCortes || r.zoomSuave) {
    const n = intervals.length;
    c.push(n > 1 ? `[comp]split=${n}${intervals.map((_, i) => `[c${i}]`).join('')}` : `[comp]null[c0]`);
    let zoomed = false;
    let lastWhoosh = -10;
    intervals.forEach((iv, i) => {
      const len = iv.e - iv.s;
      if (r.zoomEnCortes && i > 0 && len >= 0.6) {
        zoomed = !zoomed;
        // Whoosh 30 ms antes del cambio de plano, como mucho uno cada 2,5 s
        if (sfx.efectosCortes !== false && iv.out - lastWhoosh >= 2.5 && iv.out > 1) {
          eventos.push({ tipo: 'whoosh', t: Math.max(0, iv.out - 0.03) });
          lastWhoosh = iv.out;
        }
      }
      const base = r.zoomEnCortes && zoomed ? factor : 1;
      const frames = Math.max(1, Math.round(len * FPS));
      let chain: string;
      if (r.zoomSuave && len >= 1.2) {
        // Se escala al doble antes de zoompan: así el acercamiento lento no tiembla
        chain =
          `scale=${W * 2}:${H * 2},zoompan=z='${base.toFixed(4)}+${smoothAmount.toFixed(4)}*on/${frames}':` +
          `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.35':d=1:s=${W}x${H}:fps=${FPS},setsar=1`;
      } else if (base > 1.001) {
        const zw = Math.round((W * base) / 2) * 2;
        const zh = Math.round((H * base) / 2) * 2;
        // Con zoom se recorta un poco más arriba del centro: la cara suele estar en el tercio superior
        chain = `scale=${zw}:${zh},crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.35,setsar=1`;
      } else {
        chain = 'null';
      }
      c.push(`[c${i}]trim=start=${iv.out.toFixed(4)}:end=${(iv.out + len).toFixed(4)},setpts=PTS-STARTPTS,${chain}[z${i}]`);
    });
    c.push(`${intervals.map((_, i) => `[z${i}]`).join('')}concat=n=${n}:v=1:a=0[zc]`);
  } else {
    c.push(`[comp]null[zc]`);
  }
  // Barra de progreso (listas) antes de los subtítulos
  const bar = dir?.progreso ? progressBarFilter(dir.progreso, total, W, sz0.top, progressColor) : null;
  if (bar) {
    c.push(`[zc]${bar}[zb]`);
    c.push(burn ? `[zb]subtitles=subtitulos.ass${fontsOpt}[vout]` : `[zb]null[vout]`);
  } else {
    c.push(burn ? `[zc]subtitles=subtitulos.ass${fontsOpt}[vout]` : `[zc]null[vout]`);
  }

  // Efectos en los gráficos: whoosh al entrar una tarjeta, golpe en las palabras gigantes
  if (sfx.efectosGraficos !== false) for (const x of placed) eventos.push({ tipo: x.g.tipo === 'detras' ? 'impacto' : 'whoosh', t: Math.max(0, x.start - 0.03) });
  eventos.sort((a, b) => a.t - b.t);
  const spaced = eventos.filter((e, i) => i === 0 || e.t - eventos[i - 1].t >= 0.8);

  const videoOnly = 'video-sin-audio.mp4';
  await fs.writeFile(f('filtros.txt'), c.join(';\n'), 'utf-8');
  await ffmpeg({
    cwd: p.carpeta,
    args: [
      '-y', '-hide_banner', '-i', plate,
      ...(matte ? ['-i', matte] : []),
      ...elementInputs,
      ...(await filterScriptArgs('filtros.txt')),
      '-map', '[vout]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(FPS), '-pix_fmt', 'yuv420p', videoOnly,
    ],
    totalSeconds: total,
    onProgress: (pct) => onProgress?.(65 + Math.round(pct * 0.25), 'composicion', 'Gráficos, zoom y subtítulos'),
  });

  // ── D. Sonido ──
  onProgress?.(91, 'sonido', 'Efectos, música y volumen');
  const audio = await buildFinalAudio({ carpeta: p.carpeta, voz: f(voz), duracion: total, perfil, eventos: dir ? [] : spaced, seed: seedFrom(p.id), direccion: dir, words });
  notas.push(...audio.notas);
  const out = `borrador-v${version}.mp4`;
  await ffmpeg({
    cwd: p.carpeta,
    args: ['-y', '-hide_banner', '-i', videoOnly, '-i', audio.master, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', out],
    timeoutMs: 10 * 60 * 1000,
  });

  // ── E. Estructura de retención: silencios dramáticos, arranque en frío y bucle (sobre el video montado) ──
  let finalDur = total;
  if (dir && (dir.pausas.length || dir.arranque || dir.bucle)) {
    onProgress?.(97, 'sonido', 'Estructura: avance, pausas y bucle');
    const st = await applyStructure({ carpeta: p.carpeta, file: f(out), dir, total, W, H, fps: FPS });
    finalDur = st.duracion;
    notas.push(...st.notas);
    if (st.bucleParecido !== undefined) {
      calidad.push({
        ok: st.bucleParecido >= 0.55,
        texto: `Bucle: el último plano se parece al primero en un ${Math.round(st.bucleParecido * 100)} %${st.bucleParecido >= 0.55 ? '' : ' (iguala encuadre y zoom del final con los del inicio)'}`,
      });
    }
  }

  // Portada: un fotograma con el gancho en pantalla (o el primer segundo)
  const portada = `portada-v${version}.jpg`;
  const at = hookOn ? Math.min(perfil.gancho.duracionSeg * 0.6, Math.max(0.1, total - 0.1)) : Math.min(1, total / 2);
  let portadaOk = true;
  try {
    await ffmpeg({ cwd: p.carpeta, args: ['-y', '-hide_banner', '-ss', at.toFixed(2), '-i', out, '-frames:v', '1', '-q:v', '3', portada], timeoutMs: 60_000 });
  } catch {
    portadaOk = false;
  }

  // Control de calidad
  const loud = await measureLoudness(f(out));
  if (perfil.ritmo.normalizarAudio) {
    calidad.unshift(
      { ok: Math.abs(loud.lufs + 14) <= 1, texto: `Volumen ${loud.lufs.toFixed(1)} LUFS (objetivo −14)` },
      { ok: loud.tp <= -1, texto: `Pico real ${loud.tp.toFixed(1)} dB (debe quedar por debajo de −1)` }
    );
  } else {
    calidad.unshift({ ok: null, texto: `Volumen ${loud.lufs.toFixed(1)} LUFS (sin igualar: lo tienes apagado en el perfil)` });
  }
  if (perfil.subtitulos.activo && subs.lineas > 0) {
    calidad.push({
      ok: subs.cortas === 0,
      texto:
        subs.cortas === 0
          ? `${subs.lineas} líneas de subtítulo, todas de 0,4 s o más`
          : `${subs.cortas} de ${subs.lineas} subtítulos duran menos de 0,4 s (hablas muy rápido en esos tramos)`,
    });
  }
  const red = networkInfo(perfil.red);
  const sz = safeZone(perfil.red, perfil.formato);
  if (perfil.subtitulos.activo || hookOn || placed.length) {
    calidad.push({ ok: true, texto: `Textos y gráficos fuera de la zona de botones de ${red.label} (${sz.top} px arriba, ${sz.bottom} px abajo, ${sz.right} px a la derecha)` });
  }
  if (placed.length) {
    calidad.push({ ok: true, texto: `${placed.length} gráfico${placed.length === 1 ? '' : 's'}, cada uno en su palabra${faces ? ', colocados según dónde está tu cara' : ''}${behindOn ? ' · palabras gigantes detrás de ti' : ''}` });
  }
  calidad.push({ ok: finalDur <= red.maxSeg, texto: `Duración ${finalDur.toFixed(1)} s (${red.label} admite hasta ${Math.round(red.maxSeg / 60)} min)` });
  calidad.push({ ok: null, texto: 'Míralo en el móvil con y sin sonido, y comprueba que nada te tape la cara (también con el zoom)' });

  // Limpieza: intermedios de esta versión y bases de cortes anteriores (la actual se guarda para volver a renderizar rápido)
  for (const tmp of [videoOnly, 'mezcla.wav', 'master.wav']) await fs.rm(f(tmp), { force: true }).catch(() => undefined);
  try {
    for (const name of await fs.readdir(p.carpeta)) {
      // Se guardan la base actual (y su versión estabilizada) y la pista de persona de la base en uso
      if (/^(plate|voz|matte|caras|persona|persona-mask)-[0-9a-f]{10}e?\.(mp4|wav|json)$/.test(name) && !name.includes(baseKey)) await fs.rm(f(name), { force: true });
    }
  } catch {
    // no pasa nada si no se puede limpiar
  }

  return { archivo: out, duracion: finalDur, portada: portadaOk ? portada : undefined, calidad, notas };
}
