import crypto from 'crypto';
import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { GRAPHICS_AMOUNTS, formatSize, safeZone, type EditProfile } from '@/config/editor-looks';
import { assColor, normalizeWord } from './ass';
import { mapClamped, type KeptInterval } from './timeline';
import type { EditGraphic, EditPhrase, EditProject, GraphicType } from './types';
import type { FaceTrack } from './advanced';

/**
 * Motion graphics (método de la guía: primero el plan, después construir):
 *  - la IA propone gráficos disparados en una palabra (tarjeta, cifra, lista o palabra gigante detrás de la cabeza),
 *  - la persona los revisa (cambia textos, apaga),
 *  - se dibujan como subtítulos ASS animados: tarjetas con esquinas redondeadas y entrada con rebote suave,
 *    siempre por debajo de la barbilla y dentro de la zona segura. Los textos entran sin rebote.
 */

const PlanSchema = z.object({
  graficos: z.array(
    z.object({
      fraseId: z.string().describe('id de la frase CONSERVADA donde aparece (p. ej. "f4")'),
      palabra: z.string().describe('La palabra exacta de esa frase en la que entra el gráfico'),
      tipo: z.enum(['tarjeta', 'numero', 'lista', 'detras']).describe(
        'tarjeta: título + texto corto · numero: una cifra que se dice (precio, %, años) · lista: 2-3 cosas que se enumeran · detras: 1-2 palabras gigantes detrás de la cabeza para un momento de impacto'
      ),
      titulo: z.string().describe('Máximo 4 palabras (en "numero", la cifra tal cual: "97 %", "$20"; en "detras", 1-2 palabras)'),
      texto: z.string().describe('Máximo 10 palabras; vacío si no hace falta'),
      items: z.array(z.string()).describe('Solo para "lista": 2 o 3 elementos de máximo 4 palabras'),
    })
  ),
  resumen: z.string().describe('Una frase en español sobre el plan'),
});

export function graphicDuration(g: Pick<EditGraphic, 'tipo' | 'items'>): number {
  if (g.tipo === 'detras') return 1.7;
  if (g.tipo === 'lista') return 1.6 + 0.5 * Math.max(1, g.items.length);
  return 2.6;
}

/** Busca la palabra en la frase para fijar el instante exacto. */
function triggerTime(f: EditPhrase, palabra: string): number {
  const key = normalizeWord(palabra.split(/\s+/)[0] ?? '');
  const w = key ? f.palabras.find((x) => normalizeWord(x.t) === key) : undefined;
  return (w ?? f.palabras[0])?.s ?? f.s;
}

