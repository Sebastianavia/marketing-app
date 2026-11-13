import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { ffmpeg } from './media';
import { findPython, pythonScript, runProcess } from './python-env';
import { pythonPackageDirs } from './claude-toolbox';
import type { FaceTrack } from './advanced';

/**
 * Pista de persona (Fase 4 · imagen y cámara): una pasada de MediaPipe sobre el video base
 * (`python/lulo_person.py`) que deja en la carpeta de la edición `persona-<clave>.json` (cara, manos
 * y pose a 10 fps) y `persona-mask-<clave>.mp4` (máscara de la persona en cada fotograma, 360 px de
 * ancho). De ella salen: reencuadre que sigue la cara, elementos que siguen una mano, fondo
 * desenfocado o cambiado, clon, persona delante de un elemento y los «movimientos» del cuerpo.
 * Todos los tiempos son del video base = línea principal (los de palabras_borrador).
 */

export interface PersonFrame {
  t: number;
  cara?: [number, number, number, number];
  manoIzq?: [number, number];
  manoDer?: [number, number];
  pose?: Record<'nariz' | 'hombroIzq' | 'hombroDer' | 'munecaIzq' | 'munecaDer', [number, number, number]>;
}
export interface PersonTrack {
  fps: number;
  frames: PersonFrame[];
}

export class PersonUnavailable extends Error {}

const MASK_W = 360;

export const personFiles = (key: string) => ({ json: `persona-${key}.json`, mask: `persona-mask-${key}.mp4` });

/** Calcula (o reutiliza) la pista de persona del video base `plate` (dentro de `carpeta`). */
export async function ensurePersonTrack(o: {
  carpeta: string;
  plate: string;
  key: string;
  W: number;
  H: number;
  frames: number;
  onProgress?: (done: number, total: number, fps: number) => void;
}): Promise<{ track: PersonTrack; mask: string; nueva: boolean }> {
  const files = personFiles(o.key);
  const json = path.join(/*turbopackIgnore: true*/ o.carpeta, files.json);
  const mask = path.join(/*turbopackIgnore: true*/ o.carpeta, files.mask);
  if (fsSync.existsSync(json) && fsSync.existsSync(mask)) {
    return { track: JSON.parse(await fs.readFile(json, 'utf-8')) as PersonTrack, mask: files.mask, nueva: false };
  }
  const py = await findPython();
  if (!py) throw new PersonUnavailable('No hay Python en este PC: instálalo en Edición → Herramientas.');
  const mh = Math.round((o.H * MASK_W) / o.W / 2) * 2;
  const env = { ...process.env, PYTHONPATH: [...pythonPackageDirs(), process.env.PYTHONPATH ?? ''].filter(Boolean).join(path.delimiter) };
  let error = '';
  const r = await runProcess(
    py.cmd,
    [...py.args, pythonScript('lulo_person.py'), '--ffmpeg', resolveFfmpegPath(), '--src', path.join(/*turbopackIgnore: true*/ o.carpeta, o.plate), '--mask', `${mask}.tmp.mp4`, '--json', `${json}.tmp`, '--w', String(MASK_W), '--h', String(mh), '--frames', String(o.frames)],
    {
      timeoutMs: 60 * 60_000,
      env,
      onLine: (l) => {
        const m = /^PROGRESO (\d+) (\d+) ([\d.]+)/.exec(l);
        if (m) o.onProgress?.(Number(m[1]), Number(m[2]), Number(m[3]));
        const e = /^ERROR (.+)/.exec(l);
        if (e) error = e[1];
      },
    }
  );
  if (r.code !== 0 || !fsSync.existsSync(`${json}.tmp`)) {
    await fs.rm(`${mask}.tmp.mp4`, { force: true }).catch(() => undefined);
    throw new PersonUnavailable(error || `La pista de persona falló (${r.out.slice(-300)})`);
  }
  await fs.rename(`${mask}.tmp.mp4`, mask);
  await fs.rename(`${json}.tmp`, json);
  return { track: JSON.parse(await fs.readFile(json, 'utf-8')) as PersonTrack, mask: files.mask, nueva: true };
}

// ── Series y expresiones de FFmpeg ───────────────────────────────────────────

export type Series = Array<[number, number]>;

