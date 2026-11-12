import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { feedbackConfigured, getJsonTagged, putJson, putJsonIfUnchanged } from '@/lib/feedback/r2';
import { getSettings } from '@/lib/data/settings';

/**
 * Manual de edición vivo («el formato Lulo»): reglas de edición que Claude sigue en cada video y que
 * se van puliendo con el feedback del equipo. Decisión del dueño (2026-11-12): COMPARTIDO por los 4
 * en el bucket R2 de la app de feedback (el feedback de cualquiera mejora el manual de todos) y las
 * lecciones ENTRAN SOLAS (se pueden retirar desde la pestaña «Manual»).
 *
 * R2: `_lulo/manual-edicion.json` (la app de feedback solo lista videos, no lo ve) + una copia por
 * versión en `_lulo/manual-historial/v<N>.json` para volver atrás. Copia local en
 * `<datos>/manual-edicion.json` por si no hay conexión. Escrituras condicionales (If-Match): si
 * otra persona lo cambió a la vez, se vuelve a leer y se reintenta.
 */

export const MANUAL_AREAS = ['ritmo', 'cortes', 'gancho', 'subtitulos', 'camara', 'graficos', 'sonido', 'musica', 'color', 'cierre', 'general'] as const;
export type ManualArea = (typeof MANUAL_AREAS)[number];

export const AREA_LABEL: Record<ManualArea, string> = {
  ritmo: 'Ritmo y equilibrio',
  cortes: 'Cortes',
  gancho: 'Gancho',
  subtitulos: 'Subtítulos',
  camara: 'Cámara',
  graficos: 'Gráficos y ayudas visuales',
  sonido: 'Efectos de sonido',
  musica: 'Música',
  color: 'Color y estilo',
  cierre: 'Cierre y CTA',
  general: 'General',
};

export interface ManualSource {
  /** Video o edición de donde salió (título o archivo). */
  video: string;
  /** Nota del equipo que la originó (si la hubo). */
  nota?: string;
  fecha: string;
  /** Quién la añadió o confirmó (nombre de la persona en Lulo o «Claude»). */
  quien: string;
}

export interface ManualRule {
  id: string;
  area: ManualArea;
  regla: string;
  porQue?: string;
  estado: 'activa' | 'retirada';
  /** Cuántas veces el feedback la ha confirmado (pesa más cuanto mayor). */
  confirmaciones: number;
  fuentes: ManualSource[];
  creada: string;
  actualizada: string;
}

export interface EditingManual {
  version: number;
  actualizado: string;
  reglas: ManualRule[];
}

const R2_KEY = '_lulo/manual-edicion.json';
const historyKey = (v: number) => `_lulo/manual-historial/v${v}.json`;
const localFile = () => path.join(/*turbopackIgnore: true*/ getDataDir(), 'manual-edicion.json');

export class ManualError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Primeras reglas: lo aprendido en la prueba real «SantiRuiz R26» (2026-11-10). */
function seed(): EditingManual {
  const now = new Date().toISOString();
  const src: ManualSource = { video: 'SantiRuiz Oct R26', fecha: '2026-11-10', quien: 'Dueño (revisión de v1–v6)' };
  const r = (area: ManualArea, regla: string, porQue: string, nota: string): ManualRule => ({
    id: `r${randomUUID().slice(0, 8)}`,
    area,
    regla,
    porQue,
    estado: 'activa',
    confirmaciones: 1,
    fuentes: [{ ...src, nota }],
    creada: now,
    actualizada: now,
  });
  return {
    version: 1,
    actualizado: now,
    reglas: [
      r('graficos', 'Ninguna ayuda visual se queda fija más de 4 s: aparece con la idea y se va.', 'Un tablero fijo 20 s se sintió estático y «de plantilla».', 'Plantillas que se mantenían por mucho tiempo.'),
      r('graficos', 'Las ayudas visuales se diseñan con animación (HyperFrames o el motor), nunca como imágenes planas hechas con Pillow.', 'Los dibujos con Pillow se vieron simples y estáticos.', 'Muy estático, feo, sin estilo.'),
      r('ritmo', 'La pantalla dividida es un recurso puntual: como mucho ~25 % del video y solo para listas, comparaciones o demos.', 'La versión con split casi todo el tiempo terminó molestando.', 'Tenía demasiados splits y ya molestaba.'),
      r('subtitulos', 'Subtítulos grandes (72–100 px en vertical) y legibles en el móvil; nunca diminutos.', 'Los subtítulos pequeños de la v2 no se leían.', 'Subtítulos y palabras clave con diseño muy básico.'),
      r('color', 'La paleta se elige para cada video según su tema; no se limita a los colores del perfil.', 'El dueño pidió libertad de colores por video.', 'La paleta no debe limitarse a la energía seleccionada.'),
      r('cortes', 'Cortes en el momento justo, sin cortar palabras ni respiraciones a medias: el video debe sentirse fluido.', 'Pedido explícito del dueño para todas las ediciones.', 'Que corte bien las escenas, que se sienta más fluido.'),
    ],
  };
}

