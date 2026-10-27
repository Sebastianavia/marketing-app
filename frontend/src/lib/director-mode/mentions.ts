import type { DirectorRef, DirectorScene, DirectorState, DirectorTag, TagKind } from './types';

/**
 * Menciones con @ (paso 2): "@Valentina entra en @SpaDeLujo". Funciones puras, las usan el motor y la interfaz.
 * La @ se compara sin tildes ni mayúsculas; lo que no es una etiqueta se deja como texto normal.
 */

export const TAG_KINDS: Array<{ id: TagKind; label: string; icono: string }> = [
  { id: 'personaje', label: 'Personaje', icono: '🧑' },
  { id: 'lugar', label: 'Lugar', icono: '📍' },
  { id: 'producto', label: 'Producto', icono: '📦' },
  { id: 'estilo', label: 'Estilo', icono: '🎨' },
  { id: 'voz', label: 'Voz', icono: '🎙️' },
  { id: 'musica', label: 'Música', icono: '🎵' },
];

export function tagKindLabel(k: TagKind) {
  return TAG_KINDS.find((t) => t.id === k)!;
}

/** Sin tildes y en minúsculas, para comparar. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "Spa de lujo" → "SpaDeLujo"; "maría josé" → "MariaJose". */
export function mentionOf(nombre: string): string {
  const words = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const m = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return m.slice(0, 40) || 'Etiqueta';
}

/** Mención libre dentro del proyecto (añade 2, 3… si ya existe). */
export function uniqueMention(tags: DirectorTag[], nombre: string, exceptId?: string): string {
  const base = mentionOf(nombre);
  const taken = new Set(tags.filter((t) => t.id !== exceptId).map((t) => fold(t.mencion)));
  if (!taken.has(fold(base))) return base;
  for (let i = 2; ; i++) if (!taken.has(fold(`${base}${i}`))) return `${base}${i}`;
}

export const MENTION_RE = /@([\p{L}\p{N}_]+)/gu;

export function findTag(tags: DirectorTag[] | undefined, mention: string): DirectorTag | undefined {
  const k = fold(mention);
  return tags?.find((t) => fold(t.mencion) === k);
}

/** Etiquetas nombradas en un texto (sin repetir, en orden de aparición). */
export function mentionsIn(text: string, tags: DirectorTag[] | undefined): DirectorTag[] {
  if (!tags?.length || !text) return [];
  const out: DirectorTag[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const t = findTag(tags, m[1]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Trozos de texto y menciones, para dibujar las @ como fichas. */
export type MentionPiece = { text: string; tag?: DirectorTag };

export function splitMentions(text: string, tags: DirectorTag[] | undefined): MentionPiece[] {
  if (!tags?.length) return [{ text }];
  const out: MentionPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const t = findTag(tags, m[1]);
    if (!t) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], tag: t });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Cambia @Viejo por @Nuevo (sin tildes ni mayúsculas en la comparación). */
export function renameMention(text: string, from: string, to: string): string {
  const k = fold(from);
  return text.replace(MENTION_RE, (all, name: string) => (fold(name) === k ? `@${to}` : all));
}

/** Referencias que solo son de esta escena. */
export function sceneRefs(d: Pick<DirectorState, 'referencias'>, sceneId: string): DirectorRef[] {
  return (d.referencias ?? []).filter((r) => r.escenaId === sceneId);
}

/** Referencias de una etiqueta. */
export function tagRefs(d: Pick<DirectorState, 'referencias'>, tagId: string): DirectorRef[] {
  return (d.referencias ?? []).filter((r) => r.etiquetaId === tagId);
}

/**
 * Etiquetas que usa una escena: las que nombra con @ (qué se ve y diálogo)
 * más las de las referencias subidas solo para ella.
 */
export function sceneTags(d: Pick<DirectorState, 'etiquetas' | 'referencias'>, scene: Pick<DirectorScene, 'id' | 'queSeVe' | 'dialogo'>): DirectorTag[] {
  const tags = d.etiquetas ?? [];
  const out = mentionsIn(`${scene.queSeVe}\n${scene.dialogo}`, tags);
  for (const r of sceneRefs(d, scene.id)) {
    const t = r.etiquetaId ? tags.find((x) => x.id === r.etiquetaId) : undefined;
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Firma de las etiquetas de una escena: si cambia, su prompt queda desactualizado. '' = sin etiquetas. */
export function tagSignature(d: Pick<DirectorState, 'etiquetas' | 'referencias'>, scene: Pick<DirectorScene, 'id' | 'queSeVe' | 'dialogo'>): string {
  return sceneTags(d, scene)
    .map((t) => `${t.id}:${t.rev}`)
    .sort()
    .join(',');
}
