import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import { formatSize, ProfileInputSchema, safeZone, type EditProfile } from '@/config/editor-looks';
import { isInside } from '@/lib/fs/inside';
import { mapTime, type KeptInterval } from './timeline';
import { SFX_TYPES, type SfxType } from './sfx';
import { MUSIC_STYLES, type MusicSection, type MusicStyle } from './music';
import type { FaceTrack } from './advanced';
import type { EditGraphic, EditProject } from './types';

/**
 * Plan de dirección de una edición: TODO lo creativo lo decide Claude y el motor lo ejecuta tal cual
 * (sin reglas mecánicas): movimientos de cámara, transiciones, color, diseño y animación de los
 * subtítulos, palabras clave con efectos, gráficos, imágenes/videos que aparecen mientras se habla
 * (pantalla completa, flotantes o pantalla dividida), efectos de sonido y música por secciones.
 *
 * Claude lo escribe con tiempos del VIDEO FINAL (los de palabras_borrador). Se guarda con tiempos del
 * ORIGINAL para que siga encajando si después cambian los cortes; el render los vuelve a pasar al final.
 */

export const CAMERA_TYPES = ['plano', 'punch', 'acercar', 'alejar', 'paneo', 'sacudida'] as const;
export const TRANSITION_TYPES = ['flash', 'negro', 'glitch', 'desenfoque'] as const;
export const ELEMENT_MODES = ['capa', 'pantalla_completa', 'flotante', 'pantalla_dividida'] as const;
export const ELEMENT_POSITIONS = ['arriba', 'centro', 'abajo', 'arriba_izq', 'arriba_der', 'abajo_izq', 'abajo_der', 'centro_izq', 'centro_der'] as const;
export const ELEMENT_ENTRIES = ['pop', 'deslizar', 'fundido', 'corte'] as const;
export const KEY_EFFECTS = ['ninguno', 'rebote', 'sacudida', 'crecer', 'brillo'] as const;

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
export const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm'];
export const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];

const sec = z.number().min(0).max(3600);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color #RRGGBB');

const CameraSchema = z.object({
  desde: sec,
  hasta: sec,
  tipo: z.enum(CAMERA_TYPES),
  /** Zoom del plano (1 = encuadre normal). */
  zoom: z.number().min(1).max(1.8).default(1.15),
  /** Zoom al terminar (acercar/alejar). */
  zoomFinal: z.number().min(1).max(1.8).optional(),
  /** Centro horizontal (−1 izquierda … 0 la cara … 1 derecha). */
  x: z.number().min(-1).max(1).optional(),
  xFinal: z.number().min(-1).max(1).optional(),
  /** Centro vertical (−1 arriba … 0 la cara … 1 abajo). */
  y: z.number().min(-1).max(1).optional(),
});

const TransitionSchema = z.object({ t: sec, tipo: z.enum(TRANSITION_TYPES), duracion: z.number().min(0.05).max(1.2).default(0.2) });

const ColorSchema = z.object({
  contraste: z.number().min(0.7).max(1.5).default(1),
  saturacion: z.number().min(0).max(1.8).default(1),
  brillo: z.number().min(-0.2).max(0.2).default(0),
  /** −1 frío … 1 cálido. */
  calidez: z.number().min(-1).max(1).default(0),
  vineta: z.number().min(0).max(1).default(0),
  grano: z.number().min(0).max(1).default(0),
});

const SubtitleDesignSchema = ProfileInputSchema.shape.subtitulos.partial().extend({
  /** Sombra (0 = sin sombra, 1–10 = distancia en px). */
  sombra: z.number().min(0).max(10).optional(),
  colorSombra: hex.optional(),
});

const KeywordSchema = z.object({
  palabra: z.string().min(1).max(40),
  /** Solo esa aparición (segundo del video final). Sin t: todas las veces que se diga. */
  t: sec.optional(),
  color: hex.optional(),
  escala: z.number().min(100).max(250).optional(),
  efecto: z.enum(KEY_EFFECTS).default('rebote'),
});

const GraphicSchema = z.object({
  t: sec,
  tipo: z.enum(['tarjeta', 'numero', 'lista', 'detras']),
  titulo: z.string().max(60).default(''),
  texto: z.string().max(160).default(''),
  items: z.array(z.string().max(60)).max(5).default([]),
});

const ElementSchema = z.object({
  desde: sec,
  hasta: sec,
  /** Ruta relativa a la carpeta de la edición (copia ahí lo que venga de la carpeta de material). */
  archivo: z.string().min(1).max(300),
  modo: z.enum(ELEMENT_MODES),
  posicion: z.enum(ELEMENT_POSITIONS).default('centro'),
  /** Ancho respecto al video (flotante). */
  tamano: z.number().min(0.15).max(1).default(0.55),
  entrada: z.enum(ELEMENT_ENTRIES).default('pop'),
  borde: z.boolean().default(false),
  colorBorde: hex.default('#FFFFFF'),
});

/** Paleta del video (la elige Claude para ESTE video; no está atada al perfil). */
const PaletteSchema = z.object({
  /** Color principal (fondos de tarjetas, cajas). */
  primario: hex,
  /** Acento: palabras clave, cifras, checks, bordes destacados. */
  acento: hex,
  /** Segundo acento opcional (contrastes, «antes/después», alertas). */
  secundario: hex.optional(),
  /** Texto principal. */
  texto: hex.default('#FFFFFF'),
  /** Fondo de paneles oscuros/claros. */
  fondo: hex.default('#0B0B0F'),
});