/** Rellena huecos por interpolación y suaviza con media móvil de `win` segundos. */
function clean(points: Array<[number, number | null]>, win: number): Series {
  const known = points.filter((p): p is [number, number] => p[1] !== null);
  if (!known.length) return [];
  const filled: Series = points.map(([t, v]) => {
    if (v !== null) return [t, v];
    const prev = [...known].reverse().find((k) => k[0] < t);
    const next = known.find((k) => k[0] > t);
    if (prev && next) return [t, prev[1] + ((next[1] - prev[1]) * (t - prev[0])) / (next[0] - prev[0])];
    return [t, (prev ?? next)![1]];
  });
  const half = win / 2;
  return filled.map(([t]) => {
    const w = filled.filter(([u]) => Math.abs(u - t) <= half);
    return [t, w.reduce((s, x) => s + x[1], 0) / w.length];
  });
}

/** Simplifica la serie (Ramer–Douglas–Peucker) para que la expresión sea corta. */
function simplify(s: Series, eps: number): Series {
  if (s.length < 3) return s;
  const [a, b] = [s[0], s[s.length - 1]];
  let idx = -1;
  let max = 0;
  for (let i = 1; i < s.length - 1; i++) {
    const v = a[1] + ((b[1] - a[1]) * (s[i][0] - a[0])) / Math.max(1e-6, b[0] - a[0]);
    const d = Math.abs(s[i][1] - v);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...simplify(s.slice(0, idx + 1), eps).slice(0, -1), ...simplify(s.slice(idx), eps)];
}

const f4 = (n: number) => n.toFixed(4);

/** Recorta la serie a [a, b] y la simplifica hasta tener como mucho `max` puntos (FFmpeg no admite expresiones enormes). */
export function fitSeries(s: Series, a: number, b: number, max = 48): Series {
  const w = s.filter(([t]) => t >= a - 0.3 && t <= b + 0.3);
  if (w.length <= 2) return w.length ? w : s.length ? [[a, valueAt(s, a)], [b, valueAt(s, b)]] : [];
  let eps = 0.004;
  let out = simplify(w, eps);
  while (out.length > max && eps < 0.2) {
    eps *= 1.6;
    out = simplify(w, eps);
  }
  return out;
}

/** Expresión lineal por tramos de una serie, con la variable de tiempo `T` (p. ej. "t" o "(on/30)"). */
export function seriesExpr(s: Series, T: string): string {
  if (!s.length) return '0';
  if (s.length === 1) return f4(s[0][1]);
  const parts: string[] = [`lt(${T},${f4(s[0][0])})*${f4(s[0][1])}`];
  for (let i = 0; i < s.length - 1; i++) {
    const [a, va] = s[i];
    const [b, vb] = s[i + 1];
    parts.push(`gte(${T},${f4(a)})*lt(${T},${f4(b)})*(${f4(va)}+${f4(vb - va)}*(${T}-${f4(a)})/${f4(Math.max(1e-3, b - a))})`);
  }
  const last = s[s.length - 1];
  parts.push(`gte(${T},${f4(last[0])})*${f4(last[1])}`);
  return `(${parts.join('+')})`;
}

/** La pista de persona como pista de caras (la que usan gráficos y subtítulos para no tapar la cara). */
export function personFaces(track: PersonTrack): FaceTrack {
  return { fps: track.fps, frames: track.frames.map((f) => (f.cara ? { x: f.cara[0], y: f.cara[1], w: f.cara[2], h: f.cara[3] } : null)) };
}

/** Centro de la cara (0–1) suavizado: de la pista de persona o, si no hay, de la de caras (OpenCV). */
export function faceSeries(person: PersonTrack | null, faces: FaceTrack | null): { x: Series; y: Series } | null {
  let pts: Array<[number, number | null, number | null]> = [];
  if (person?.frames.some((f) => f.cara)) {
    pts = person.frames.map((f) => [f.t, f.cara ? f.cara[0] + f.cara[2] / 2 : null, f.cara ? f.cara[1] + f.cara[3] / 2 : null]);
  } else if (faces?.frames.some(Boolean)) {
    pts = faces.frames.map((b, i) => [i / faces.fps, b ? b.x + b.w / 2 : null, b ? b.y + b.h / 2 : null]);
  }
  if (!pts.length) return null;
  // Suavizado amplio (1,2 s): la cámara acompaña sin temblar
  const x = simplify(clean(pts.map((p) => [p[0], p[1]]), 1.2), 0.006);
  const y = simplify(clean(pts.map((p) => [p[0], p[2]]), 1.2), 0.006);
  return x.length && y.length ? { x, y } : null;
}

