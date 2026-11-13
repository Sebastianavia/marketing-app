import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { findPython, pythonScript, runProcess } from './python-env';
import { pythonPackageDirs } from './claude-toolbox';
import type { EditPhrase, EditProject, EditWord } from './types';

/**
 * Cortes limpios (Fase 8 del editor viral): que en el video final solo se oiga a la persona.
 * Problema real: alguien detrás de cámara le dicta la frase y la persona la repite; esa voz de
 * fondo se colaba (transcrita como si fuera suya, o sin transcribir en pausas y márgenes).
 *
 * Señales (todas gratis y locales, salvo la separación de hablantes, que ya viene con la
 * transcripción de ElevenLabs sin costo extra):
 *  1. Hablante de cada palabra (diarize de Scribe): la persona = quien más habla.
 *  2. Labios (python/lulo_lips.py, MediaPipe Face Mesh, ~3 s por minuto): si suena una voz y su
 *     boca no se mueve, no es ella.
 *  3. Voz en el audio fuera de las palabras de la persona (energía en la banda de la voz).
 * Resultado: frases de fondo → se cortan (con su motivo: «apunte que repites en 0:12»), y zonas de
 * voz ajena dentro de lo que se conserva → `huecos` de la frase (se cortan si son largas; si son
 * cortas, se silencian en el render).
 */

export interface BackgroundZone {
  s: number;
  e: number;
  /** transcrita = palabras de otra persona; sin_transcribir = voz en el audio sin palabras de la persona. */
  fuente: 'transcrita' | 'sin_transcribir';
  confianza: 'alta' | 'media';
  /** Por qué: hablante distinto, labios quietos, volumen… */
  pruebas: string[];
  texto?: string;
}

export interface BackgroundReport {
  analizado: string;
  hablantes: number;
  conLabios: boolean;
  frasesDeFondo: Array<{ id: string; texto: string; motivo: string }>;
  zonas: BackgroundZone[];
  resumen: string;
}

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/** Parecido de texto (0–1) por palabras compartidas: «apunte» y su repetición. */
export function similarity(a: string, b: string): number {
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── Audio: energía de la voz cada 20 ms ─────────────────────────────────────

const RATE = 16000;
const HOP = 320; // 20 ms

async function voiceEnergy(file: string): Promise<{ db: Float32Array; hop: number; x: Float32Array }> {
  const buf: Buffer = await new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-af', 'highpass=f=250,lowpass=f=3800', '-f', 'f32le', '-'], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`No se pudo leer el audio: ${err.slice(-200)}`))));
  });
  const n = Math.floor(buf.length / 4);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readFloatLE(i * 4);
  const frames = Math.floor(n / HOP);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < HOP; i++) sum += x[f * HOP + i] * x[f * HOP + i];
    db[f] = 10 * Math.log10(sum / HOP + 1e-12);
  }
  return { db, hop: HOP / RATE, x };
}

/**
 * ¿Es una voz (con tono) o ruido (respiración, roce)? Fracción de ventanas de 40 ms con una
 * periodicidad clara entre 70 y 400 Hz (autocorrelación normalizada).
 */
function voicing(x: Float32Array, s: number, e: number): number {
  const W = 640;
  const minLag = Math.floor(RATE / 400);
  const maxLag = Math.ceil(RATE / 70);
  let voiced = 0;
  let total = 0;
  for (let a = Math.floor(s * RATE); a + W + maxLag < Math.min(x.length, e * RATE); a += 320) {
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += x[a + i] * x[a + i];
    if (e0 < 1e-7) continue;
    total++;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let el = 0;
      for (let i = 0; i < W; i++) {
        c += x[a + i] * x[a + i + lag];
        el += x[a + i + lag] * x[a + i + lag];
      }
      const r = c / Math.sqrt(e0 * el + 1e-12);
      if (r > best) best = r;
    }
    if (best > 0.55) voiced++;
  }
  return total ? voiced / total : 0;
}

// ── Labios ───────────────────────────────────────────────────────────────────

export async function lipTrack(p: EditProject): Promise<{ fps: number; boca: Array<number | null> } | null> {
  const out = path.join(/*turbopackIgnore: true*/ p.carpeta, 'labios.json');
  if (fsSync.existsSync(out)) return JSON.parse(await fs.readFile(out, 'utf-8'));
  const py = await findPython();
  if (!py) return null;
  const env = { ...process.env, PYTHONPATH: [...pythonPackageDirs(), process.env.PYTHONPATH ?? ''].filter(Boolean).join(path.delimiter) };
  const r = await runProcess(
    py.cmd,
    [...py.args, pythonScript('lulo_lips.py'), '--ffmpeg', resolveFfmpegPath(), '--src', path.join(/*turbopackIgnore: true*/ p.carpeta, p.original.archivo), '--out', `${out}.tmp`, '--frames', String(Math.round(p.original.duracion * 15))],
    { timeoutMs: 30 * 60_000, env }
  );
  if (r.code !== 0 || !fsSync.existsSync(`${out}.tmp`)) return null;
  await fs.rename(`${out}.tmp`, out);
  return JSON.parse(await fs.readFile(out, 'utf-8'));
}