const SoundSchema = z.object({
  t: sec,
  tipo: z.union([z.enum(SFX_TYPES), z.literal('archivo')]),
  /** Con tipo 'archivo': ruta relativa a la carpeta de la edición. */
  archivo: z.string().max(300).optional(),
  /** dB respecto al nivel normal de efectos (−18 … +6). */
  volumen: z.number().min(-18).max(6).default(0),
  pan: z.number().min(-1).max(1).default(0),
});

const MusicSchema = z.object({
  modo: z.enum(['generada', 'archivo', 'ninguna']),
  estilo: z.enum(MUSIC_STYLES).optional(),
  /** Con modo 'archivo': nombre en la carpeta de música o ruta relativa a la carpeta de la edición. */
  archivo: z.string().max(300).optional(),
  /** dB por debajo de la voz (6 fuerte … 30 casi nada). */
  bajoVozDb: z.number().min(6).max(30).default(18),
  /** dB extra que baja mientras se habla. */
  ducking: z.number().min(0).max(15).default(6),
  /** Segundo del archivo desde el que empieza (modo archivo). */
  inicioArchivo: z.number().min(0).max(600).default(0),
  secciones: z.array(z.object({ desde: sec, hasta: sec, energia: z.enum(['silencio', 'suave', 'completa']) })).max(40).default([]),
});

const GanchoSchema = ProfileInputSchema.shape.gancho.partial().extend({ texto: z.string().max(120).optional() });

/** Lo que manda Claude (tiempos del VIDEO FINAL). Cada sección que venga reemplaza a la guardada. */
export const DirectionInputSchema = z.object({
  resumen: z.string().max(2000).optional(),
  /** Concepto creativo: estilo visual, tipografía, ritmo y por qué encaja con este video. */
  concepto: z.string().max(2000).optional(),
  paleta: PaletteSchema.optional(),
  camara: z.array(CameraSchema).max(250).optional(),
  transiciones: z.array(TransitionSchema).max(100).optional(),
  color: ColorSchema.optional(),
  subtitulos: SubtitleDesignSchema.optional(),
  palabrasClave: z.array(KeywordSchema).max(80).optional(),
  gancho: GanchoSchema.optional(),
  graficos: z.array(GraphicSchema).max(30).optional(),
  estiloGraficos: ProfileInputSchema.shape.graficos.unwrap().partial().optional(),
  elementos: z.array(ElementSchema).max(80).optional(),
  sonidos: z.array(SoundSchema).max(400).optional(),
  musica: MusicSchema.optional(),
  /** Nivel base de los efectos: dB por debajo de la voz (8 = muy presentes … 30 = muy suaves). */
  efectosBajoVozDb: z.number().min(8).max(30).optional(),
});
export type DirectionInput = z.infer<typeof DirectionInputSchema>;

/** Plan guardado: la misma forma, con tiempos del ORIGINAL (sin gráficos: van a p.graficos). */
export type EditDirection = Omit<DirectionInput, 'graficos'> & { actualizado: string };

export class DirectionError extends Error {}

// ── Tiempos ──────────────────────────────────────────────────────────────────

/** Instante del final → original. */
export function finalToOriginal(tf: number, intervals: KeptInterval[]): number {
  if (!intervals.length) return tf;
  for (const iv of intervals) {
    const len = iv.e - iv.s;
    if (tf >= iv.out - 1e-6 && tf <= iv.out + len + 1e-6) return iv.s + Math.min(len, Math.max(0, tf - iv.out));
  }
  const last = intervals[intervals.length - 1];
  return tf < 0 ? intervals[0].s : last.e;
}

/** Instante del original → final; si cayó en un corte, el inicio del siguiente tramo que sí entra. */
export function originalToFinal(t: number, intervals: KeptInterval[], total: number): number {
  const m = mapTime(t, intervals);
  if (m !== null) return m;
  const next = intervals.find((iv) => iv.s > t);
  return next ? next.out : total;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function mapTimes<T extends object>(obj: T, fn: (t: number) => number, keys: string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) if (typeof out[k] === 'number') out[k] = r2(fn(out[k] as number));
  return out as T;
}

const TIME_KEYS = ['desde', 'hasta', 't'];

/** Convierte todas las marcas de tiempo del plan con `fn`. */
function convert<T extends Omit<DirectionInput, 'graficos'>>(d: T, fn: (t: number) => number): T {
  const m = <X extends object>(xs?: X[]) => xs?.map((x) => mapTimes(x, fn, TIME_KEYS));
  return {
    ...d,
    camara: m(d.camara),
    transiciones: m(d.transiciones),
    palabrasClave: m(d.palabrasClave),
    elementos: m(d.elementos),
    sonidos: m(d.sonidos),
    musica: d.musica ? { ...d.musica, secciones: m(d.musica.secciones) ?? [] } : undefined,
  };
}

/** El plan en tiempos del video final con los cortes actuales (para ver_edicion y el render). */
export function directionInFinal(d: EditDirection, intervals: KeptInterval[], total: number): EditDirection {
  return convert(d, (t) => originalToFinal(t, intervals, total));
}

// ── Guardar ──────────────────────────────────────────────────────────────────

/** Ruta de un archivo de la edición (dentro de su carpeta). */
export function editAsset(carpeta: string, rel: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ carpeta, rel);
  if (!isInside(carpeta, abs) || abs === path.resolve(/*turbopackIgnore: true*/ carpeta)) throw new DirectionError(`${rel}: tiene que estar dentro de la carpeta de la edición (cópialo antes).`);
  return abs;
}