/** Barbilla (centro x, y del borde inferior de la cara) en cada momento, suavizada (subtítulos anclados a la cara). */
export function chinSeries(person: PersonTrack | null, faces: FaceTrack | null): { x: Series; y: Series } | null {
  let pts: Array<[number, number | null, number | null]> = [];
  if (person?.frames.some((f) => f.cara)) pts = person.frames.map((f) => [f.t, f.cara ? f.cara[0] + f.cara[2] / 2 : null, f.cara ? f.cara[1] + f.cara[3] : null]);
  else if (faces?.frames.some(Boolean)) pts = faces.frames.map((b, i) => [i / faces.fps, b ? b.x + b.w / 2 : null, b ? b.y + b.h : null]);
  if (!pts.length) return null;
  const x = clean(pts.map((p) => [p[0], p[1]]), 0.6);
  const y = clean(pts.map((p) => [p[0], p[2]]), 0.6);
  return x.length && y.length ? { x, y } : null;
}

export type FollowTarget = 'cara' | 'mano_izquierda' | 'mano_derecha';

/** Serie de un objetivo a seguir (suavizado corto: sigue de cerca sin vibrar). */
export function targetSeries(person: PersonTrack, target: FollowTarget): { x: Series; y: Series } | null {
  const pick = (f: PersonFrame): [number, number] | null => {
    if (target === 'cara') return f.cara ? [f.cara[0] + f.cara[2] / 2, f.cara[1] + f.cara[3] / 2] : null;
    // Qué mano es cuál lo dice la muñeca de la pose (estable); la posición fina, la palma detectada más
    // cercana a esa muñeca (la etiqueta izquierda/derecha de MediaPipe Hands cambia entre fotogramas)
    const w = f.pose?.[target === 'mano_izquierda' ? 'munecaIzq' : 'munecaDer'];
    const palms = [f.manoIzq, f.manoDer].filter((x): x is [number, number] => !!x);
    if (w && w[2] >= 0.5) {
      const near = palms.map((p) => ({ p, d: Math.hypot(p[0] - w[0], p[1] - w[1]) })).sort((a, b) => a.d - b.d)[0];
      return near && near.d < 0.12 ? near.p : [w[0], w[1]];
    }
    return (target === 'mano_izquierda' ? f.manoIzq : f.manoDer) ?? null;
  };
  const pts = person.frames.map((f) => [f.t, pick(f)] as const);
  if (!pts.some((p) => p[1])) return null;
  const x = simplify(clean(pts.map((p) => [p[0], p[1]?.[0] ?? null]), 0.35), 0.004);
  const y = simplify(clean(pts.map((p) => [p[0], p[1]?.[1] ?? null]), 0.35), 0.004);
  return { x, y };
}

export const valueAt = (s: Series, t: number) => {
  if (!s.length) return 0;
  if (t <= s[0][0]) return s[0][1];
  for (let i = 0; i < s.length - 1; i++) if (t < s[i + 1][0]) return s[i][1] + ((s[i + 1][1] - s[i][1]) * (t - s[i][0])) / Math.max(1e-6, s[i + 1][0] - s[i][0]);
  return s[s.length - 1][1];
};

// ── Movimientos del cuerpo (idea 12) ─────────────────────────────────────────

export interface BodyMove {
  t: number;
  tipo: 'gesto_amplio' | 'mano_cruza' | 'inclinacion' | 'entra_mano';
  fuerza: number;
  detalle: string;
}