/** Pide el plan a la IA. Respeta la cantidad del perfil y deja al menos 3 s entre gráficos. */
export async function planGraphics(p: EditProject, keptSeconds: number): Promise<{ graficos: EditGraphic[]; resumen: string }> {
  const amount = GRAPHICS_AMOUNTS.find((a) => a.id === p.perfil.graficos.cantidad) ?? GRAPHICS_AMOUNTS[2];
  if (amount.max === 0) return { graficos: [], resumen: 'Perfil sin gráficos.' };
  const max = Math.max(1, Math.min(amount.max, Math.floor(keptSeconds / 4)));
  const kept = p.frases.filter((f) => !f.cortar);
  const lines = kept.map((f) => `${f.id} [${f.s.toFixed(1)} s] ${f.textoEditado?.trim() || f.palabras.map((w) => w.t).join(' ')}`);
  const { object } = await orchestrateObject({
    tool: 'video-editor',
    description: `Edición · plan de gráficos · ${p.titulo}`,
    system: `Eres motion designer de reels verticales donde una persona habla a cámara. Propones gráficos que REFUERZAN lo que dice, cada uno en la palabra exacta en que lo dice.
Reglas: un gráfico por idea; nunca inventes datos ni cifras que no se dicen; textos muy cortos; sin emojis; en el idioma del video.
Usa "detras" (palabra gigante detrás de la cabeza) solo para 1 o 2 momentos de máximo impacto, como el gancho. Usa "numero" solo si se dice una cifra. Usa "lista" solo si se enumeran cosas.
Deja al menos 3 segundos entre un gráfico y el siguiente.`,
    prompt: [
      p.perfil.sobreTi ? `SOBRE QUIEN HABLA:\n${p.perfil.sobreTi}` : '',
      p.perfil.instrucciones ? `SUS REGLAS:\n${p.perfil.instrucciones}` : '',
      `PEDIDO:\n${p.pedido || 'Reel con gráficos que refuercen las ideas.'}`,
      `Cantidad: ${amount.label} (máximo ${max} gráficos).`,
      `FRASES QUE QUEDAN EN EL VIDEO:\n${lines.join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: PlanSchema,
    temperature: 0.4,
    mode: p.modoIA || undefined,
  });

  const byId = new Map(kept.map((f) => [f.id, f]));
  const out: EditGraphic[] = [];
  let detras = 0;
  for (const g of object.graficos) {
    const f = byId.get(g.fraseId.trim().toLowerCase());
    if (!f) continue;
    if (g.tipo === 'detras' && ++detras > 2) continue;
    const t = triggerTime(f, g.palabra);
    if (out.some((o) => Math.abs(o.t - t) < 3)) continue;
    out.push({
      id: crypto.randomUUID().slice(0, 8),
      tipo: g.tipo,
      fraseId: f.id,
      palabra: g.palabra.trim().slice(0, 40),
      t,
      titulo: g.titulo.trim().slice(0, 40),
      texto: g.texto.trim().slice(0, 90),
      items: g.tipo === 'lista' ? g.items.map((i) => i.trim().slice(0, 40)).filter(Boolean).slice(0, 3) : [],
      activo: true,
    });
    if (out.length >= max) break;
  }
  out.sort((a, b) => a.t - b.t);
  return { graficos: out, resumen: object.resumen.trim() };
}

// ── Dibujo (ASS) ─────────────────────────────────────────────────────────────

export interface PlacedGraphic {
  g: EditGraphic;
  start: number;
  end: number;
}

/** Coloca los gráficos activos en el video final (descarta los que caen en frases cortadas). */
export function placeGraphics(p: EditProject, intervals: KeptInterval[], total: number): PlacedGraphic[] {
  const cut = new Set(p.frases.filter((f) => f.cortar).map((f) => f.id));
  const placed = (p.graficos ?? [])
    .filter((g) => g.activo && !cut.has(g.fraseId))
    .map((g) => ({ g, start: mapClamped(g.t, intervals) }))
    .filter((x): x is { g: EditGraphic; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start);
  return placed.map((x, i) => {
    const next = placed[i + 1]?.start ?? total;
    const end = Math.min(x.start + graphicDuration(x.g), next - 0.15, total);
    return { g: x.g, start: x.start, end };
  }).filter((x) => x.end - x.start >= 0.6);
}

function t(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const clean = (s: string) => s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

/** Rectángulo de esquinas redondeadas en coordenadas de dibujo ASS (origen arriba a la izquierda). */
function roundRect(w: number, h: number, r: number): string {
  const R = Math.min(r, w / 2, h / 2);
  const k = R * 0.45;
  return [
    `m ${R} 0`,
    `l ${w - R} 0`,
    `b ${w - k} 0 ${w} ${k} ${w} ${R}`,
    `l ${w} ${h - R}`,
    `b ${w} ${h - k} ${w - k} ${h} ${w - R} ${h}`,
    `l ${R} ${h}`,
    `b ${k} ${h} 0 ${h - k} 0 ${h - R}`,
    `l 0 ${R}`,
    `b 0 ${k} ${k} 0 ${R} 0`,
  ].join(' ');
}

function wrapLines(text: string, fontPx: number, widthPx: number): number {
  if (!text) return 0;
  const perLine = Math.max(4, Math.floor(widthPx / (fontPx * 0.56)));
  return Math.max(1, Math.ceil(text.length / perLine));
}

export interface GraphicsAss {
  /** Eventos delante (tarjetas y, si no hay recorte, palabras gigantes). */
  front: string[];
  /** Eventos detrás de la persona (palabras gigantes con recorte). */
  behind: string[];
  /** Ventanas en las que conviene ocultar los subtítulos. */
  hide: Array<[number, number]>;
  /** Avisos para el control de calidad. */
  avisos: string[];
}

/** Dónde está la cara (de lulo_faces.py) y el zoom máximo que se le aplica al video. */
export interface FaceInfo {
  track: FaceTrack | null;
  zoomMax: number;
  /** Intervalos [inicio, fin] con el gancho en pantalla (las tarjetas de arriba no lo pisan). */
  hook?: [number, number];
}

/** Barbilla (abajo), parte alta de la cabeza (arriba) y ancho máximo de la cara en una ventana de tiempo. */
export function faceWindow(track: FaceTrack | null, t0: number, t1: number): { chin: number; top: number; width: number } | null {
  if (!track || !track.frames.length) return null;
  const i0 = Math.max(0, Math.floor(t0 * track.fps));
  const i1 = Math.min(track.frames.length - 1, Math.ceil(t1 * track.fps));
  let chin = -1;
  let top = 2;
  let width = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const f = track.frames[i];
    if (!f) continue;
    n++;
    // La caja de OpenCV va de la frente a la boca/barbilla: se amplía para cubrir barbilla y pelo
    chin = Math.max(chin, f.y + f.h * 1.15);
    top = Math.min(top, f.y - f.h * 0.35);
    width = Math.max(width, f.w);
  }
  return n ? { chin, top: Math.max(0, top), width } : null;
}

export function graphicsEvents(perfil: EditProfile, placed: PlacedGraphic[], behindAvailable: boolean, faces?: FaceInfo): GraphicsAss {
  const { width: W, height: H } = formatSize(perfil.formato);
  const gs = perfil.graficos;
  const safe = safeZone(perfil.red, perfil.formato);
  const font = perfil.subtitulos.fuente.replace(/,/g, ' ');
  const impact = gs.fuenteImpacto.replace(/,/g, ' ');
  const alpha = Math.round(255 * (1 - gs.opacidad / 100))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  const front: string[] = [];
  const behind: string[] = [];
  const hide: Array<[number, number]> = [];
  const avisos: string[] = [];
  let tapan = 0;
  let movidas = 0;

  const cardW = Math.round(W * 0.84);
  const cx = Math.round(W / 2);
  const baseTop = Math.round(H * (perfil.formato === '9:16' ? 0.555 : 0.6));
  const maxBottom = H - safe.bottom - 20;
  const pad = Math.round(W * 0.045);
  const inner = cardW - pad * 2;
  const bounce = '\\fscx90\\fscy90\\t(0,220,\\fscx103\\fscy103)\\t(220,380,\\fscx100\\fscy100)';
  const textIn = '\\fad(260,180)';
  const z = Math.max(1, faces?.zoomMax ?? 1);
  // Con zoom, el recorte se centra al 35 % de la altura: lo de abajo baja y lo de arriba sube
  const zoomY = (y: number) => y * z - H * (z - 1) * 0.35;

  const ev = (layer: number, start: number, end: number, text: string) =>
    `Dialogue: ${layer},${t(start)},${t(end)},Card,,0,0,0,,${text}`;

  /**
   * Coloca una tarjeta de alto `height(escala)`: debajo de la barbilla (con el zoom máximo);
   * si no cabe, más pequeña; si aun así no cabe, encima de la cabeza; si tampoco, lo más abajo posible.
   */
  const place = (start: number, end: number, height: (k: number) => number): { top: number; k: number } => {
    const fw = faceWindow(faces?.track ?? null, start, end);
    let top = baseTop;
    if (fw) top = Math.max(Math.round(H * 0.4), Math.round(zoomY(fw.chin * H) + 24));
    let k = 1;
    let h = height(k);
    if (top + h <= maxBottom) return { top, k };
    k = Math.max(0.72, (maxBottom - top) / h);
    h = height(k);
    if (top + h <= maxBottom) return { top, k };
    if (fw) {
      const hookOn = faces?.hook && start < faces.hook[1] && end > faces.hook[0];
      const minY = safe.top + 20 + (hookOn ? Math.round(perfil.gancho.tamano * 2.9) : 0);
      const headTop = Math.round(zoomY(fw.top * H) - 24);
      const room = headTop - minY;
      const h1 = height(1);
      if (room >= h1 * 0.72) {
        k = Math.min(1, room / h1);
        h = height(k);
        movidas++;
        return { top: headTop - h, k };
      }
      // Ni abajo ni arriba hay sitio libre: mejor sobre la frente que sobre la boca
      tapan++;
      k = 0.72;
      return { top: minY, k };
    }
    k = 0.72;
    h = height(k);
    return { top: maxBottom - h, k };
  };

  const box = (start: number, end: number, top: number, h: number) => {
    const cy = Math.round(top + h / 2);
    front.push(
      ev(
        10,
        start,
        end,
        `{\\an5\\pos(${cx},${cy})\\p1\\bord3\\shad0\\blur0.6\\1c${assColor(gs.colorFondo)}&\\1a&H${alpha}&\\3c${assColor(gs.colorBorde)}&\\3a&H30&\\fad(160,200)${bounce}}` +
          `${roundRect(cardW, Math.round(h), Math.round(W * 0.05))}{\\p0}`
      )
    );
  };

  const titleCard = (start: number, end: number, titulo: string, texto: string, color: string) => {
    const height = (k: number) => {
      const fT = W * 0.064 * k;
      const fB = W * 0.05 * k;
      const tl = wrapLines(titulo, fT, inner);
      const bl = wrapLines(texto, fB, inner);
      return pad * 2 * k + fT * 1.15 * tl + (texto ? fB * 0.35 + fB * 1.25 * bl : 0);
    };
    const { top, k } = place(start, end, height);
    const h = height(k);
    box(start, end, top, h);
    const fT = Math.round(W * 0.064 * k);
    const fB = Math.round(W * 0.05 * k);
    const y0 = top + pad * k;
    front.push(ev(11, start + 0.1, end, `{\\an8\\pos(${cx},${Math.round(y0)})\\fn${font}\\fs${fT}\\b1\\bord0\\shad0\\1c${assColor(color)}&${textIn}}${titulo}`));
    if (texto) {
      const y1 = y0 + fT * 1.15 * wrapLines(titulo, fT, inner) + fB * 0.35;
      front.push(ev(11, start + 0.22, end, `{\\an8\\pos(${cx},${Math.round(y1)})\\fn${font}\\fs${fB}\\b1\\bord0\\shad0\\1c${assColor(gs.colorTexto)}&${textIn}}${texto}`));
    }
  };

  for (const { g, start, end } of placed) {
    if (gs.ocultarSubtitulos) hide.push([start, end]);
    const titulo = clean(g.titulo);
    const texto = clean(g.texto);

    if (g.tipo === 'detras') {
      const word = titulo.toLocaleUpperCase('es') || clean(g.palabra).toLocaleUpperCase('es');
      const fw = faceWindow(faces?.track ?? null, start, end);
      // Detrás solo si hay recorte y queda fondo a los lados de la cabeza; si no, no se vería
      const visible = behindAvailable && gs.textoDetras && (!fw || fw.width < 0.5);
      if (!visible) {
        if (behindAvailable && gs.textoDetras && fw) avisos.push(`"${word}" iba detrás de tu cabeza, pero la cara llena la pantalla: va delante en una tarjeta`);
        titleCard(start, end, word, '', gs.colorAcento);
        continue;
      }
      const size = Math.round(Math.min(W * 0.3, (W * 0.92) / Math.max(1, word.length * 0.52)));
      const y = Math.round(H * 0.3);
      const anim = '\\fscx86\\fscy86\\t(0,320,\\fscx100\\fscy100)\\fad(160,260)';
      behind.push(
        ev(5, start, end, `{\\an5\\pos(${cx},${y})\\fn${impact}\\fs${size}\\b1\\bord0\\shad0\\blur14\\1c${assColor(gs.colorAcento)}&\\1a&H70&${anim}}${word}`),
        ev(6, start, end, `{\\an5\\pos(${cx},${y})\\fn${impact}\\fs${size}\\b1\\bord0\\shad0\\1c${assColor(gs.colorAcento)}&${anim}}${word}`)
      );
      continue;
    }

    if (g.tipo === 'numero') {
      const label = texto;
      const height = (k: number) => {
        const fN = W * 0.14 * k;
        const fB = W * 0.05 * k;
        return pad * 2 * k + fN * 1.05 + (label ? fB * 1.25 * wrapLines(label, fB, inner) : 0);
      };
      const { top, k } = place(start, end, height);
      const h = height(k);
      box(start, end, top, h);
      const fN = Math.round(W * 0.14 * k);
      const fB = Math.round(W * 0.05 * k);
      const y0 = top + pad * k;
      front.push(
        ev(11, start + 0.12, end, `{\\an8\\pos(${cx},${Math.round(y0)})\\fn${impact}\\fs${fN}\\bord0\\shad0\\1c${assColor(gs.colorAcento)}&${textIn}\\fscx92\\fscy92\\t(0,300,\\fscx100\\fscy100)}${titulo}`)
      );
      if (label) {
        front.push(ev(11, start + 0.25, end, `{\\an8\\pos(${cx},${Math.round(y0 + fN * 1.05)})\\fn${font}\\fs${fB}\\b1\\bord0\\shad0\\1c${assColor(gs.colorTexto)}&${textIn}}${label}`));
      }
      continue;
    }

    if (g.tipo === 'lista') {
      const items = g.items.map(clean).filter(Boolean);
      const height = (k: number) => {
        const fT = W * 0.064 * k;
        const fB = W * 0.05 * k;
        return pad * 2 * k + fT * 1.15 * wrapLines(titulo, fT, inner) + items.length * fB * 1.4 + fB * 0.3;
      };
      const { top, k } = place(start, end, height);
      const h = height(k);
      box(start, end, top, h);
      const fT = Math.round(W * 0.064 * k);
      const fB = Math.round(W * 0.05 * k);
      const y0 = top + pad * k;
      const left = cx - inner / 2;
      front.push(ev(11, start + 0.1, end, `{\\an7\\pos(${Math.round(left)},${Math.round(y0)})\\fn${font}\\fs${fT}\\b1\\bord0\\shad0\\1c${assColor(gs.colorTexto)}&${textIn}}${titulo}`));
      items.forEach((it, i) => {
        const y = y0 + fT * 1.15 * wrapLines(titulo, fT, inner) + fB * 0.3 + i * fB * 1.4;
        front.push(
          ev(
            11,
            start + 0.45 + i * 0.5,
            end,
            `{\\an7\\pos(${Math.round(left)},${Math.round(y)})\\fn${font}\\fs${fB}\\b1\\bord0\\shad0\\1c${assColor(gs.colorTexto)}&${textIn}}{\\1c${assColor(gs.colorAcento)}&}•  {\\1c${assColor(gs.colorTexto)}&}${it}`
          )
        );
      });
      continue;
    }

    titleCard(start, end, titulo, texto, gs.colorAcento);
  }

  if (movidas) avisos.push(`${movidas} gráfico${movidas === 1 ? '' : 's'} subieron encima de tu cabeza porque debajo de la barbilla no cabían`);
  if (tapan) avisos.push(`${tapan} gráfico${tapan === 1 ? '' : 's'} no cabían sin tocar tu cara (estás muy cerca de la cámara): van arriba, sobre la frente. Si no te gustan, apágalos o grábate un poco más lejos`);
  return { front, behind, hide, avisos };
}

/** Estilo base para los eventos de gráficos (los detalles van en etiquetas). */
export function cardStyle(perfil: EditProfile): string {
  const { width: W } = formatSize(perfil.formato);
  const margin = Math.round(W * 0.125);
  return ['Card', perfil.subtitulos.fuente.replace(/,/g, ' '), 40, '&H00FFFFFF', '&H00FFFFFF', '&H00000000', '&H00000000', -1, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 5, margin, margin, 0, 1].join(',');
}

export function graphicTypeLabel(t: GraphicType): string {
  return t === 'tarjeta' ? 'Tarjeta' : t === 'numero' ? 'Cifra' : t === 'lista' ? 'Lista' : 'Palabra detrás';
}
