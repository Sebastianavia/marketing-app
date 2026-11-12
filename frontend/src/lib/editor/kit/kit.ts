import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { z } from 'zod';
import { formatSize, safeZone, type EditProfile } from '@/config/editor-looks';
import { renderCodeVideo } from '@/lib/ai/claude-code/code-video';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { ffmpeg, probeVideo } from '../media';
import { normalizeProfile } from '../profile-store';
import { IMAGE_EXT, VIDEO_EXT, editAsset } from '../direction';
import { findPython, pythonScript, runProcess } from '../python-env';
import { pythonPackageDirs } from '../claude-toolbox';
import type { EditProject } from '../types';
import { KIT_FONTS, ensureLogo, findBrand } from './brands';
import * as T from './templates';

/**
 * Kit de gráficos de Lulo (Fase 3): piezas animadas con la paleta del video, hechas con plantillas
 * de HyperFrames y renderizadas a .mov transparente dentro de la carpeta de la edición
 * (`kit/<tipo>-<huella>.mov`; misma pieza = mismo archivo, no se vuelve a renderizar). Claude las
 * pide con `kit_grafico` y las coloca en el plan como elemento «capa». Así no diseña desde cero cada
 * vez y la calidad es constante; para algo único sigue teniendo HyperFrames a mano.
 */

export const KIT_TYPES = ['sticker', 'trazo', 'grafica', 'antes_despues', 'capitulo', 'texto_kinetico', 'marca', 'pantalla'] as const;
export type KitType = (typeof KIT_TYPES)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().min(0).max(1);
const sec = z.number().min(0).max(3600);

/** Esquema PLANO (la API de Claude descarta herramientas con oneOf arriba): cada tipo usa sus campos. */
export const KitInputSchema = z.object({
  tipo: z.enum(KIT_TYPES),
  duracion: z.number().min(0.6).max(10).optional(),
  /** Segundo del video FINAL donde va la pieza; con `agregar` se añade sola al plan. */
  colocarEn: sec.optional(),
  agregar: z.boolean().default(false),
  paleta: z.object({ primario: hex, acento: hex, secundario: hex.optional(), texto: hex.default('#FFFFFF'), fondo: hex.default('#0B0B0F') }).optional(),
  fuente: z.enum(KIT_FONTS).optional(),
  // sticker
  emoji: z.string().max(16).optional(),
  texto: z.string().max(120).optional(),
  x: unit.optional(),
  y: unit.optional(),
  tamano: z.number().min(60).max(600).optional(),
  giro: z.number().min(-30).max(30).optional(),
  // trazo
  trazo: z.enum(['flecha', 'circulo', 'subrayado', 'tachado']).optional(),
  x2: unit.optional(),
  y2: unit.optional(),
  ancho: unit.optional(),
  alto: unit.optional(),
  grosor: z.number().min(6).max(30).optional(),
  color: hex.optional(),
  // gráfica
  grafica: z.enum(['barras', 'circulo', 'linea']).optional(),
  datos: z.array(z.object({ etiqueta: z.string().max(24), valor: z.number().min(0).max(1e9) })).min(1).max(7).optional(),
  titulo: z.string().max(60).optional(),
  unidad: z.string().max(6).optional(),
  posicion: z.enum(['arriba', 'centro', 'abajo']).optional(),
  // antes / después
  antes: z.string().max(300).optional(),
  despues: z.string().max(300).optional(),
  etiquetaAntes: z.string().max(16).optional(),
  etiquetaDespues: z.string().max(16).optional(),
  // capítulo
  numero: z.string().max(20).optional(),
  fondo: z.enum(['solido', 'banda', 'tarjeta']).optional(),
  // texto kinético
  palabras: z.array(z.object({ texto: z.string().max(30), t: z.number().min(0).max(10) })).max(24).optional(),
  frase: z.string().max(160).optional(),
  /** Toma las palabras (y sus tiempos exactos) del video final entre estos segundos. */
  desdeVideo: sec.optional(),
  hastaVideo: sec.optional(),
  destacar: z.array(z.string().max(30)).max(8).optional(),
  oscurecer: z.number().min(0).max(0.8).optional(),
  // marca
  marca: z.string().max(60).optional(),
  modo: z.enum(['intro', 'cierre']).optional(),
  // pantalla
  archivo: z.string().max(300).optional(),
  dispositivo: z.enum(['telefono', 'portatil', 'ninguno']).optional(),
  enfoques: z.array(z.object({ t: z.number().min(0).max(10), x: unit, y: unit, zoom: z.number().min(1).max(4).default(1.8), clic: z.boolean().default(true) })).max(8).optional(),
  inclinacion: z.number().min(-30).max(30).optional(),
  inicioVideo: z.number().min(0).max(3600).optional(),
});
export type KitInput = z.infer<typeof KitInputSchema>;