/** Momentos con movimiento grande: buenos para cortar, transicionar o lanzar un efecto «con el cuerpo». */
export function bodyMoves(track: PersonTrack, max = 12): BodyMove[] {
  const F = track.frames;
  const out: BodyMove[] = [];
  const dt = 1 / track.fps;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1].pose;
    const b = F[i].pose;
    if (!a || !b) continue;
    const sh = Math.max(0.05, Math.abs(b.hombroIzq[0] - b.hombroDer[0]));
    const cx = (b.hombroIzq[0] + b.hombroDer[0]) / 2;
    for (const k of ['munecaIzq', 'munecaDer'] as const) {
      if (b[k][2] < 0.5 || a[k][2] < 0.5) continue;
      const v = Math.hypot(b[k][0] - a[k][0], b[k][1] - a[k][1]) / sh / dt;
      if (v > 2.2) out.push({ t: F[i].t, tipo: 'gesto_amplio', fuerza: v, detalle: `${k === 'munecaIzq' ? 'mano izquierda' : 'mano derecha'} se mueve rápido` });
      if (Math.sign(a[k][0] - cx) !== Math.sign(b[k][0] - cx) && Math.abs(b[k][0] - a[k][0]) / sh > 0.25) out.push({ t: F[i].t, tipo: 'mano_cruza', fuerza: v + 1, detalle: 'una mano cruza delante del cuerpo (corte o transición «tapando» la cámara)' });
    }
    const lean = Math.abs(b.nariz[0] - a.nariz[0]) / sh / dt;
    if (lean > 1.2) out.push({ t: F[i].t, tipo: 'inclinacion', fuerza: lean, detalle: 'se inclina o gira la cabeza' });
    if ((!F[i - 1].manoDer && F[i].manoDer) || (!F[i - 1].manoIzq && F[i].manoIzq)) out.push({ t: F[i].t, tipo: 'entra_mano', fuerza: 1.5, detalle: 'una mano entra en el cuadro (señalar, enseñar algo)' });
  }
  // Los más fuertes, separados al menos 1,2 s
  out.sort((x, y) => y.fuerza - x.fuerza);
  const chosen: BodyMove[] = [];
  for (const m of out) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => Math.abs(c.t - m.t) >= 1.2)) chosen.push({ ...m, fuerza: Math.round(m.fuerza * 10) / 10 });
  }
  return chosen.sort((x, y) => x.t - y.t);
}

/** Resumen para Claude. */
export function personSummary(track: PersonTrack) {
  const F = track.frames;
  const pct = (n: number) => Math.round((n / Math.max(1, F.length)) * 100);
  const caras = F.filter((f) => f.cara).map((f) => f.cara!);
  const cx = caras.map((c) => c[0] + c[2] / 2).sort((a, b) => a - b);
  const cy = caras.map((c) => c[1] + c[3] / 2).sort((a, b) => a - b);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const med = (xs: number[]) => (xs.length ? r2(xs[Math.floor(xs.length / 2)]) : null);
  return {
    cara: caras.length
      ? { visible: `${pct(caras.length)} %`, centro: { x: med(cx), y: med(cy) }, recorrido: { x: [r2(cx[0]), r2(cx[cx.length - 1])], y: [r2(cy[0]), r2(cy[cy.length - 1])] }, tamano: med(caras.map((c) => c[2]).sort((a, b) => a - b)) }
      : null,
    manos: { izquierda: `${pct(F.filter((f) => f.manoIzq).length)} %`, derecha: `${pct(F.filter((f) => f.manoDer).length)} %` },
    movimientos: bodyMoves(track),
  };
}

// ── Temblor y luz (ideas 19 y 20) ───────────────────────────────────────────

const filterCache = new Map<string, boolean>();

/** ¿Este FFmpeg trae el filtro? (`-filters` escribe en la salida estándar, no en la de errores) */
export async function hasFilter(name: string): Promise<boolean> {
  const hit = filterCache.get(name);
  if (hit !== undefined) return hit;
  const out: string = await new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(), ['-hide_banner', '-filters'], { windowsHide: true });
    let o = '';
    child.stdout.on('data', (d: Buffer) => (o += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(o));
  });
  const ok = new RegExp(`^\\s*\\S*\\s+${name}\\s`, 'm').test(out);
  filterCache.set(name, ok);
  return ok;
}