const normalize = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function saveLocal(m: EditingManual) {
  await writeJsonAtomic(localFile(), m).catch(() => undefined);
}

async function readLocal(): Promise<EditingManual | null> {
  try {
    return JSON.parse(await fs.readFile(localFile(), 'utf8')) as EditingManual;
  } catch {
    return null;
  }
}

/** El manual actual (R2 si está configurado; si no hay conexión, la copia local; si no hay nada, el inicial). */
export async function loadManual(): Promise<{ manual: EditingManual; compartido: boolean; aviso?: string }> {
  if (feedbackConfigured()) {
    try {
      const { data } = await getJsonTagged<EditingManual>(R2_KEY);
      if (data) {
        await saveLocal(data);
        return { manual: data, compartido: true };
      }
      // Nadie lo ha creado todavía: se publica el inicial (o la copia local si ya la había)
      const first = (await readLocal()) ?? seed();
      if (await putJsonIfUnchanged(R2_KEY, first, null)) {
        await saveLocal(first);
        return { manual: first, compartido: true };
      }
      const again = await getJsonTagged<EditingManual>(R2_KEY);
      if (again.data) return { manual: again.data, compartido: true };
    } catch (err) {
      const local = (await readLocal()) ?? seed();
      return { manual: local, compartido: false, aviso: `Sin conexión con el manual compartido (${err instanceof Error ? err.message : 'error'}): se usa la copia de este PC.` };
    }
  }
  const local = (await readLocal()) ?? seed();
  await saveLocal(local);
  return { manual: local, compartido: false, aviso: feedbackConfigured() ? undefined : 'El manual es solo de este PC: configura la app de feedback (FEEDBACK_R2_*) para compartirlo con el equipo.' };
}

/**
 * Cambia el manual de forma segura entre los 4 PCs: lee con ETag, aplica `fn` y escribe solo si
 * nadie lo cambió entretanto (si no, reintenta). Guarda la versión anterior en el historial.
 */
