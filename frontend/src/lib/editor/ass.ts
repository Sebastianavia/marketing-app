import { formatSize, safeZone, type EditProfile } from '@/config/editor-looks';
import { chunkWords, type SubWord } from './timeline';

/**
 * Subtítulos en formato ASS (los quema FFmpeg con libass).
 * Tres estilos: karaoke (se pinta la palabra que suena), palabra a palabra y frase fija.
 * El texto gancho va arriba los primeros segundos.
 */

/** #RRGGBB → &HAABBGGRR (alpha 00 = opaco). */
export function assColor(hex: string, alpha = 0): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? 'FFFFFF';
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const aa = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `&H${aa}${bb}${gg}${rr}`.toUpperCase();
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Quita lo que ASS interpreta como código ({…} y barras invertidas). */
function escapeText(t: string): string {
  return t.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\r?\n/g, ' ');
}

/** Para comparar palabras clave sin tildes, mayúsculas ni puntuación. */
export function normalizeWord(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export interface AssInput {
  perfil: EditProfile;
  words: SubWord[];
  gancho: string;
  resaltar: string[];
  duracionFinal: number;
  /** Eventos de gráficos ya armados (estilo "Card"). */
  graficos?: string[];
  /** Ventanas sin subtítulos (mientras se ve un gráfico). */
  ocultar?: Array<[number, number]>;
  /** Estilo "Card" (de graphics.ts). */
  cardStyle?: string;
  /** Margen inferior/superior de los subtítulos calculado según la cara (si no, el del perfil). */
  marginV?: number;
}

/** Margen vertical por defecto de los subtítulos (para saber si chocan con la cara). */
export function defaultSubMargin(perfil: EditProfile): number {
  const { height } = formatSize(perfil.formato);
  const safe = safeZone(perfil.red, perfil.formato);
  const sub = perfil.subtitulos;
  return sub.posicion === 'abajo'
    ? Math.max(Math.round(height * 0.2), safe.bottom + 40)
    : sub.posicion === 'arriba'
      ? Math.max(Math.round(height * 0.17), safe.top + 40)
      : 0;
}

export interface AssResult {
  ass: string;
  /** Líneas de subtítulo, la más corta (s) y cuántas duran menos de 0,4 s. */
  lineas: number;
  minSeg: number;
  cortas: number;
}

/** Mínimo en pantalla de cada línea de subtítulo (guía: nunca menos de 0,4 s). */
export const MIN_CAPTION_SEC = 0.4;

/**
 * Une líneas que durarían menos de 0,4 s con la siguiente de la misma frase
 * (si cabe una palabra más), para que dé tiempo a leerlas.
 */
function mergeShort(chunks: SubWord[][], max: number): SubWord[][] {
  const out: SubWord[][] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if (
      last &&
      last[0].frase === c[0].frase &&
      last.length + c.length <= max + 1 &&
      c[0].s - last[0].s < MIN_CAPTION_SEC
    ) {
      last.push(...c);
    } else {
      out.push([...c]);
    }
  }
  return out;
}