/** Estabiliza el video base en dos pasadas (vidstab) o, si este FFmpeg no lo trae, con deshake. */
export async function stabilizePlate(carpeta: string, plate: string, out: string, W: number, H: number): Promise<'vidstab' | 'deshake'> {
  // Siempre del tamaño exacto del formato (la máscara y el resto del grafo cuentan con W×H)
  const fit = `scale=${W}:${H},setsar=1`;
  const trf = `${out}.trf`;
  if (await hasFilter('vidstabdetect')) {
    await ffmpeg({ cwd: carpeta, args: ['-y', '-hide_banner', '-i', plate, '-vf', `vidstabdetect=shakiness=6:accuracy=12:result=${trf}`, '-f', 'null', '-'], timeoutMs: 30 * 60_000 });
    await ffmpeg({
      cwd: carpeta,
      args: ['-y', '-hide_banner', '-i', plate, '-vf', `vidstabtransform=input=${trf}:smoothing=24:zoom=3:optzoom=0,unsharp=5:5:0.6:3:3:0.3,${fit}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', out],
      timeoutMs: 30 * 60_000,
    });
    await fs.rm(path.join(/*turbopackIgnore: true*/ carpeta, trf), { force: true }).catch(() => undefined);
    return 'vidstab';
  }
  await ffmpeg({ cwd: carpeta, args: ['-y', '-hide_banner', '-i', plate, '-vf', `deshake=rx=32:ry=32,scale=iw*1.04:ih*1.04,crop=iw/1.04:ih/1.04,${fit}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', out], timeoutMs: 30 * 60_000 });
  return 'deshake';
}

/**
 * Temblor de la cámara: movimiento global entre fotogramas (vidstabdetect en texto). Devuelve el
 * desplazamiento medio de alta frecuencia en píxeles del cuadro (≈0–1 quieto, 3+ tiembla).
 */
export async function measureShake(carpeta: string, plate: string, seconds = 20): Promise<{ px: number; nivel: 'quieto' | 'leve' | 'tiembla' } | null> {
  if (!(await hasFilter('vidstabdetect'))) return null;
  const trf = `temblor-${Date.now()}.trf`;
  await ffmpeg({ cwd: carpeta, args: ['-y', '-hide_banner', '-t', String(seconds), '-i', plate, '-vf', `scale=540:-2,vidstabdetect=shakiness=5:accuracy=9:result=${trf}:fileformat=1`, '-f', 'null', '-'], timeoutMs: 10 * 60_000 });
  const file = path.join(/*turbopackIgnore: true*/ carpeta, trf);
  const txt = await fs.readFile(file, 'utf-8').catch(() => '');
  await fs.rm(file, { force: true }).catch(() => undefined);
  // Cada fotograma: «Frame n (List k [(LM dx dy x y size contrast match),…])» → mediana de dx,dy
  const per: Array<[number, number]> = [];
  for (const line of txt.split('\n')) {
    if (!line.startsWith('Frame')) continue;
    const ms = [...line.matchAll(/\(LM (-?\d+) (-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    if (!ms.length) {
      per.push([0, 0]);
      continue;
    }
    const sx = ms.map((m) => m[0]).sort((a, b) => a - b);
    const sy = ms.map((m) => m[1]).sort((a, b) => a - b);
    per.push([sx[Math.floor(sx.length / 2)], sy[Math.floor(sy.length / 2)]]);
  }
  if (per.length < 10) return null;
  // Alta frecuencia: diferencia con la media de 9 fotogramas (quita paneos intencionados)
  let sum = 0;
  for (let i = 4; i < per.length - 4; i++) {
    const w = per.slice(i - 4, i + 5);
    const mx = w.reduce((s, p) => s + p[0], 0) / w.length;
    const my = w.reduce((s, p) => s + p[1], 0) / w.length;
    sum += Math.hypot(per[i][0] - mx, per[i][1] - my);
  }
  // A 540 px de ancho → pasado a 1080
  const px = Math.round((sum / Math.max(1, per.length - 8)) * 2 * 10) / 10;
  return { px, nivel: px < 1.2 ? 'quieto' : px < 3 ? 'leve' : 'tiembla' };
}

export interface LightSegment {
  desde: number;
  hasta: number;
  y: number;
  u: number;
  v: number;
}

/** Brillo y tinte medios de cada tramo del video base (signalstats, 2 muestras por segundo). */
export async function lightStats(carpeta: string, plate: string, tramos: Array<[number, number]>): Promise<LightSegment[]> {
  const out = await ffmpeg({ cwd: carpeta, args: ['-hide_banner', '-i', plate, '-vf', 'fps=2,scale=270:-2,signalstats,metadata=print', '-f', 'null', '-'], timeoutMs: 10 * 60_000 });
  const samples: Array<{ t: number; y: number; u: number; v: number }> = [];
  let cur: { t: number; y?: number; u?: number; v?: number } | null = null;
  for (const line of out.split('\n')) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) {
      if (cur?.y !== undefined && cur.u !== undefined && cur.v !== undefined) samples.push(cur as { t: number; y: number; u: number; v: number });
      cur = { t: Number(t[1]) };
      continue;
    }
    const m = /lavfi\.signalstats\.(YAVG|UAVG|VAVG)=([\d.]+)/.exec(line);
    if (m && cur) cur[m[1] === 'YAVG' ? 'y' : m[1] === 'UAVG' ? 'u' : 'v'] = Number(m[2]);
  }
  if (cur?.y !== undefined && cur.u !== undefined && cur.v !== undefined) samples.push(cur as { t: number; y: number; u: number; v: number });
  return tramos
    .map(([a, b]) => {
      const s = samples.filter((x) => x.t >= a && x.t < b);
      if (!s.length) return null;
      const avg = (k: 'y' | 'u' | 'v') => Math.round((s.reduce((acc, x) => acc + x[k], 0) / s.length) * 10) / 10;
      return { desde: a, hasta: b, y: avg('y'), u: avg('u'), v: avg('v') };
    })
    .filter((x): x is LightSegment => !!x);
}

/**
 * Igualado de luz y color entre tramos: lleva el brillo y el tinte de cada tramo a la mediana
 * (solo si se desvía de forma visible). Devuelve un `eq` con expresiones por tiempo, o null.
 */
export function matchLightFilter(segs: LightSegment[]): { filtro: string | null; ajustados: number } {
  if (segs.length < 2) return { filtro: null, ajustados: 0 };
  const med = (k: 'y' | 'u' | 'v') => [...segs.map((s) => s[k])].sort((a, b) => a - b)[Math.floor(segs.length / 2)];
  const [ty, tu, tv] = [med('y'), med('u'), med('v')];
  const bT: string[] = [];
  const rT: string[] = [];
  const blT: string[] = [];
  let n = 0;
  for (const s of segs) {
    const dy = ty - s.y;
    const du = s.u - tu;
    const dv = s.v - tv;
    if (Math.abs(dy) < 4 && Math.abs(du) < 3 && Math.abs(dv) < 3) continue;
    n++;
    const gate = `between(t,${f4(s.desde)},${f4(s.hasta - 0.001)})`;
    bT.push(`${gate}*${f4(Math.max(-0.12, Math.min(0.12, dy / 255)))}`);
    // V alto = demasiado rojo → baja gamma_r; U alto = demasiado azul → baja gamma_b
    rT.push(`${gate}*${f4(Math.max(-0.15, Math.min(0.15, -dv / 64)))}`);
    blT.push(`${gate}*${f4(Math.max(-0.15, Math.min(0.15, -du / 64)))}`);
  }
  if (!n) return { filtro: null, ajustados: 0 };
  return { filtro: `eq=brightness='${bT.join('+')}':gamma_r='1+${rT.join('+')}':gamma_b='1+${blT.join('+')}':eval=frame`, ajustados: n };
}

// ── Efectos con la máscara (ideas 13, 14, 15 y persona delante de un elemento) ──

export type PersonFxType = 'desenfocar_fondo' | 'cambiar_fondo' | 'clon';

export interface ResolvedPersonFx {
  desde: number;
  hasta: number;
  efecto: PersonFxType;
  intensidad: number;
  /** cambiar_fondo: color #RRGGBB o archivo (ruta absoluta) */
  fondoColor?: string;
  fondoAbs?: string;
  fondoEsImagen?: boolean;
  clonDesde?: number;
  clonLado: 'izquierda' | 'derecha';
  clonEscala: number;
  espejo: boolean;
}

/**
 * Grafo de FFmpeg de los efectos de persona sobre [inLabel] → [outLabel], y la persona recortada
 * encima de las ventanas `delante` (elementos «detrás de la persona», ya puestos en [inLabel2]).
 * `plateIdx` y `maskIdx` son entradas de FFmpeg con el video base y la máscara.
 */
export function personEffectsGraph(o: {
  W: number;
  H: number;
  fps: number;
  total: number;
  plateIdx: number;
  maskIdx: number;
  firstExtraInput: number;
  efectos: ResolvedPersonFx[];
}): { inputs: string[]; layers: number; build: (inLabel: string, outLabel: string) => string[]; front: (inLabel: string, outLabel: string, windows: Array<[number, number]>) => string[] } {
  const { W, H, fps, total } = o;
  const uses = o.efectos.length + 1;
  const inputs: string[] = [];
  const pre: string[] = [
    `[${o.plateIdx}:v]format=rgba,split=${uses}${Array.from({ length: uses }, (_, i) => `[pl${i}]`).join('')}`,
    `[${o.maskIdx}:v]format=gray,scale=${W}:${H}:flags=bilinear,split=${uses}${Array.from({ length: uses }, (_, i) => `[mk${i}]`).join('')}`,
  ];
  let extra = o.firstExtraInput;
  const between = (a: number, b: number) => `between(t,${f4(a)},${f4(b)})`;
  const build = (inLabel: string, outLabel: string) => {
    const g: string[] = [...pre];
    let cur = inLabel;
    o.efectos.forEach((e, i) => {
      const next = i === o.efectos.length - 1 ? outLabel : `pfx${i}`;
      const en = between(e.desde, e.hasta);
      if (e.efecto === 'desenfocar_fondo') {
        g.push(`[pl${i}][mk${i}]alphamerge[ly${i}]`);
        g.push(`[${cur}]gblur=sigma=${e.intensidad.toFixed(1)}:enable='${en}'[bl${i}]`);
        g.push(`[bl${i}][ly${i}]overlay=format=auto:enable='${en}'[${next}]`);
      } else if (e.efecto === 'cambiar_fondo') {
        g.push(`[pl${i}][mk${i}]alphamerge[ly${i}]`);
        const len = e.hasta - e.desde + 0.2;
        if (e.fondoAbs) {
          const k = extra++;
          if (e.fondoEsImagen) inputs.push('-loop', '1', '-framerate', String(fps), '-t', len.toFixed(3), '-i', e.fondoAbs);
          else inputs.push('-stream_loop', '-1', '-t', len.toFixed(3), '-i', e.fondoAbs);
          g.push(`[${k}:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${f4(e.desde)}/TB[bg${i}]`);
        } else {
          g.push(`color=c=${(e.fondoColor ?? '#111111').replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${len.toFixed(3)},format=yuv420p,setpts=PTS-STARTPTS+${f4(e.desde)}/TB[bg${i}]`);
        }
        g.push(`[${cur}][bg${i}]overlay=eof_action=pass:enable='${en}'[bo${i}]`);
        g.push(`[bo${i}][ly${i}]overlay=format=auto:enable='${en}'[${next}]`);
      } else {
        // Clon: la persona de otro momento, a un lado (y en espejo si se pide)
        const len = e.hasta - e.desde;
        const src = Math.max(0, Math.min(total - len, e.clonDesde ?? 0));
        const sc = e.clonEscala;
        const cw = Math.round((W * sc) / 2) * 2;
        const ch = Math.round((H * sc) / 2) * 2;
        const trim = `trim=start=${f4(src)}:end=${f4(src + len)},setpts=PTS-STARTPTS+${f4(e.desde)}/TB`;
        g.push(`[pl${i}]${trim}[cp${i}]`);
        g.push(`[mk${i}]${trim}[cm${i}]`);
        g.push(`[cp${i}][cm${i}]alphamerge${e.espejo ? ',hflip' : ''},scale=${cw}:${ch}[cl${i}]`);
        // Parte del sitio de la persona (centrada) y se aparta un 27 % del ancho hacia su lado
        const x = Math.round((W - cw) / 2 + (e.clonLado === 'izquierda' ? -1 : 1) * W * 0.27);
        g.push(`[${cur}][cl${i}]overlay=x=${x}:y=${H - ch}:eof_action=pass:format=auto:enable='${en}'[${next}]`);
      }
      cur = next;
    });
    if (!o.efectos.length) g.push(`[${inLabel}]null[${outLabel}]`);
    return g;
  };
  const last = uses - 1;
  const front = (inLabel: string, outLabel: string, windows: Array<[number, number]>) => {
    if (!windows.length) return [`[pl${last}]nullsink`, `[mk${last}]nullsink`, `[${inLabel}]null[${outLabel}]`];
    const en = windows.map(([a, b]) => between(a, b)).join('+');
    return [`[pl${last}][mk${last}]alphamerge[lyf]`, `[${inLabel}][lyf]overlay=format=auto:enable='${en}'[${outLabel}]`];
  };
  return { inputs, layers: uses, build, front };
}