export async function updateManual<T>(fn: (m: EditingManual) => T): Promise<{ manual: EditingManual; result: T }> {
  const apply = (m: EditingManual) => {
    const copy: EditingManual = JSON.parse(JSON.stringify(m));
    const result = fn(copy);
    copy.version = (m.version ?? 0) + 1;
    copy.actualizado = new Date().toISOString();
    return { copy, result };
  };
  if (feedbackConfigured()) {
    for (let i = 0; i < 6; i++) {
      const { data, etag } = await getJsonTagged<EditingManual>(R2_KEY);
      const base = data ?? (await readLocal()) ?? seed();
      const { copy, result } = apply(base);
      if (await putJsonIfUnchanged(R2_KEY, copy, data ? etag : null)) {
        if (data) await putJson(historyKey(data.version), data).catch(() => undefined);
        await saveLocal(copy);
        return { manual: copy, result };
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    }
    throw new ManualError('Otra persona está cambiando el manual a la vez: vuelve a intentarlo en unos segundos.', 409);
  }
  const base = (await readLocal()) ?? seed();
  const { copy, result } = apply(base);
  await saveLocal(copy);
  return { manual: copy, result };
}

async function who(): Promise<string> {
  const s = await getSettings().catch(() => null);
  return (s as { personName?: string } | null)?.personName?.trim() || 'Equipo';
}

// ── Aprender ─────────────────────────────────────────────────────────────────

export const LessonSchema = z.object({
  area: z.enum(MANUAL_AREAS),
  /** Regla GENERAL y accionable para cualquier video (no «en el 0:12 de este video…»). */
  regla: z.string().trim().min(10).max(300),
  porQue: z.string().trim().max(300).optional(),
  /** La nota del equipo que la originó. */
  nota: z.string().trim().max(400).optional(),
  /** Si confirma una regla que ya existe: su id (de ver_manual). */
  confirma: z.string().max(20).optional(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * Añade lecciones al manual (entran activas) o suma una confirmación a la regla que ya existe (por id
 * o por texto igual). Devuelve qué pasó con cada una.
 */
export async function learnLessons(lecciones: Lesson[], video: string, quien = 'Claude') {
  const persona = await who();
  const fecha = new Date().toISOString();
  return updateManual((m) =>
    lecciones.map((l) => {
      const fuente: ManualSource = { video, nota: l.nota, fecha, quien: `${quien} (feedback de ${persona})` };
      const existing = (l.confirma && m.reglas.find((r) => r.id === l.confirma)) || m.reglas.find((r) => normalize(r.regla) === normalize(l.regla));
      if (existing) {
        existing.confirmaciones += 1;
        existing.fuentes = [...existing.fuentes, fuente].slice(-12);
        existing.actualizada = fecha;
        // Si estaba retirada y el feedback la vuelve a pedir, se reactiva
        const reactivada = existing.estado === 'retirada';
        existing.estado = 'activa';
        return { id: existing.id, resultado: reactivada ? 'reactivada' : 'confirmada', confirmaciones: existing.confirmaciones };
      }
      const rule: ManualRule = {
        id: `r${randomUUID().slice(0, 8)}`,
        area: l.area,
        regla: l.regla,
        porQue: l.porQue,
        estado: 'activa',
        confirmaciones: 1,
        fuentes: [fuente],
        creada: fecha,
        actualizada: fecha,
      };
      m.reglas.push(rule);
      return { id: rule.id, resultado: 'nueva', confirmaciones: 1 };
    })
  );
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/**
 * El manual como documento de skill (SKILL.md): lo que se ve en «Ver como skill» y se puede descargar.
 * Mismo contenido que recibe Claude, con cabecera de skill y la procedencia de cada regla.
 */
export function manualSkillMarkdown(m: EditingManual): string {
  const activas = m.reglas.filter((r) => r.estado === 'activa');
  const out: string[] = [
    '---',
    'name: formato-lulo-edicion',
    'description: Manual de edición de videos cortos de Lulo Studio, aprendido del feedback del equipo. Úsalo al editar cualquier reel, TikTok o Short.',
    `version: ${m.version}`,
    `actualizado: ${m.actualizado.slice(0, 10)}`,
    '---',
    '',
    '# Formato Lulo · Manual de edición',
    '',
    'Reglas que salen de lo que el equipo ha pedido en videos anteriores. Las más confirmadas pesan más. Si el pedido de un video concreto contradice una regla, manda el pedido.',
    '',
  ];
  for (const area of MANUAL_AREAS) {
    const rs = activas.filter((r) => r.area === area).sort((a, b) => b.confirmaciones - a.confirmaciones);
    if (!rs.length) continue;
    out.push(`## ${AREA_LABEL[area]}`, '');
    for (const r of rs) {
      out.push(`- **${r.regla}**${r.confirmaciones > 1 ? ` _(confirmada ${r.confirmaciones}×)_` : ''}`);
      if (r.porQue) out.push(`  - Por qué: ${r.porQue}`);
      const last = r.fuentes[r.fuentes.length - 1];
      if (last) out.push(`  - Origen: ${last.video}${last.nota ? ` — «${last.nota}»` : ''} (${last.fecha.slice(0, 10)})`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** Bloque para las instrucciones de Claude: las reglas activas, por área, las más confirmadas primero. */
export async function manualPrompt(): Promise<string> {
  const { manual } = await loadManual();
  const activas = manual.reglas.filter((r) => r.estado === 'activa');
  if (!activas.length) return '';
  const lines: string[] = [];
  for (const area of MANUAL_AREAS) {
    const rs = activas.filter((r) => r.area === area).sort((a, b) => b.confirmaciones - a.confirmaciones);
    if (!rs.length) continue;
    lines.push(`${AREA_LABEL[area]}:`);
    for (const r of rs.slice(0, 12)) lines.push(`- [${r.id}${r.confirmaciones > 1 ? ` · confirmada ${r.confirmaciones}×` : ''}] ${r.regla}${r.porQue ? ` (${r.porQue})` : ''}`);
  }
  return `
## MANUAL DE EDICIÓN LULO (aprendido del feedback del equipo; versión ${manual.version})
Estas reglas salen de lo que el equipo ha pedido en videos anteriores: síguelas por encima de tus preferencias generales (las más confirmadas pesan más). Si el pedido de la persona contradice una regla, manda el pedido.
${lines.join('\n')}`;
}