export class KitError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const KIT_CATALOG: Record<KitType, string> = {
  sticker: 'Emoji o sticker de texto con rebote (emoji, texto, x, y 0–1, tamano px, giro). Solo en picos de emoción, pocos por video; con su «pop».',
  trazo: 'Trazo a mano que se dibuja solo: trazo flecha (x,y = punto señalado; x2,y2 = origen) | circulo (x,y centro, ancho/alto 0–1) | subrayado | tachado (x→x2 en y). texto opcional, color, grosor.',
  grafica: 'Gráfica que crece al decir la cifra: grafica barras|circulo|linea, datos [{etiqueta, valor}], titulo, unidad (%, €, k…), posicion. Contadores animados.',
  antes_despues: 'Comparación con cortinilla: antes y despues (imagen o video de la carpeta), etiquetaAntes/etiquetaDespues, posicion. Con su «swipe».',
  capitulo: 'Tarjeta de capítulo 0,8–1,2 s entre ideas: numero («PASO 2»), titulo, fondo solido (pantalla completa) | banda.',
  texto_kinetico: 'La frase clave palabra a palabra a pantalla grande (1–2 por video): desdeVideo/hastaVideo para tomar las palabras con sus tiempos exactos, o frase/palabras; destacar, oscurecer 0–0,8, posicion.',
  marca: 'Intro o cierre de una marca guardada (mira marcas): marca (nombre o id), modo intro|cierre, fondo solido|tarjeta. Logo, colores, lema y CTA de la marca.',
  pantalla: 'Captura o grabación de pantalla dentro de un teléfono o portátil, con zoom y cursor que va y hace clic: archivo, dispositivo, enfoques [{t, x, y, zoom, clic}] (usa zonas_de_cambio para saber dónde pasa algo), inclinacion, inicioVideo.',
};

function palette(p: EditProject, perfil: EditProfile, input?: KitInput['paleta']): T.KitPalette {
  if (input) return input;
  const d = p.direccion?.paleta;
  if (d) return { primario: d.primario, acento: d.acento, secundario: d.secundario, texto: d.texto ?? '#FFFFFF', fondo: d.fondo ?? '#0B0B0F' };
  return { primario: perfil.subtitulos.colorCaja || '#111827', acento: perfil.subtitulos.colorResaltado || '#FFD400', texto: '#FFFFFF', fondo: '#0B0B0F' };
}

const hashOf = (...parts: Array<string | Buffer>) => {
  const h = createHash('sha1');
  for (const x of parts) h.update(x);
  return h.digest('hex').slice(0, 10);
};

/** Copia un archivo de la edición a assets/ del proyecto y devuelve su ruta relativa. */
async function addAsset(projDir: string, src: string, name: string): Promise<string> {
  const rel = `assets/${name}${path.extname(src).toLowerCase()}`;
  await fs.mkdir(path.join(/*turbopackIgnore: true*/ projDir, 'assets'), { recursive: true });
  await fs.copyFile(src, path.join(/*turbopackIgnore: true*/ projDir, rel));
  return rel;
}

