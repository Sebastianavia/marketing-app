import fs from 'fs/promises';
import path from 'path';
import { ffmpeg, probeVideo } from './media';
import { sfxSamples } from './sfx';
import { writeWav } from './synth';
import type { ResolvedDirection } from './direction';

/**
 * Estructura de retención (Fase 1 de la hoja de ruta del editor viral):
 *  - Barra de progreso y contador «PASO 2/5» para videos tipo lista (se dibujan en la composición).
 *  - Etapa final, sobre el video YA montado (así el resto del plan no se descuadra):
 *      · silencio dramático: fotograma congelado (con zoom lento opcional) + silencio total,
 *      · arranque en frío: el tramo más fuerte se repite al inicio como avance, con destello y «swish»,
 *      · bucle: la unión final → inicio sin chasquido (la música no se desvanece; ver audio.ts).
 * Los tiempos del plan son de la línea PRINCIPAL; el borrador final dura más (avance + pausas).
 */

const f3 = (n: number) => n.toFixed(3);

/** Barra que crece desde la primera marca hasta el final (drawbox con t). */
export function progressBarFilter(prog: NonNullable<ResolvedDirection['progreso']>, total: number, W: number, safeTop: number, color: string): string | null {
  if (prog.tipo === 'contador' || !prog.marcas.length) return null;
  const m0 = prog.marcas[0];
  const x = 60;
  const w = W - 120;
  const y = Math.max(24, safeTop - 34);
  const hx = color.replace('#', '0x');
  const p = `clip((t-${f3(m0)})/${f3(Math.max(0.5, total - m0))},0,1)`;
  // Pista tenue + relleno que avanza
  return [
    `drawbox=x=${x}:y=${y}:w=${w}:h=10:color=white@0.25:t=fill:enable='gte(t,${f3(m0)})'`,
    `drawbox=x=${x}:y=${y}:w='max(2,${w}*${p})':h=10:color=${hx}@0.95:t=fill:enable='gte(t,${f3(m0)})'`,
  ].join(',');
}