/** Movimiento de la boca en [a, b]: fracción de fotogramas que cambian y si se ve la cara. */
function lipMotion(lips: { fps: number; boca: Array<number | null> } | null, a: number, b: number): { visible: number; movimiento: number } | null {
  if (!lips) return null;
  const xs = lips.boca.slice(Math.floor(a * lips.fps), Math.ceil(b * lips.fps) + 1);
  if (!xs.length) return null;
  const seen = xs.filter((v): v is number => v !== null);
  const visible = seen.length / xs.length;
  if (seen.length < 3) return { visible, movimiento: 0 };
  let ch = 0;
  for (let i = 1; i < seen.length; i++) if (Math.abs(seen[i] - seen[i - 1]) > 0.012) ch++;
  // Boca muy abierta todo el rato también es hablar
  const open = seen.filter((v) => v > 0.05).length / seen.length;
  return { visible, movimiento: Math.max(ch / (seen.length - 1), open * 0.6) };
}

// ── Detección ────────────────────────────────────────────────────────────────

/**
 * Analiza la edición y devuelve las frases de fondo y las zonas de voz ajena (tiempos del original).
 * No cambia nada: `applyBackgroundReport` lo aplica a las frases.
 */
export async function detectBackgroundVoices(p: EditProject): Promise<BackgroundReport> {
  const words = p.frases.flatMap((f) => f.palabras).sort((a, b) => a.s - b.s);
  // 1. Hablante principal (con separación de hablantes): quien más tiempo habla
  const time = new Map<string, number>();
  for (const w of words) if (w.h) time.set(w.h, (time.get(w.h) ?? 0) + (w.e - w.s));
  const principal = [...time.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const lips = await lipTrack(p).catch(() => null);
  const isMainWord = (w: EditWord) => !principal || !w.h || w.h === principal;

  // 2. Frases de fondo: mayoría de palabras de otro hablante, o labios quietos con la cara a la vista
  const frasesDeFondo: BackgroundReport['frasesDeFondo'] = [];
  const zonas: BackgroundZone[] = [];
  const text = (f: EditPhrase) => f.palabras.map((w) => w.t).join(' ');
  for (const f of p.frases) {
    if (!f.palabras.length) continue;
    const dur = f.palabras.reduce((s, w) => s + (w.e - w.s), 0);
    const other = f.palabras.filter((w) => !isMainWord(w)).reduce((s, w) => s + (w.e - w.s), 0);
    const lm = lipMotion(lips, f.s, f.e);
    const pruebas: string[] = [];
    if (principal && other / Math.max(0.01, dur) > 0.5) pruebas.push('otra voz (separación de hablantes)');
    if (lm && lm.visible > 0.7 && lm.movimiento < 0.12 && f.e - f.s >= 0.5) pruebas.push(`tus labios no se mueven (${Math.round(lm.movimiento * 100)} %)`);
    // Si los labios se mueven claramente, gana la imagen: es la persona aunque Scribe dude
    const lipsSay = lm && lm.visible > 0.7 && lm.movimiento >= 0.3;
    if (!pruebas.length || (lipsSay && pruebas.length === 1 && pruebas[0].startsWith('otra voz'))) continue;
    // ¿La persona lo repite después? (apunte)
    const after = p.frases.find((g) => g.s > f.e && g.s - f.e < 15 && g.id !== f.id && similarity(text(f), text(g)) >= 0.5 && !g.palabras.every((w) => !isMainWord(w)));
    const motivo = after ? `Voz de fondo: te dictan «${text(f).slice(0, 40)}» y lo repites en ${fmt(after.s)}` : `Voz de fondo: ${pruebas.join(' y ')}`;
    frasesDeFondo.push({ id: f.id, texto: text(f), motivo });
    zonas.push({ s: f.s, e: f.e, fuente: 'transcrita', confianza: pruebas.length > 1 || after ? 'alta' : 'media', pruebas, texto: text(f) });
  }

  // 3. Voz sin transcribir fuera de las palabras de la persona (pausas, márgenes)
  const bgIds = new Set(frasesDeFondo.map((x) => x.id));
  const mainWords = p.frases.filter((f) => !bgIds.has(f.id)).flatMap((f) => f.palabras.filter(isMainWord));
  const { db, hop, x } = await voiceEnergy(path.join(/*turbopackIgnore: true*/ p.carpeta, p.original.archivo));
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] ?? -60;
  // Volumen típico de la persona hablando
  const speechDb: number[] = [];
  for (const w of mainWords) for (let f = Math.floor(w.s / hop); f < Math.ceil(w.e / hop) && f < db.length; f++) speechDb.push(db[f]);
  speechDb.sort((a, b) => a - b);
  const speech = speechDb[Math.floor(speechDb.length / 2)] ?? -25;
  const thr = Math.max(floor + 12, speech - 22);
  const covered = new Uint8Array(db.length);
  for (const w of mainWords) for (let f = Math.max(0, Math.floor((w.s - 0.08) / hop)); f < Math.min(db.length, Math.ceil((w.e + 0.08) / hop)); f++) covered[f] = 1;
  // Solo importa cerca de lo que se conserva (frases que no se cortan, con su margen)
  const near = new Uint8Array(db.length);
  for (const f of p.frases) {
    if (f.cortar || bgIds.has(f.id) || !f.palabras.length) continue;
    for (let i = Math.max(0, Math.floor((f.s - 0.6) / hop)); i < Math.min(db.length, Math.ceil((f.e + 0.6) / hop)); i++) near[i] = 1;
  }
  let start = -1;
  let lastVoiced = -1;
  const pushRegion = (a: number, b: number) => {
    const s = a * hop;
    const e = (b + 1) * hop;
    if (e - s < 0.18) return;
    let sum = 0;
    for (let i = a; i <= b; i++) sum += db[i];
    const level = sum / (b - a + 1);
    // Ya cubierto por una frase de fondo que se corta
    if (zonas.some((z) => z.fuente === 'transcrita' && s < z.e && e > z.s)) return;
    // Respiraciones, roces y ruidos no tienen tono de voz: no son «voz ajena»
    const v = voicing(x, s, e);
    if (v < 0.35) return;
    const lm = lipMotion(lips, s, e);
    const pruebas = [`voz en el audio sin palabras tuyas (${Math.round(level - speech)} dB respecto a tu voz, ${Math.round(v * 100)} % con tono de voz)`];
    let confianza: BackgroundZone['confianza'] = 'media';
    if (lm && lm.visible > 0.6) {
      if (lm.movimiento >= 0.3) return; // la persona habla (algo que no se transcribió): se queda
      pruebas.push('tus labios no se mueven');
      confianza = 'alta';
    } else if (level > speech - 6) {
      // Sin labios y con volumen de su voz: puede ser ella (una risa, una muletilla): no se toca
      return;
    }
    zonas.push({ s: Math.round(s * 100) / 100, e: Math.round(e * 100) / 100, fuente: 'sin_transcribir', confianza, pruebas });
  };
  for (let i = 0; i < db.length; i++) {
    const voiced = near[i] && !covered[i] && db[i] > thr;
    if (voiced) {
      if (start < 0) start = i;
      lastVoiced = i;
    } else if (start >= 0 && i - lastVoiced > 6) {
      pushRegion(start, lastVoiced);
      start = -1;
    }
  }
  if (start >= 0) pushRegion(start, lastVoiced);

  const sinTx = zonas.filter((z) => z.fuente === 'sin_transcribir');
  const resumen =
    frasesDeFondo.length || sinTx.length
      ? `Voces de fondo: ${frasesDeFondo.length} frase(s) transcrita(s) que no son tuyas${sinTx.length ? ` y ${sinTx.length} zona(s) de voz ajena en pausas o márgenes (${sinTx.reduce((s, z) => s + z.e - z.s, 0).toFixed(1)} s)` : ''}.`
      : 'Solo se oye a la persona: no hay voces de fondo.';
  return { analizado: new Date().toISOString(), hablantes: time.size || 1, conLabios: !!lips, frasesDeFondo, zonas, resumen };
}

/** Aplica el informe: corta las frases de fondo y marca las zonas de voz ajena en su frase (`huecos`). */
export function applyBackgroundReport(p: EditProject, r: BackgroundReport, opts: { cortar: boolean } = { cortar: true }) {
  const bg = new Map(r.frasesDeFondo.map((x) => [x.id, x.motivo]));
  for (const f of p.frases) {
    f.voz = bg.has(f.id) ? 'fondo' : undefined;
    if (bg.has(f.id) && opts.cortar) {
      f.cortar = true;
      f.motivo = bg.get(f.id);
    }
    f.huecos = undefined;
  }
  // Cada zona sin transcribir se asigna a la frase conservada más cercana
  for (const z of r.zonas.filter((x) => x.fuente === 'sin_transcribir')) {
    const target = p.frases
      .filter((f) => !f.cortar && f.palabras.length)
      .map((f) => ({ f, d: z.e < f.s ? f.s - z.e : z.s > f.e ? z.s - f.e : 0 }))
      .sort((a, b) => a.d - b.d)[0];
    if (target && target.d < 1) (target.f.huecos ??= []).push({ s: z.s, e: z.e });
  }
  p.vocesFondo = r;
}