function mediaOf(p: EditProject, rel: string | undefined, what: string): { abs: string; video: boolean } {
  if (!rel) throw new KitError(`Falta ${what}.`);
  const abs = editAsset(p.carpeta, rel);
  if (!fsSync.existsSync(abs)) throw new KitError(`${what} «${rel}» no existe en la carpeta de la edición (cópialo antes).`);
  const ext = path.extname(abs).toLowerCase();
  if (![...IMAGE_EXT, ...VIDEO_EXT].includes(ext)) throw new KitError(`${what}: formato no admitido.`);
  return { abs, video: VIDEO_EXT.includes(ext) };
}

export interface KitResult {
  archivo: string;
  duracion: number;
  reutilizado: boolean;
  segundosDeRender?: number;
}

/**
 * Construye y renderiza la pieza. `words` = palabras del video final (para texto kinético).
 */
export async function buildKitPiece(p: EditProject, input: KitInput, words: Array<{ t: string; s: number; e: number }>): Promise<KitResult> {
  const perfil = normalizeProfile(p.perfil);
  const { width: W, height: H } = formatSize(perfil.formato);
  const safe = safeZone(perfil.red, perfil.formato);
  const pal = palette(p, perfil, input.paleta);
  let titulo = input.fuente ?? 'Archivo Black';
  const fr = (): T.KitFrame => ({ W, H, safe: { top: safe.top, bottom: safe.bottom, right: safe.right }, pal, titulo, cuerpo: 'Montserrat' });
  const assets: Array<{ src: string; name: string }> = [];
  let built: (assetRel: Record<string, string>) => T.KitBuilt;
  const i = input;

  switch (i.tipo) {
    case 'sticker':
      if (!i.emoji && !i.texto) throw new KitError('sticker: pon emoji o texto.');
      built = () => T.sticker(fr(), { emoji: i.emoji, texto: i.texto, x: i.x ?? 0.5, y: i.y ?? 0.3, tamano: i.tamano ?? 220, duracion: i.duracion ?? 1.6, giro: i.giro ?? -6 });
      break;
    case 'trazo':
      if (i.x === undefined || i.y === undefined) throw new KitError('trazo: indica x e y (0–1) del punto.');
      built = () => T.trazo(fr(), { forma: i.trazo ?? 'flecha', x: i.x!, y: i.y!, x2: i.x2, y2: i.y2, ancho: i.ancho, alto: i.alto, texto: i.texto, color: i.color, duracion: i.duracion ?? 1.8, grosor: i.grosor ?? 14 });
      break;
    case 'grafica':
      if (!i.datos?.length) throw new KitError('grafica: faltan datos [{etiqueta, valor}].');
      built = () => T.grafica(fr(), { forma: i.grafica ?? 'barras', datos: i.datos!, titulo: i.titulo, unidad: i.unidad, posicion: i.posicion ?? 'arriba', duracion: i.duracion ?? 3 });
      break;
    case 'antes_despues': {
      const a = mediaOf(p, i.antes, 'antes');
      const b = mediaOf(p, i.despues, 'despues');
      assets.push({ src: a.abs, name: 'antes' }, { src: b.abs, name: 'despues' });
      built = (r) =>
        T.antesDespues(fr(), { a: { src: r.antes, video: a.video }, b: { src: r.despues, video: b.video }, etiquetaA: i.etiquetaAntes ?? 'ANTES', etiquetaB: i.etiquetaDespues ?? 'DESPUÉS', posicion: i.posicion ?? 'centro', duracion: i.duracion ?? 3 });
      break;
    }
    case 'capitulo':
      if (!i.titulo) throw new KitError('capitulo: falta titulo.');
      built = () => T.capitulo(fr(), { numero: i.numero, titulo: i.titulo!, fondo: i.fondo === 'banda' ? 'banda' : 'solido', duracion: i.duracion ?? 1.1 });
      break;
    case 'texto_kinetico': {
      let palabras = i.palabras ?? [];
      let dur = i.duracion;
      if (i.desdeVideo !== undefined && i.hastaVideo !== undefined) {
        const ws = words.filter((w) => w.s >= i.desdeVideo! - 0.05 && w.s < i.hastaVideo!);
        if (!ws.length) throw new KitError('texto_kinetico: no hay palabras en ese tramo (mira palabras_borrador).');
        palabras = ws.slice(0, 24).map((w) => ({ texto: w.t.replace(/[.,;:]+$/, ''), t: Math.max(0, w.s - i.desdeVideo!) }));
        dur ??= Math.round(Math.min(10, i.hastaVideo - i.desdeVideo + 0.5) * 100) / 100;
      } else if (!palabras.length && i.frase) {
        const ws = i.frase.trim().split(/\s+/).slice(0, 24);
        palabras = ws.map((t, k) => ({ texto: t, t: 0.1 + k * 0.22 }));
      }
      if (!palabras.length) throw new KitError('texto_kinetico: indica desdeVideo/hastaVideo, frase o palabras.');
      const d = dur ?? Math.min(10, palabras[palabras.length - 1].t + 1.2);
      built = () => T.textoKinetico(fr(), { palabras, destacar: i.destacar ?? [], oscurecer: i.oscurecer ?? 0.35, duracion: d, posicion: i.posicion ?? 'centro' });
      break;
    }
    case 'marca': {
      if (!i.marca) throw new KitError('marca: indica el nombre o id (mira marcas).');
      const b = await findBrand(i.marca).catch((e) => {
        throw new KitError(e instanceof Error ? e.message : String(e), 404);
      });
      const logo = await ensureLogo(b).catch(() => null);
      if (logo) assets.push({ src: logo, name: 'logo' });
      titulo = i.fuente ?? b.fuente;
      const bp: T.KitPalette = { primario: b.colores.primario, acento: b.colores.acento, texto: b.colores.texto, fondo: b.colores.primario };
      const modo = i.modo ?? 'cierre';
      built = (r) =>
        T.marca({ ...fr(), pal: bp }, {
          modo,
          nombre: b.nombre,
          logo: r.logo,
          lema: b.lema,
          cta: modo === 'cierre' ? [b.cta, b.usuario].filter(Boolean).join(' ') || undefined : undefined,
          fondo: i.fondo === 'tarjeta' ? 'tarjeta' : i.fondo === 'solido' ? 'solido' : modo === 'intro' ? 'solido' : 'tarjeta',
          duracion: i.duracion ?? (modo === 'intro' ? 1.1 : 2.2),
        });
      break;
    }
    case 'pantalla': {
      const m = mediaOf(p, i.archivo, 'archivo');
      assets.push({ src: m.abs, name: 'pantalla' });
      let d = i.duracion;
      if (!d && m.video) d = Math.min(10, Math.max(1.5, ((await probeVideo(m.abs).catch(() => null))?.duracion ?? 4) - (i.inicioVideo ?? 0)));
      built = (r) =>
        T.pantalla(fr(), { src: r.pantalla, video: m.video, dispositivo: i.dispositivo ?? 'telefono', enfoques: i.enfoques ?? [], inclinacion: i.inclinacion ?? -12, posicion: i.posicion ?? 'centro', duracion: d ?? 4, inicioVideo: i.inicioVideo ?? 0 });
      break;
    }
    default:
      throw new KitError('Tipo de pieza desconocido.');
  }

  // Huella: plantilla + archivos de entrada (ruta, tamaño y fecha)
  const rels: Record<string, string> = {};
  for (const a of assets) rels[a.name] = `assets/${a.name}${path.extname(a.src).toLowerCase()}`;
  const piece = built(rels);
  const stamp = assets.map((a) => {
    const st = fsSync.statSync(a.src);
    return `${a.src}|${st.size}|${st.mtimeMs}`;
  });
  const h = hashOf(piece.html, ...stamp, `${W}x${H}`);
  const outRel = `kit/${i.tipo}-${h}.mov`;
  const outAbs = path.join(/*turbopackIgnore: true*/ p.carpeta, outRel);
  if (fsSync.existsSync(outAbs) && fsSync.statSync(outAbs).size > 0) return { archivo: outRel, duracion: piece.duracion, reutilizado: true };

  const projRel = `kit/_src/${h}`;
  const projDir = path.join(/*turbopackIgnore: true*/ p.carpeta, projRel);
  await fs.rm(projDir, { recursive: true, force: true });
  await fs.mkdir(projDir, { recursive: true });
  for (const a of assets) await addAsset(projDir, a.src, a.name);
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ projDir, 'index.html'), piece.html, 'utf-8');
  const r = await renderCodeVideo(p.carpeta, { proyecto: projRel, salida: outRel, calidad: 'looks', formato: 'mov' });
  return { archivo: outRel, duracion: piece.duracion, reutilizado: false, segundosDeRender: r.segundosDeRender };
}