/** Contador «ETIQUETA n/N» como eventos ASS (estilo Hook), arriba a la derecha dentro de la zona segura. */
export function counterEvents(prog: NonNullable<ResolvedDirection['progreso']>, total: number, W: number, safeTop: number, safeRight: number, color: string): string[] {
  if (prog.tipo === 'barra') return [];
  const n = prog.marcas.length;
  const t = (sec: number) => {
    const cs = Math.max(0, Math.round(sec * 100));
    return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };
  const hex = color.replace('#', '');
  const assCol = `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
  const label = (prog.etiqueta ?? '').replace(/[{}\\]/g, '').toLocaleUpperCase('es');
  const x = W - Math.max(60, safeRight + 20);
  const y = Math.max(40, safeTop + 6);
  return prog.marcas.map((m, i) => {
    const end = i < n - 1 ? prog.marcas[i + 1] : total;
    // Entra con rebote cada vez que cambia el número
    const tags = `{\\an9\\pos(${x},${y})\\fs52\\bord4\\shad0\\3c&H000000&\\1c&HFFFFFF&\\fscx70\\fscy70\\t(0,120,\\fscx110\\fscy110)\\t(120,220,\\fscx100\\fscy100)}`;
    return `Dialogue: 2,${t(m)},${t(end)},Hook,,0,0,0,,${tags}${label ? `${label} ` : ''}{\\1c${assCol}}${i + 1}{\\1c&HFFFFFF&}/${n}`;
  });
}

export interface StructureResult {
  duracion: number;
  notas: string[];
  /** Parecido (0–1) entre el primer y el último fotograma, si se pidió bucle. */
  bucleParecido?: number;
}

/**
 * Aplica pausas, avance inicial y bucle sobre el borrador montado (`file`, dentro de `carpeta`).
 * Reescribe el archivo. Devuelve la duración nueva.
 */
export async function applyStructure(o: { carpeta: string; file: string; dir: ResolvedDirection; total: number; W: number; H: number; fps: number }): Promise<StructureResult> {
  const { carpeta, file, dir, total, W, H, fps } = o;
  const notas: string[] = [];
  const pausas = dir.pausas;
  const arr = dir.arranque;
  if (!pausas.length && !arr && !dir.bucle) return { duracion: total, notas };
  const f = (n: string) => path.join(/*turbopackIgnore: true*/ carpeta, n);

  const v: string[] = [];
  const a: string[] = [];
  const g: string[] = [];
  const fade = 0.008;
  const seg = (from: number, to: number, idx: number) => {
    g.push(`[0:v]trim=start=${f3(from)}:end=${f3(to)},setpts=PTS-STARTPTS,format=yuv420p[v${idx}]`);
    g.push(
      `[0:a]atrim=start=${f3(from)}:end=${f3(to)},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${f3(Math.max(0, to - from - fade))}:d=${fade}[a${idx}]`
    );
    v.push(`[v${idx}]`);
    a.push(`[a${idx}]`);
  };
  let idx = 0;
  let teaserLen = 0;
  if (arr) {
    seg(arr.desde, arr.hasta, idx++);
    teaserLen = arr.hasta - arr.desde;
    if (arr.transicion === 'flash') {
      // Destello en los últimos 0,15 s del avance
      const k = idx - 1;
      g[g.length - 2] = g[g.length - 2].replace(
        `,format=yuv420p[v${k}]`,
        `,eq=brightness='0.6*clip((t-${f3(teaserLen - 0.15)})/0.15,0,1)':eval=frame,format=yuv420p[v${k}]`
      );
    }
  }
  let cursor = 0;
  for (const pz of pausas) {
    if (pz.t <= cursor + 0.1) continue;
    seg(cursor, pz.t, idx++);
    // Fotograma congelado (con zoom lento hacia el centro si se pidió) + silencio total
    const frames = Math.max(2, Math.round(pz.duracion * fps));
    const zoom = pz.zoom
      ? `,scale=${W * 2}:${H * 2},zoompan=z='1+0.07*on/${frames}':x='iw/2-iw/zoom/2':y='ih*0.4-ih/zoom*0.4':d=1:s=${W}x${H}:fps=${fps}`
      : '';
    g.push(
      `[0:v]trim=start=${f3(Math.max(0, pz.t - 1 / fps))}:end=${f3(pz.t)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f3(pz.duracion)}${zoom},trim=duration=${f3(pz.duracion)},setsar=1,format=yuv420p[v${idx}]`
    );
    g.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(pz.duracion)}[a${idx}]`);
    v.push(`[v${idx}]`);
    a.push(`[a${idx}]`);
    idx++;
    cursor = pz.t;
  }
  seg(cursor, total, idx++);
  const n = v.length;
  g.push(`${v.map((x, i) => `${x}${a[i]}`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`);

  // Sonido del paso avance → video: «swish» que termina en la unión
  const inputs: string[] = ['-i', file];
  let audioOut = '[ac]';
  if (arr?.transicion === 'flash') {
    const sw = f('sfx-arranque.wav');
    await writeWav(sw, sfxSamples('swish'));
    inputs.push('-i', sw);
    const ms = Math.max(0, Math.round((teaserLen - 0.25) * 1000));
    g.push(`[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.6,adelay=${ms}|${ms}[sw]`);
    g.push(`[ac][sw]amix=inputs=2:duration=first:dropout_transition=0,volume=2[am]`);
    audioOut = '[am]';
  }
  if (dir.bucle) {
    // Unión final → inicio sin chasquido
    const dur = total + teaserLen + pausas.reduce((s, x) => s + x.duracion, 0);
    g.push(`${audioOut}afade=t=in:d=0.04,afade=t=out:st=${f3(Math.max(0, dur - 0.06))}:d=0.06[af]`);
    audioOut = '[af]';
  }

  const tmp = f('estructura-tmp.mp4');
  await fs.writeFile(f('filtros-estructura.txt'), g.join(';\n'), 'utf-8');
  await ffmpeg({
    cwd: carpeta,
    args: [
      '-y', '-hide_banner', ...inputs,
      '-filter_complex', g.join(';'),
      '-map', '[vc]', '-map', audioOut,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', tmp,
    ],
    timeoutMs: 15 * 60 * 1000,
  });
  await fs.rename(tmp, file);
  await fs.rm(f('sfx-arranque.wav'), { force: true }).catch(() => undefined);

  if (arr) notas.push(`Arranque en frío: avance de ${teaserLen.toFixed(1)} s al inicio.`);
  if (pausas.length) notas.push(`${pausas.length} silencio${pausas.length === 1 ? '' : 's'} dramático${pausas.length === 1 ? '' : 's'}.`);
  const info = await probeVideo(file).catch(() => null);
  const duracion = info?.duracion || total;

  let bucleParecido: number | undefined;
  if (dir.bucle) {
    bucleParecido = await frameSimilarity(file, duracion).catch(() => undefined);
    notas.push('Bucle: el final enlaza con el inicio.');
  }
  return { duracion, notas, bucleParecido };
}

/** SSIM entre el primer y el último fotograma (0–1): cuánto «encaja» el bucle a la vista. */
async function frameSimilarity(file: string, dur: number): Promise<number | undefined> {
  const out = await ffmpeg({
    args: [
      '-hide_banner', '-ss', '0.05', '-i', file, '-ss', f3(Math.max(0, dur - 0.08)), '-i', file,
      '-filter_complex', '[0:v]trim=end_frame=1,scale=270:-2[a];[1:v]trim=end_frame=1,scale=270:-2[b];[a][b]ssim',
      '-f', 'null', '-',
    ],
    timeoutMs: 60_000,
  });
  const m = /All:([\d.]+)/.exec(out);
  return m ? Number(m[1]) : undefined;
}