export function buildAss({ perfil, words: allWords, gancho, resaltar, duracionFinal, graficos = [], ocultar = [], cardStyle, marginV: marginOverride }: AssInput): AssResult {
  const words = ocultar.length ? allWords.filter((w) => !ocultar.some(([a, b]) => w.s >= a - 0.05 && w.s < b)) : allWords;
  const { width, height } = formatSize(perfil.formato);
  const sub = perfil.subtitulos;
  const hook = perfil.gancho;
  const font = sub.fuente.replace(/,/g, ' ');

  const safe = safeZone(perfil.red, perfil.formato);
  const alignment = sub.posicion === 'arriba' ? 8 : sub.posicion === 'centro' ? 5 : 2;
  // Abajo: por encima de los botones de la red (y a la altura del pecho). Arriba: debajo de la barra de la red.
  const marginV = marginOverride ??
    (sub.posicion === 'abajo'
      ? Math.max(Math.round(height * 0.2), safe.bottom + 40)
      : sub.posicion === 'arriba'
        ? Math.max(Math.round(height * 0.17), safe.top + 40)
        : 0);
  const marginL = 80;
  const marginR = Math.max(80, safe.right + 20);
  const box = sub.caja;
  // Opacidad de la caja (100 % = opaca). En ASS el alfa va de 0 (opaco) a 255 (transparente).
  const boxAlpha = Math.round(255 * (1 - Math.max(30, Math.min(100, sub.opacidadCaja ?? 100)) / 100));
  const subStyle = [
    'Sub',
    font,
    sub.tamano,
    assColor(sub.colorTexto),
    assColor(sub.colorResaltado),
    box ? assColor(sub.colorCaja, boxAlpha) : assColor(sub.colorBorde),
    box ? assColor(sub.colorCaja, boxAlpha) : assColor('#000000', 140),
    -1, 0, 0, 0, 100, 100, 0, 0,
    box ? 3 : 1,
    box ? Math.round(sub.tamano * 0.22) : sub.grosorBorde,
    box ? 0 : sub.grosorBorde > 0 ? 2 : 0,
    alignment,
    marginL, marginR, marginV, 1,
  ].join(',');

  // El gancho va arriba; si los subtítulos ya están arriba, va abajo para no taparse.
  const hookAlign = sub.posicion === 'arriba' ? 2 : 8;
  const hookFont = (hook.fuente?.trim() || font).replace(/,/g, ' ');
  const hookStyle = [
    'Hook',
    hookFont,
    hook.tamano,
    assColor(hook.colorTexto),
    assColor(hook.colorTexto),
    assColor(hook.colorFondo),
    assColor(hook.colorFondo),
    -1, 0, 0, 0, 100, 100, 0, 0,
    3, Math.round(hook.tamano * 0.3), 0,
    hookAlign,
    90, Math.max(90, safe.right + 20), hookAlign === 8 ? Math.max(Math.round(height * 0.11), safe.top + 30) : Math.max(Math.round(height * 0.2), safe.bottom + 40), 1,
  ].join(',');

  const keySet = new Set(resaltar.map(normalizeWord).filter(Boolean));
  const hi = `{\\1c${assColor(sub.colorResaltado)}&}`;
  const ks = Math.round(Math.max(100, Math.min(250, sub.escalaClave ?? 130)));
  const keyTag = `{\\1c${assColor(sub.colorResaltado)}&\\fscx${ks}\\fscy${ks}}`;
  const label = (t: string) => escapeText(sub.mayusculas ? t.toLocaleUpperCase('es') : t);
  const isKey = (t: string) => keySet.has(normalizeWord(t));

  const events: string[] = [];
  const add = (start: number, end: number, style: string, text: string) => {
    if (end - start < 0.03) return;
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  };
  const lineSpans: number[] = [];

  if (sub.activo && words.length) {
    const max = sub.estilo === 'palabra' ? 1 : sub.palabrasPorLinea;
    const chunks = mergeShort(chunkWords(words, max), max);
    chunks.forEach((chunk, ci) => {
      const nextStart = chunks[ci + 1]?.[0]?.s ?? duracionFinal;
      // Cola de 0,35 s y mínimo de 0,4 s, sin pisar la línea siguiente
      const chunkEnd = Math.min(nextStart, Math.max(chunk[chunk.length - 1].e + 0.35, chunk[0].s + MIN_CAPTION_SEC), duracionFinal);
      lineSpans.push(chunkEnd - chunk[0].s);

      if (sub.estilo === 'karaoke') {
        chunk.forEach((w, j) => {
          const start = w.s;
          const end = j < chunk.length - 1 ? chunk[j + 1].s : chunkEnd;
          const text = chunk
            .map((x, k) => {
              if (isKey(x.t)) return `${keyTag}${label(x.t)}{\\r}`;
              return k === j ? `${hi}{\\fscx108\\fscy108}${label(x.t)}{\\r}` : label(x.t);
            })
            .join(' ');
          add(start, end, 'Sub', text);
        });
      } else if (sub.estilo === 'palabra') {
        // Palabra a palabra (si una dura menos de 0,4 s, se junta con la siguiente)
        const w = chunk[0];
        const key = chunk.some((x) => isKey(x.t));
        const to = key ? ks : 100;
        const text = chunk.map((x) => (isKey(x.t) ? `${hi}${label(x.t)}{\\1c${assColor(sub.colorTexto)}&}` : label(x.t))).join(' ');
        add(w.s, Math.max(chunkEnd, w.s + 0.12), 'Sub', `{\\fscx${Math.round(to * 0.8)}\\fscy${Math.round(to * 0.8)}\\t(0,90,\\fscx${to}\\fscy${to})}${text}`);
      } else {
        const text = chunk.map((x) => (isKey(x.t) ? `${keyTag}${label(x.t)}{\\r}` : label(x.t))).join(' ');
        add(chunk[0].s, chunkEnd, 'Sub', text);
      }
    });
  }

  const hookText = gancho.trim();
  if (hook.activo && hookText) {
    const end = Math.min(hook.duracionSeg, Math.max(0.5, duracionFinal));
    add(0, end, 'Hook', `{\\fad(120,200)}${escapeText(hook.mayusculas === false ? hookText : hookText.toLocaleUpperCase('es'))}`);
  }

  // Firma (usuario o marca) en pantalla todo el video, pequeña y dentro de la zona segura
  const sig = perfil.firma;
  const sigText = sig?.activo ? sig.texto.trim() : '';
  let sigStyle: string | null = null;
  if (sigText) {
    const sigAlpha = Math.round(255 * (1 - Math.max(20, Math.min(100, sig.opacidad)) / 100));
    const sigAlign = sig.posicion === 'abajo' ? 2 : 8;
    const sigMargin = sig.posicion === 'abajo' ? Math.max(40, safe.bottom - Math.round(sig.tamano * 1.6)) : safe.top + 10;
    sigStyle = [
      'Firma',
      (sig.fuente?.trim() || font).replace(/,/g, ' '),
      sig.tamano,
      assColor(sig.color, sigAlpha),
      assColor(sig.color, sigAlpha),
      assColor('#000000', Math.min(255, sigAlpha + 120)),
      assColor('#000000', 255),
      -1, 0, 0, 0, 100, 100, 1, 0,
      1, 1, 0,
      sigAlign,
      marginL, marginR, sigMargin, 1,
    ].join(',');
    events.push(`Dialogue: 1,${assTime(0)},${assTime(Math.max(0.5, duracionFinal))},Firma,,0,0,0,,${escapeText(sigText)}`);
  }

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${subStyle}`,
    `Style: ${hookStyle}`,
    ...(sigStyle ? [`Style: ${sigStyle}`] : []),
    ...(cardStyle ? [`Style: ${cardStyle}`] : []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ...graficos,
    '',
  ].join('\n');
  const minSeg = lineSpans.length ? Math.min(...lineSpans) : 0;
  return { ass, lineas: lineSpans.length, minSeg, cortas: lineSpans.filter((d) => d < MIN_CAPTION_SEC - 0.005).length };
}

/** ASS solo con la capa de DETRÁS de la persona (palabras gigantes), sobre fondo transparente. */
export function buildBehindAss(perfil: EditProfile, cardStyle: string, events: string[]): string {
  const { width, height } = formatSize(perfil.formato);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${cardStyle}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