// ── Zonas de cambio en una grabación de pantalla (18) ───────────────────────

/**
 * Dónde cambia la pantalla: compara fotogramas (5 por segundo, 160×160 en gris) y devuelve los
 * tramos con movimiento, su recuadro (0–1) y un zoom sugerido para los enfoques de «pantalla».
 */
export async function changeZones(file: string, maxSeconds = 120): Promise<Array<{ desde: number; hasta: number; x: number; y: number; w: number; h: number; zoom: number }>> {
  const S = 160;
  const FPS = 5;
  const buf: Buffer = await new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-t', String(maxSeconds), '-i', file, '-vf', `fps=${FPS},scale=${S}:${S},format=gray`, '-f', 'rawvideo', '-'], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new KitError(`No se pudo leer el video: ${err.slice(-200)}`))));
  });
  const N = S * S;
  const frames = Math.floor(buf.length / N);
  const events: Array<{ t: number; x0: number; y0: number; x1: number; y1: number }> = [];
  for (let f = 1; f < frames; f++) {
    let x0 = S, y0 = S, x1 = -1, y1 = -1, count = 0;
    const a = (f - 1) * N;
    const b = f * N;
    for (let k = 0; k < N; k++) {
      if (Math.abs(buf[a + k] - buf[b + k]) > 24) {
        count++;
        const x = k % S;
        const y = (k / S) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (count > N * 0.003) events.push({ t: f / FPS, x0, y0, x1, y1 });
  }
  // Une eventos seguidos (< 0,4 s) en tramos
  const zones: Array<{ desde: number; hasta: number; x0: number; y0: number; x1: number; y1: number }> = [];
  for (const e of events) {
    const last = zones[zones.length - 1];
    if (last && e.t - last.hasta <= 0.4) {
      last.hasta = e.t;
      last.x0 = Math.min(last.x0, e.x0);
      last.y0 = Math.min(last.y0, e.y0);
      last.x1 = Math.max(last.x1, e.x1);
      last.y1 = Math.max(last.y1, e.y1);
    } else zones.push({ desde: Math.max(0, e.t - 1 / FPS), hasta: e.t, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 });
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return zones.slice(0, 40).map((z) => {
    const w = (z.x1 - z.x0 + 1) / S;
    const h = (z.y1 - z.y0 + 1) / S;
    return { desde: r2(z.desde), hasta: r2(z.hasta), x: r2((z.x0 + z.x1 + 1) / 2 / S), y: r2((z.y0 + z.y1 + 1) / 2 / S), w: r2(w), h: r2(h), zoom: r2(Math.min(3, Math.max(1, 0.7 / Math.max(w, h)))) };
  });
}

// ── Portada diseñada (43) ────────────────────────────────────────────────────

/** Recorta a la persona de una imagen con MediaPipe (si está instalado). Devuelve null si no se pudo. */
export async function cutoutPerson(src: string, out: string): Promise<{ ok: boolean; motivo?: string; arriba?: number }> {
  const py = await findPython();
  if (!py) return { ok: false, motivo: 'no hay Python en este PC' };
  const extra = pythonPackageDirs();
  const env = { ...process.env, PYTHONPATH: [...extra, process.env.PYTHONPATH ?? ''].filter(Boolean).join(path.delimiter) };
  const r = await runProcess(py.cmd, [...py.args, pythonScript('lulo_cutout.py'), '--src', src, '--out', out], { timeoutMs: 120_000, env });
  const ok = /^OK(?: TOP ([\d.]+))?/m.exec(r.out);
  if (ok && fsSync.existsSync(out)) return { ok: true, arriba: ok[1] ? Number(ok[1]) : undefined };
  return { ok: false, motivo: /ERROR (.+)/.exec(r.out)?.[1] ?? 'falló el recorte (instala el kit de herramientas de Claude en Edición → Herramientas)' };
}

export async function designCover(
  p: EditProject,
  o: { t: number; texto: string; destacar: string[]; posicion: 'arriba' | 'abajo'; recorte: boolean; paleta?: KitInput['paleta']; fuente?: (typeof KIT_FONTS)[number]; /** Video del que sale el fotograma (por defecto el borrador). */ frame?: string }
): Promise<{ archivo: string; recorte: boolean; aviso?: string }> {
  if (!p.borrador) throw new KitError('Primero renderiza un borrador: la portada sale de un fotograma suyo.');
  const perfil = normalizeProfile(p.perfil);
  const { width: W, height: H } = formatSize(perfil.formato);
  const safe = safeZone(perfil.red, perfil.formato);
  // El video base (sin subtítulos ni gráficos) si se pasa; si no, el borrador
  const draft = path.join(/*turbopackIgnore: true*/ p.carpeta, o.frame ?? p.borrador.archivo);
  const dur = o.frame ? ((await probeVideo(draft).catch(() => null))?.duracion ?? p.borrador.duracion) : p.borrador.duracion;
  const t = Math.max(0, Math.min(dur - 0.1, o.t));
  const h = hashOf(String(p.borrador.version), o.frame ?? '', String(t), o.texto, o.destacar.join(','), o.posicion, String(o.recorte), JSON.stringify(o.paleta ?? p.direccion?.paleta ?? {}), o.fuente ?? '');
  const projRel = `kit/_src/portada-${h}`;
  const projDir = path.join(/*turbopackIgnore: true*/ p.carpeta, projRel);
  await fs.rm(projDir, { recursive: true, force: true });
  await fs.mkdir(path.join(/*turbopackIgnore: true*/ projDir, 'assets'), { recursive: true });
  const bg = path.join(/*turbopackIgnore: true*/ projDir, 'assets', 'fondo.jpg');
  await ffmpeg({ args: ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', draft, '-frames:v', '1', '-q:v', '2', bg] });
  let recorte: string | undefined;
  let aviso: string | undefined;
  let cabeza: number | undefined;
  if (o.recorte) {
    const cut = path.join(/*turbopackIgnore: true*/ projDir, 'assets', 'recorte.png');
    const r = await cutoutPerson(bg, cut);
    if (r.ok) {
      recorte = 'assets/recorte.png';
      cabeza = r.arriba;
    }
    else aviso = `Sin recorte de persona (${r.motivo}): el texto va delante.`;
  }
  const pal = palette(p, perfil, o.paleta);
  const piece = T.portada({ W, H, safe: { top: safe.top, bottom: safe.bottom, right: safe.right }, pal, titulo: o.fuente ?? 'Archivo Black', cuerpo: 'Montserrat' }, { fondo: 'assets/fondo.jpg', recorte, texto: o.texto, destacar: o.destacar, posicion: o.posicion, cabeza });
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ projDir, 'index.html'), piece.html, 'utf-8');
  const tmpRel = `kit/portada-${h}.mp4`;
  await renderCodeVideo(p.carpeta, { proyecto: projRel, salida: tmpRel, calidad: 'delivery', formato: 'mp4' });
  const name = `portada-disenada-v${p.borrador.version}.jpg`;
  await ffmpeg({ args: ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.1', '-i', path.join(/*turbopackIgnore: true*/ p.carpeta, tmpRel), '-frames:v', '1', '-q:v', '2', path.join(/*turbopackIgnore: true*/ p.carpeta, name)] });
  await fs.rm(path.join(/*turbopackIgnore: true*/ p.carpeta, tmpRel), { force: true });
  return { archivo: name, recorte: !!recorte, aviso };
}