function checkFile(carpeta: string, rel: string, exts: string[], what: string, musicLibrary?: string): string[] {
  const ext = path.extname(rel).toLowerCase();
  if (!exts.includes(ext)) return [`${what} «${rel}»: formato no admitido (${exts.join(', ')}).`];
  if (musicLibrary && !rel.includes('/') && !rel.includes('\\') && fsSync.existsSync(path.join(/*turbopackIgnore: true*/ musicLibrary, rel))) return [];
  try {
    if (!fsSync.existsSync(editAsset(carpeta, rel))) return [`${what} «${rel}» no existe en la carpeta de la edición.`];
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
  return [];
}

/**
 * Valida el plan que manda Claude (tiempos finales) y lo deja listo para guardar: tiempos del
 * original y los gráficos como EditGraphic anclados a su palabra. Lanza DirectionError con todos
 * los problemas juntos (Claude los corrige de una vez).
 */
export function prepareDirection(
  p: EditProject,
  input: DirectionInput,
  intervals: KeptInterval[],
  total: number,
  previous: EditDirection | undefined,
  musicLibrary: string
): { direccion: EditDirection; graficos?: EditGraphic[]; avisos: string[] } {
  const problems: string[] = [];
  const avisos: string[] = [];
  const within = (t: number, what: string) => {
    if (t > total + 0.05) problems.push(`${what}: ${t.toFixed(2)} s está después del final (${total.toFixed(2)} s).`);
  };
  const range = (a: number, b: number, what: string) => {
    if (b <= a + 0.05) problems.push(`${what}: «hasta» (${b}) tiene que ser mayor que «desde» (${a}).`);
    within(a, what);
  };
  input.camara?.forEach((c, i) => range(c.desde, c.hasta, `camara[${i}]`));
  input.transiciones?.forEach((c, i) => within(c.t, `transiciones[${i}]`));
  input.elementos?.forEach((e, i) => {
    range(e.desde, e.hasta, `elementos[${i}]`);
    const ext = path.extname(e.archivo).toLowerCase();
    problems.push(...checkFile(p.carpeta, e.archivo, [...IMAGE_EXT, ...VIDEO_EXT], `elementos[${i}]`));
    if (!IMAGE_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) return;
  });
  input.sonidos?.forEach((s, i) => {
    within(s.t, `sonidos[${i}]`);
    if (s.tipo === 'archivo') {
      if (!s.archivo) problems.push(`sonidos[${i}]: con tipo «archivo» falta «archivo».`);
      else problems.push(...checkFile(p.carpeta, s.archivo, AUDIO_EXT, `sonidos[${i}]`));
    }
  });
  if (input.musica) {
    const m = input.musica;
    if (m.modo === 'generada' && !m.estilo) problems.push('musica: con modo «generada» elige un «estilo».');
    if (m.modo === 'archivo') {
      if (!m.archivo) problems.push('musica: con modo «archivo» falta «archivo».');
      else problems.push(...checkFile(p.carpeta, m.archivo, AUDIO_EXT, 'musica', musicLibrary));
    }
    m.secciones.forEach((s, i) => range(s.desde, s.hasta, `musica.secciones[${i}]`));
  }
  input.graficos?.forEach((g, i) => within(g.t, `graficos[${i}]`));
  // Cámara: los tramos no se pueden pisar (el motor no sabría cuál aplicar)
  const cams = [...(input.camara ?? [])].sort((a, b) => a.desde - b.desde);
  for (let i = 1; i < cams.length; i++) {
    if (cams[i].desde < cams[i - 1].hasta - 0.01) problems.push(`camara: el tramo ${cams[i - 1].desde}–${cams[i - 1].hasta} pisa al ${cams[i].desde}–${cams[i].hasta}. Usa tramos seguidos sin solaparse.`);
  }
  if (problems.length) throw new DirectionError(problems.slice(0, 25).join('\n'));

  const toOrig = (t: number) => finalToOriginal(t, intervals);
  const { graficos: gIn, ...rest } = input;
  const converted = convert(rest, toOrig);
  const direccion: EditDirection = { ...(previous ?? {}), actualizado: new Date().toISOString() };
  for (const [k, v] of Object.entries(converted)) if (v !== undefined) (direccion as Record<string, unknown>)[k] = v;

  let graficos: EditGraphic[] | undefined;
  if (gIn) {
    graficos = [];
    const kept = p.frases.filter((f) => !f.cortar && f.palabras.length);
    gIn.forEach((g, i) => {
      const to = toOrig(g.t);
      let best: { f: (typeof kept)[number]; w: (typeof kept)[number]['palabras'][number]; d: number } | null = null;
      for (const f of kept) for (const w of f.palabras) {
        const d = Math.abs(w.s - to);
        if (!best || d < best.d) best = { f, w, d };
      }
      if (!best) return;
      graficos!.push({ id: `g${i + 1}`, tipo: g.tipo, fraseId: best.f.id, palabra: best.w.t, t: best.w.s, titulo: g.titulo, texto: g.texto, items: g.items, activo: true });
    });
    if (graficos.length < gIn.length) avisos.push('Algún gráfico no encontró palabra a la que anclarse y se quitó.');
  }
  return { direccion, graficos, avisos };
}

// ── Perfil efectivo ──────────────────────────────────────────────────────────

/**
 * El perfil con el que se renderiza una edición dirigida: diseño de subtítulos, gancho y gráficos
 * del plan; sin el zoom alterno mecánico ni los efectos automáticos (los pone el plan).
 */
export function directedProfile(perfil: EditProfile, d: EditDirection): EditProfile {
  // La paleta de Claude manda sobre los colores del perfil; lo que ponga explícito en cada sección, más
  const pal = d.paleta;
  const fromPalette = pal
    ? {
        sub: { colorResaltado: pal.acento, colorTexto: pal.texto, colorCaja: pal.primario },
        gancho: { colorFondo: pal.acento, colorTexto: textOnColor(pal.acento) },
        graficos: { colorFondo: pal.fondo, colorBorde: pal.acento, colorAcento: pal.acento, colorTexto: pal.texto },
      }
    : { sub: {}, gancho: {}, graficos: {} };
  const sub = { ...perfil.subtitulos, ...fromPalette.sub, ...stripExtras(d.subtitulos ?? {}) };
  return {
    ...perfil,
    subtitulos: sub,
    gancho: { ...perfil.gancho, ...fromPalette.gancho, ...omitText(d.gancho ?? {}) },
    graficos: { ...perfil.graficos, ...fromPalette.graficos, ...(d.estiloGraficos ?? {}) },
    ritmo: { ...perfil.ritmo, zoomEnCortes: false, zoomSuave: false },
    sonido: {
      ...perfil.sonido,
      efectos: true,
      efectosGancho: false,
      efectosCortes: false,
      efectosGraficos: false,
      efectosBajoVozDb: d.efectosBajoVozDb ?? perfil.sonido.efectosBajoVozDb,
    },
  };
}

/** Negro o blanco según qué se lea mejor sobre ese color. */
function textOnColor(hexColor: string): string {
  const h = hexColor.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#000000' : '#FFFFFF';
}

function stripExtras(s: NonNullable<EditDirection['subtitulos']>) {
  const { sombra: _s, colorSombra: _c, ...rest } = s;
  void _s;
  void _c;
  return rest;
}
function omitText(g: NonNullable<EditDirection['gancho']>) {
  const { texto: _t, ...rest } = g;
  void _t;
  return rest;
}

// ── Render: filtros de FFmpeg ────────────────────────────────────────────────

const f4 = (n: number) => n.toFixed(4);

/** Centro medio de la cara (0–1) para encuadrar los acercamientos; sin detector, el tercio superior. */
export function faceCenter(track: FaceTrack | null): { x: number; y: number } {
  const frames = track?.frames.filter((f): f is NonNullable<typeof f> => !!f) ?? [];
  if (!frames.length) return { x: 0.5, y: 0.36 };
  const xs = frames.map((f) => f.x + f.w / 2).sort((a, b) => a - b);
  const ys = frames.map((f) => f.y + f.h / 2).sort((a, b) => a - b);
  return { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
}

/**
 * Cámara virtual con zoompan sobre el video al doble de tamaño (movimientos sin temblor).
 * z(T), centro x(T) e y(T) por tramos; fuera de los tramos, encuadre normal (zoom 1).
 */
export function cameraFilter(cams: NonNullable<EditDirection['camara']>, W: number, H: number, fps: number, face: { x: number; y: number }): string | null {
  const list = cams.filter((c) => c.hasta > c.desde + 0.04);
  if (!list.length) return null;
  const T = `(on/${fps})`;
  const gate = (a: number, b: number) => `gte(${T},${f4(a)})*lt(${T},${f4(b)})`;
  const smooth = (a: number, b: number) => `(clip((${T}-${f4(a)})/${f4(Math.max(0.05, b - a))},0,1)*clip((${T}-${f4(a)})/${f4(Math.max(0.05, b - a))},0,1)*(3-2*clip((${T}-${f4(a)})/${f4(Math.max(0.05, b - a))},0,1)))`;
  const zTerms: string[] = [];
  const xTerms: string[] = [];
  const yTerms: string[] = [];
  const sTerms: string[] = [];
  const fx = (v: number | undefined) => (v === undefined ? face.x : Math.min(0.92, Math.max(0.08, face.x + v * 0.4)));
  const fy = (v: number | undefined) => (v === undefined ? face.y : Math.min(0.9, Math.max(0.1, face.y + v * 0.4)));
  for (const c of list) {
    const a = c.desde;
    const b = c.hasta;
    let z: string;
    switch (c.tipo) {
      case 'acercar':
        z = `(${f4(c.zoom)}+(${f4(c.zoomFinal ?? Math.min(1.8, c.zoom + 0.15))}-${f4(c.zoom)})*${smooth(a, b)})`;
        break;
      case 'alejar':
        z = `(${f4(c.zoom)}+(${f4(c.zoomFinal ?? 1)}-${f4(c.zoom)})*${smooth(a, b)})`;
        break;
      case 'punch':
        z = `(1+(${f4(c.zoom)}-1)*${smooth(a, Math.min(b, a + 0.12))})`;
        break;
      default:
        z = f4(c.zoom);
    }
    zTerms.push(`${gate(a, b)}*(${z}-1)`);
    const x0 = fx(c.x);
    const x1 = c.tipo === 'paneo' ? fx(c.xFinal ?? -(c.x ?? 0.5)) : x0;
    const xe = c.tipo === 'paneo' ? `(${f4(x0)}+(${f4(x1)}-${f4(x0)})*${smooth(a, b)})` : f4(x0);
    xTerms.push(`${gate(a, b)}*(${xe}-${f4(face.x)})`);
    yTerms.push(`${gate(a, b)}*(${f4(fy(c.y))}-${f4(face.y)})`);
    if (c.tipo === 'sacudida') sTerms.push(`${gate(a, b)}*exp(-(${T}-${f4(a)})*6)`);
  }
  const Z = `(1+${zTerms.join('+')})`;
  const FX = `(${f4(face.x)}+${xTerms.join('+')})`;
  const FY = `(${f4(face.y)}+${yTerms.join('+')})`;
  const shake = sTerms.length ? `(${sTerms.join('+')})` : '0';
  const x = `clip(${FX}*iw-iw/zoom/2+${shake}*iw*0.012*sin(${T}*53),0,iw-iw/zoom)`;
  const y = `clip(${FY}*ih-ih/zoom/2+${shake}*ih*0.008*cos(${T}*61),0,ih-ih/zoom)`;
  return `scale=${W * 2}:${H * 2}:flags=bicubic,zoompan=z='${Z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps},setsar=1`;
}

/**
 * Color de la toma (`grade`: contraste, saturación, brillo, temperatura, viñeta, grano) y efectos de
 * transición sobre todo el cuadro (`fx`: destellos, fundidos a negro, glitch, desenfoque).
 */
export function colorFilter(color: EditDirection['color'], trans: NonNullable<EditDirection['transiciones']>): { grade: string | null; fx: string | null } {
  const grade: string[] = [];
  const c = color;
  if (c && (Math.abs(c.contraste - 1) > 0.005 || Math.abs(c.saturacion - 1) > 0.005 || Math.abs(c.brillo) > 0.005)) {
    grade.push(`eq=contrast=${f4(c.contraste)}:saturation=${f4(c.saturacion)}:brightness=${f4(c.brillo)}`);
  }
  if (c && Math.abs(c.calidez) > 0.01) {
    const k = c.calidez * 0.12;
    grade.push(`colorbalance=rs=${f4(k)}:gs=${f4(k * 0.2)}:bs=${f4(-k)}:rm=${f4(k * 0.6)}:bm=${f4(-k * 0.6)}`);
  }
  if (c && c.vineta > 0.01) grade.push(`vignette=angle=${f4(0.2 + c.vineta * 0.45)}`);
  if (c && c.grano > 0.01) grade.push(`noise=alls=${Math.round(4 + c.grano * 14)}:allf=t`);

  const fx: string[] = [];
  const flashes = trans
    .filter((t) => t.tipo === 'flash' || t.tipo === 'negro')
    .map((t) => {
      const d = t.duracion;
      const a = Math.max(0, t.t - d / 2);
      const amp = t.tipo === 'flash' ? 0.55 : -1;
      // Triángulo centrado en t: sube y baja
      return `${amp}*gte(t,${f4(a)})*lte(t,${f4(a + d)})*(1-abs(t-${f4(t.t)})/${f4(d / 2)})`;
    });
  if (flashes.length) fx.push(`eq=brightness='${flashes.join('+')}':eval=frame`);
  const glitches = trans.filter((t) => t.tipo === 'glitch');
  if (glitches.length) {
    const en = glitches.map((t) => `between(t,${f4(t.t - t.duracion / 2)},${f4(t.t + t.duracion / 2)})`).join('+');
    fx.push(`rgbashift=rh=22:bh=-22:gv=8:enable='${en}'`);
  }
  const blurs = trans.filter((t) => t.tipo === 'desenfoque');
  if (blurs.length) {
    const en = blurs.map((t) => `between(t,${f4(t.t - t.duracion / 2)},${f4(t.t + t.duracion / 2)})`).join('+');
    fx.push(`gblur=sigma=18:enable='${en}'`);
  }
  return { grade: grade.length ? grade.join(',') : null, fx: fx.length ? fx.join(',') : null };
}

export interface ResolvedElement {
  abs: string;
  desde: number;
  hasta: number;
  modo: (typeof ELEMENT_MODES)[number];
  posicion: (typeof ELEMENT_POSITIONS)[number];
  tamano: number;
  entrada: (typeof ELEMENT_ENTRIES)[number];
  borde: boolean;
  colorBorde: string;
  esImagen: boolean;
}

/** Entradas de FFmpeg (args) y cadena de overlays para los elementos, sobre [inLabel] → [outLabel]. */
export function elementsFilter(
  els: ResolvedElement[],
  firstInput: number,
  inLabel: string,
  outLabel: string,
  perfil: EditProfile,
  fps: number,
  /** Centro vertical de la cara (0–1): en pantalla dividida la persona se encuadra en su mitad. */
  faceY = 0.36
): { inputs: string[]; graph: string[] } {
  const { width: W, height: H } = formatSize(perfil.formato);
  const safe = safeZone(perfil.red, perfil.formato);
  const inputs: string[] = [];
  const graph: string[] = [];
  let cur = inLabel;
  els.forEach((e, i) => {
    const idx = firstInput + i;
    const len = e.hasta - e.desde + 0.3;
    if (e.esImagen) inputs.push('-loop', '1', '-framerate', String(fps), '-t', len.toFixed(3), '-i', e.abs);
    else {
      if (path.extname(e.abs).toLowerCase() === '.webm') inputs.push('-c:v', 'libvpx-vp9');
      inputs.push('-i', e.abs);
    }
    let size: string;
    let x: string;
    let y: string;
    const sideX = (p: string) => (p.endsWith('_izq') ? '80' : p.endsWith('_der') ? `main_w-overlay_w-${safe.right + 20}` : '(main_w-overlay_w)/2');
    const sideY = (p: string) => (p.startsWith('arriba') ? `${safe.top + 40}` : p.startsWith('abajo') ? `main_h-overlay_h-${safe.bottom + 40}` : '(main_h-overlay_h)/2');
    if (e.modo === 'capa') {
      // Gráfico a pantalla completa con transparencia (HyperFrames .mov/.webm a 1080×1920): se ve el video debajo
      size = `scale=${W}:${H}`;
      x = '0';
      y = '0';
    } else if (e.modo === 'pantalla_completa') {
      size = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
      x = '0';
      y = '0';
    } else if (e.modo === 'pantalla_dividida') {
      const hh = Math.round(H / 4) * 2;
      const assetTop = e.posicion.startsWith('arriba');
      size = `scale=${W}:${hh}:force_original_aspect_ratio=increase,crop=${W}:${hh}`;
      x = '0';
      y = assetTop ? '0' : `${H - hh}`;
      // La persona NO queda tapada: se encuadra su cara en la otra mitad
      const y0 = Math.round(Math.min(H - hh, Math.max(0, faceY * H - hh * 0.42)));
      graph.push(`[${cur}]split=2[sb${i}][ss${i}]`);
      graph.push(`[ss${i}]crop=${W}:${hh}:0:${y0},setsar=1[sh${i}]`);
      graph.push(`[sb${i}][sh${i}]overlay=x=0:y=${assetTop ? H - hh : 0}:enable='between(t,${f4(e.desde)},${f4(e.hasta)})'[sp${i}]`);
      cur = `sp${i}`;
    } else {
      const w = Math.round((e.tamano * W) / 2) * 2;
      const b = e.borde ? 8 : 0;
      size = `scale=${w - b * 2}:-2${b ? `,pad=iw+${b * 2}:ih+${b * 2}:${b}:${b}:color=${e.colorBorde.replace('#', '0x')}` : ''}`;
      x = sideX(e.posicion);
      y = sideY(e.posicion);
    }
    const a = e.desde;
    const fin = e.hasta;
    const dIn = e.entrada === 'pop' ? 0.1 : e.entrada === 'fundido' ? 0.25 : e.entrada === 'deslizar' ? 0.12 : 0;
    const fades = `${dIn ? `,fade=t=in:st=${f4(a)}:d=${f4(dIn)}:alpha=1` : ''},fade=t=out:st=${f4(Math.max(a, fin - 0.15))}:d=0.15:alpha=1`;
    // Un video más corto que su ventana se congela en su último fotograma (si no, en un split quedaba
    // la persona recortada sobre sí misma al acabarse el clip)
    const hold = e.esImagen ? '' : `tpad=stop_mode=clone:stop_duration=${f4(len)},`;
    graph.push(`[${idx}:v]${hold}setpts=PTS-STARTPTS+${f4(a)}/TB,${size},format=rgba${fades},setsar=1[el${i}]`);
    // Movimiento de entrada: el pop sube 70 px con rebote; deslizar entra desde el lado
    const p = `clip((t-${f4(a)})/0.22,0,1)`;
    if (e.entrada === 'pop') y = `${y}+70*pow(1-${p},3)`;
    if (e.entrada === 'deslizar') x = `${x}+main_w*pow(1-clip((t-${f4(a)})/0.28,0,1),3)`;
    const next = i === els.length - 1 ? outLabel : `ov${i}`;
    graph.push(`[${cur}][el${i}]overlay=x='${x}':y='${y}':eof_action=pass:enable='between(t,${f4(a)},${f4(fin)})'[${next}]`);
    cur = next;
  });
  if (!els.length) graph.push(`[${inLabel}]null[${outLabel}]`);
  return { inputs, graph };
}

export interface ResolvedDirection {
  camara: NonNullable<EditDirection['camara']>;
  transiciones: NonNullable<EditDirection['transiciones']>;
  color?: EditDirection['color'];
  elementos: ResolvedElement[];
  sonidos: Array<{ t: number; tipo: SfxType | 'archivo'; abs?: string; volumen: number; pan: number }>;
  musica?: { modo: 'generada' | 'archivo' | 'ninguna'; estilo?: MusicStyle; abs?: string; bajoVozDb: number; ducking: number; inicioArchivo: number; secciones: MusicSection[] };
  palabrasClave: NonNullable<EditDirection['palabrasClave']>;
  /** Ventanas con pantalla dividida (los subtítulos van al centro, sobre la unión). */
  divididas: Array<[number, number]>;
  sombra?: { px: number; color: string };
}

/** El plan listo para el render: tiempos del final y rutas absolutas. */
export function resolveDirection(p: EditProject, d: EditDirection, intervals: KeptInterval[], total: number, musicLibrary: string): ResolvedDirection {
  const f = directionInFinal(d, intervals, total);
  const clampR = <X extends { desde: number; hasta: number }>(xs: X[] = []) =>
    xs.map((x) => ({ ...x, desde: Math.max(0, x.desde), hasta: Math.min(total, x.hasta) })).filter((x) => x.hasta > x.desde + 0.05);
  const elementos: ResolvedElement[] = [];
  for (const e of clampR(f.elementos)) {
    let abs: string;
    try {
      abs = editAsset(p.carpeta, e.archivo);
    } catch {
      continue;
    }
    if (!fsSync.existsSync(abs)) continue;
    elementos.push({ ...e, abs, esImagen: IMAGE_EXT.includes(path.extname(abs).toLowerCase()) });
  }
  const sonidos: ResolvedDirection['sonidos'] = [];
  for (const s of f.sonidos ?? []) {
    if (s.t >= total - 0.05) continue;
    if (s.tipo === 'archivo') {
      try {
        const abs = editAsset(p.carpeta, s.archivo ?? '');
        if (fsSync.existsSync(abs)) sonidos.push({ t: s.t, tipo: 'archivo', abs, volumen: s.volumen, pan: s.pan });
      } catch {
        // archivo fuera de la carpeta: se ignora
      }
    } else sonidos.push({ t: s.t, tipo: s.tipo, volumen: s.volumen, pan: s.pan });
  }
  let musica: ResolvedDirection['musica'];
  if (f.musica) {
    const m = f.musica;
    let abs: string | undefined;
    if (m.modo === 'archivo' && m.archivo) {
      const lib = path.join(/*turbopackIgnore: true*/ musicLibrary, path.basename(m.archivo));
      if (!m.archivo.includes('/') && !m.archivo.includes('\\') && fsSync.existsSync(lib)) abs = lib;
      else {
        try {
          const cand = editAsset(p.carpeta, m.archivo);
          if (fsSync.existsSync(cand)) abs = cand;
        } catch {
          abs = undefined;
        }
      }
    }
    musica = { modo: m.modo, estilo: m.estilo, abs, bajoVozDb: m.bajoVozDb, ducking: m.ducking, inicioArchivo: m.inicioArchivo, secciones: clampR(m.secciones) };
  }
  const sub = d.subtitulos;
  return {
    camara: clampR(f.camara).sort((a, b) => a.desde - b.desde),
    transiciones: (f.transiciones ?? []).filter((t) => t.t <= total),
    color: f.color,
    elementos: elementos.sort((a, b) => a.desde - b.desde),
    sonidos,
    musica,
    palabrasClave: f.palabrasClave ?? [],
    divididas: elementos.filter((e) => e.modo === 'pantalla_dividida').map((e) => [e.desde, e.hasta] as [number, number]),
    sombra: sub?.sombra ? { px: sub.sombra, color: sub.colorSombra ?? '#000000' } : undefined,
  };
}

/** Resumen corto del plan para notas, actividad y el chat. */
export function describeDirection(d: EditDirection, graficos?: number): string {
  const n = (x?: unknown[]) => x?.length ?? 0;
  const parts = [
    `${n(d.camara)} movimientos de cámara`,
    `${n(d.sonidos)} efectos de sonido`,
    `${n(d.elementos)} elementos visuales`,
    `${n(d.transiciones)} transiciones`,
    `${n(d.palabrasClave)} palabras clave`,
  ];
  if (graficos) parts.push(`${graficos} gráficos`);
  if (d.musica) parts.push(d.musica.modo === 'generada' ? `música ${d.musica.estilo}` : d.musica.modo === 'archivo' ? `música: ${d.musica.archivo}` : 'sin música');
  if (d.subtitulos?.estilo) parts.push(`subtítulos «${d.subtitulos.estilo}»`);
  if (d.color) parts.push('color');
  return parts.join(' · ');
}

// ── Ritmo y equilibrio ───────────────────────────────────────────────────────

/**
 * Presupuesto de formatos de un video corto con persona a cámara. Se lo damos a Claude como guía y
 * comprobamos el plan contra él (dirigir_edicion devuelve los avisos para que corrija antes de renderizar).
 */
export const RHYTHM_BUDGET = {
  /** Tiempo máximo con pantalla dividida (fracción del video). */
  splitMax: 0.3,
  /** Tiempo máximo con algo a pantalla completa tapando a la persona. */
  completaMax: 0.2,
  /** Tiempo mínimo con la persona sola (con cámara y subtítulos, sin elementos encima). */
  personaMin: 0.35,
  /** Duración máxima de cada ayuda visual (s) según su modo. */
  maxSeg: { capa: 4.5, flotante: 4.5, pantalla_completa: 4, pantalla_dividida: 7 } as Record<(typeof ELEMENT_MODES)[number], number>,
  /** Ningún tramo más largo que esto sin un cambio visual (cámara, elemento, gráfico, transición). */
  sinCambioMax: 3.5,
  /** Efectos de sonido por segundo: mínimo y máximo razonables. */
  sfxPorSegundo: [0.3, 1.4] as [number, number],
};

export interface RhythmReport {
  duracion: number;
  porcentaje: { personaSola: number; pantallaDividida: number; pantallaCompleta: number; capas: number; flotantes: number };
  cambiosVisuales: number;
  segundosPorCambio: number;
  tramoMasLargoSinCambio: { desde: number; hasta: number; segundos: number };
  efectosPorSegundo: number;
  presupuesto: typeof RHYTHM_BUDGET;
  avisos: string[];
}

/** Analiza el plan (tiempos del video FINAL) contra el presupuesto de ritmo. */
export function analyzeRhythm(
  d: Pick<DirectionInput, 'camara' | 'elementos' | 'transiciones' | 'sonidos'>,
  graphicStarts: number[],
  total: number,
  subtituloPx?: number
): RhythmReport {
  const B = RHYTHM_BUDGET;
  const els = d.elementos ?? [];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  // Cobertura por modo (unión de intervalos)
  const cover = (modes: string[]) => {
    const iv = els.filter((e) => modes.includes(e.modo)).map((e) => [Math.max(0, e.desde), Math.min(total, e.hasta)] as [number, number]).sort((a, b) => a[0] - b[0]);
    let sum = 0;
    let cur: [number, number] | null = null;
    for (const x of iv) {
      if (!cur || x[0] > cur[1]) {
        if (cur) sum += cur[1] - cur[0];
        cur = [...x] as [number, number];
      } else cur[1] = Math.max(cur[1], x[1]);
    }
    if (cur) sum += cur[1] - cur[0];
    return total > 0 ? sum / total : 0;
  };
  const pct = (x: number) => Math.round(x * 100);
  const split = cover(['pantalla_dividida']);
  const completa = cover(['pantalla_completa']);
  const capas = cover(['capa']);
  const flot = cover(['flotante']);
  const anything = cover(['pantalla_dividida', 'pantalla_completa', 'capa', 'flotante']);
  const persona = 1 - anything;

  // Cambios visuales
  const marks = new Set<number>([0, total]);
  for (const c of d.camara ?? []) {
    marks.add(r1(c.desde));
    if (c.tipo !== 'plano') marks.add(r1((c.desde + c.hasta) / 2));
  }
  for (const e of els) {
    marks.add(r1(e.desde));
    marks.add(r1(e.hasta));
  }
  for (const t of d.transiciones ?? []) marks.add(r1(t.t));
  for (const g of graphicStarts) marks.add(r1(g));
  const sorted = [...marks].filter((t) => t >= 0 && t <= total).sort((a, b) => a - b);
  let longest = { desde: 0, hasta: total, segundos: total };
  let best = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > best) {
      best = gap;
      longest = { desde: sorted[i - 1], hasta: sorted[i], segundos: r1(gap) };
    }
  }
  const cambios = Math.max(0, sorted.length - 2);
  const sfx = (d.sonidos ?? []).length / Math.max(1, total);

  const avisos: string[] = [];
  if (split > B.splitMax) avisos.push(`Demasiada pantalla dividida: ${pct(split)} % del video (máximo ${pct(B.splitMax)} %). Cansa: reserva el split para comparar o demostrar y alterna con persona sola, capas y flotantes.`);
  if (completa > B.completaMax) avisos.push(`Demasiado tiempo a pantalla completa tapando a la persona: ${pct(completa)} % (máximo ${pct(B.completaMax)} %).`);
  if (persona < B.personaMin) avisos.push(`La persona sola (sin nada encima) solo ocupa ${pct(persona)} % (mínimo ${pct(B.personaMin)} %): deja respirar con cambios de cámara y subtítulos.`);
  for (const e of els) {
    const dur = e.hasta - e.desde;
    const max = B.maxSeg[e.modo];
    if (dur > max) avisos.push(`El elemento «${e.archivo}» (${e.modo}) dura ${r1(dur)} s (máximo ${max} s): las ayudas viven lo que dura la idea; pártelo en varias o cámbialo de formato.`);
  }
  // Mismo formato 3 veces seguidas sin respiro
  const seq = [...els].sort((a, b) => a.desde - b.desde);
  for (let i = 2; i < seq.length; i++) {
    if (seq[i].modo === seq[i - 1].modo && seq[i - 1].modo === seq[i - 2].modo && seq[i].desde - seq[i - 2].hasta < 6) {
      avisos.push(`Tres «${seq[i].modo}» seguidos (${r1(seq[i - 2].desde)}–${r1(seq[i].hasta)} s): varía el formato.`);
      break;
    }
  }
  if (longest.segundos > B.sinCambioMax) avisos.push(`De ${longest.desde} a ${longest.hasta} s (${longest.segundos} s) no cambia nada en pantalla (máximo ${B.sinCambioMax} s): añade un cambio de cámara, una palabra clave, un elemento o un gráfico.`);
  for (const c of d.camara ?? []) {
    if (c.tipo === 'plano' && c.hasta - c.desde > 5) avisos.push(`Plano fijo de ${r1(c.hasta - c.desde)} s (${r1(c.desde)}–${r1(c.hasta)} s): muévelo (acercar/alejar/paneo) o pártelo en dos ángulos.`);
  }
  if (sfx < B.sfxPorSegundo[0]) avisos.push(`Pocos efectos de sonido (${sfx.toFixed(2)}/s): cada evento visual lleva su sonido.`);
  if (sfx > B.sfxPorSegundo[1]) avisos.push(`Demasiados efectos de sonido (${sfx.toFixed(2)}/s): satura; deja solo los que acompañan un evento.`);
  if (subtituloPx !== undefined && subtituloPx < 64) avisos.push(`Subtítulos pequeños (${subtituloPx} px): en vertical usa 72–100 px para que se lean en el móvil.`);

  return {
    duracion: r1(total),
    porcentaje: { personaSola: pct(persona), pantallaDividida: pct(split), pantallaCompleta: pct(completa), capas: pct(capas), flotantes: pct(flot) },
    cambiosVisuales: cambios,
    segundosPorCambio: cambios ? r1(total / cambios) : r1(total),
    tramoMasLargoSinCambio: longest,
    efectosPorSegundo: Math.round(sfx * 100) / 100,
    presupuesto: B,
    avisos,
  };
}
