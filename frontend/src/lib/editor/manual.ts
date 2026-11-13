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

// ── Radar de capacidades ─────────────────────────────────────────────────────

/**
 * Todo lo que Claude puede usar HOY para editar (va en la skill junto a las reglas aprendidas). Es
 * código, no aprendizaje: se actualiza cuando la app gana capacidades. Recursos, no obligaciones:
 * cada video usa lo que su concepto pida, con equilibrio.
 */
export const CAPABILITIES_RADAR: Array<{ titulo: string; items: string[] }> = [
  {
    titulo: 'Motor de Lulo (dirigir_edicion → renderizar)',
    items: [
      'Cortes por frase (falsos comienzos, muletillas, repeticiones, voces del apuntador) y pausas recortadas.',
      'Cámara virtual centrada en la cara: plano (normal / medio / primer plano), punch-in, acercar, alejar, paneo y sacudida.',
      'Transiciones: flash, fundido a negro, glitch y desenfoque.',
      'Color: contraste, saturación, brillo, calidez, viñeta y grano.',
      'Subtítulos: karaoke, palabra a palabra, frase, «pop» (cada palabra entra al decirse) y «caja_activa»; fuente, tamaño, colores, borde, sombra, posición y palabras por línea.',
      'Palabras clave con color, tamaño y efecto (rebote, sacudida, crecer, brillo), por palabra o por aparición concreta.',
      'Gancho de entrada con su estilo; gráficos nativos (tarjeta, número grande, lista, palabra gigante detrás).',
      'Elementos de la carpeta en su segundo exacto: capa transparente a pantalla completa, flotante, pantalla completa o pantalla dividida (la persona se encuadra en su mitad).',
      '20 efectos de sonido sintetizados (click, tick, pop, blip, swish, whoosh, swipe, riser, impacto, boom, thud, ding, éxito, error, cámara, teclado, glitch, brillo, palmada, caja registradora) o archivos propios, sin límite de cantidad, con volumen y paneo.',
      'Música sin derechos generada en 7 estilos (trap, house, phonk, motivacional, cinemático, lo-fi, synthpop) con secciones suave / completa / silencio para «drops», o un archivo; ducking bajo la voz y máster a −14 LUFS.',
      'Informe de ritmo y variedad al guardar el plan (formatos, tramos sin cambios, efectos por segundo, repeticiones).',
    ],
  },
  {
    titulo: 'Estructura de retención (dirigir_edicion; tiempos de la línea principal)',
    items: [
      'Arranque en frío: el momento más fuerte (1,5–4 s) se repite al inicio como avance, con destello y «swish», y luego empieza el video.',
      'Silencio dramático: 0,4–0,8 s de silencio total con la imagen congelada (y zoom lento) justo antes del remate; 1–2 por video.',
      'Progreso de una lista: barra que crece arriba y contador «PASO 2/5» que cambia en cada ítem.',
      'Bucle: el final enlaza con el inicio sin silencio ni cola de música; el control de calidad mide cuánto se parecen el último y el primer plano.',
      'Re-ganchos (≈3 s, ≈8 s y la mitad), bucles abiertos y pregunta final: criterio de dirección; el informe de ritmo avisa si falta un re-gancho.',
    ],
  },
  {
    titulo: 'Sonido (dirigir_edicion + biblioteca_audio + beats_musica)',
    items: [
      'Cuadrícula de beats de la música (generada: exacta; archivo: detectada): cortes, punch y entradas en el beat; cambios grandes al inicio de compás; impactos en los golpes. El informe de ritmo avisa si los cortes no caen en el beat.',
      'Biblioteca de audio del equipo (pestaña «Audio», compartida): efectos, música y ambientes reales con licencia, como «biblioteca:<id>». Los sonidos en tendencia «solo en la app» se recomiendan para añadirlos al publicar.',
      'Voz: mejora (presencia + de-esser), respiraciones y chasquidos atenuados, y efectos por tramo: teléfono, radio, megáfono, eco, sala, pensamiento, grave y agudo.',
      'Ambientes de fondo por tramos: lluvia, viento, oficina, ciudad, naturaleza, tensión, sala (sintetizados) o un archivo.',
      'Velocidad de los clips de apoyo: cámara lenta (0,25–0,9) o rápida (1,5–4).',
      'Volumen final por red (Instagram/Shorts −14 LUFS, TikTok −13) o el que elijas entre −16 y −9.',
    ],
  },
  {
    titulo: 'Recorte de persona (cuando aporte: 1–3 momentos clave por video, no todo el tiempo)',
    items: [
      'Usos: palabra gigante o gráfico DETRÁS de la persona (profundidad); la persona sobre un fondo de diseño o de color para marcar un cambio de tema; la persona como «sticker» sobre un b-roll o una captura; contorno brillante o sombra para destacarla; que «salga» del marco de un gráfico.',
      'Vía rápida: gráfico tipo «detras» del motor (usa RobustVideoMatting si está instalado en Herramientas; si no, el texto va delante).',
      'Vía libre: MediaPipe (instalado) → máscara de la persona fotograma a fotograma → video con transparencia (FFmpeg alphamerge, .mov ProRes 4444) → elemento «capa» encima del fondo o del texto que diseñes.',
      'Alternativa: el quitafondos de HyperFrames (skill media-use, `npx hyperframes remove-background`).',
      'Revisa siempre el borde del recorte (pelo, manos) en fotogramas antes de entregar; si se ve sucio, suaviza la máscara o no lo uses.',
    ],
  },
  {
    titulo: 'Kit de gráficos de Lulo (kit_grafico; .mov transparente con la paleta del video)',
    items: [
      'Stickers y emojis con rebote; trazos a mano que se dibujan solos (flecha, círculo, subrayado, tachado).',
      'Gráficas que crecen con contador: barras, anillo de porcentaje, línea.',
      'Antes/después con cortinilla (imágenes o videos); tarjetas de capítulo («PASO 2»).',
      'Texto kinético palabra a palabra con los tiempos exactos de la voz (desdeVideo/hastaVideo).',
      'Intro y cierre de marca (pestaña «Marcas», compartida): logo, colores, tipografía, lema y CTA.',
      'Capturas o grabaciones dentro de un teléfono o portátil con zoom, cursor y clic; zonas_de_cambio dice dónde cambia la pantalla.',
      'Anotación sobre un fotograma congelado (pausas[].capa) y portada diseñada con la persona recortada (disenar_portada).',
    ],
  },
  {
    titulo: 'Imagen y cámara (pista de persona con MediaPipe; pista_persona y analizar_imagen)',
    items: [
      'Reencuadre: con zoom, la cámara sigue la cara en cada momento (camaraSigueCara).',
      'Elementos que siguen la cara o una mano (elementos[].seguir) y elementos detrás de la persona (detrasDePersona).',
      'Fondo desenfocado («cámara cara»), cambio de fondo (color, imagen o video) y efecto clon (la persona de otro momento a su lado).',
      'Movimientos amplios del cuerpo con su segundo exacto, para cortar o transicionar con ellos.',
      'Estabilización (vidstab) e igualado de luz y tinte entre tramos.',
    ],
  },
  {
    titulo: 'Versiones y publicación',
    items: [
      'Variantes del borrador sin tocarlo (crear_variante): ganchos A/B (texto, avance, primer plano) y versión corta o larga eligiendo frases.',
      'Exportación por red (exportar_redes): zona segura y volumen de TikTok, Reels o Shorts, con .srt.',
      'Texto del post (texto_post): descripción, hashtags y primer comentario, para copiar en la app.',
    ],
  },
  {
    titulo: 'Aprendizaje',
    items: [
      'Nota de retención 0–100 de cada borrador con las 3 mejoras que más suben (puntuar_borrador).',
      'Métricas reales (registrar_metricas desde una captura o CSV): cada caída de retención cruzada con lo que había en pantalla → lecciones con evidencia en este manual.',
      'Fichas de videos de referencia (analizar_referencia + guardar_referencia; referencias): cortes por minuto, planos, volumen, BPM y estilo, para imitar.',
      'Mejor hora de publicación con los datos del equipo (mejor_hora).',
    ],
  },
  {
    titulo: 'Voz e idioma',
    items: [
      'Subtítulos en dos idiomas (segundoIdioma): la traducción de cada frase en una línea más pequeña. Gratis.',
      'Palabra corregida con la voz clonada (corregir_palabra, de pago con aprobación): ajustada al hueco y al volumen de la voz.',
      'Doblaje completo a otro idioma con subtítulos nuevos (doblar_video, ElevenLabs $0,50/min, de pago con aprobación).',
    ],
  },
  {
    titulo: 'Cortes limpios (voces de fondo)',
    items: [
      'Separación de hablantes en la transcripción + labios (MediaPipe) + voz con tono en el audio: lo que no dice la persona se corta solo.',
      'Apuntes: si alguien le dicta y la persona repite, se corta lo dictado y queda su repetición.',
      'Voz ajena en pausas o márgenes: se corta si dura 0,35 s o más; si es más corta, se silencia.',
      'voces_de_fondo para ver o rehacer el análisis.',
    ],
  },
  {
    titulo: 'HyperFrames (diseño y animación)',
    items: [
      'Motion design de calidad: tarjetas, listas que se construyen, cifras que cuentan, iconos, tipografía cinética, mapas, gráficos de datos, transiciones de diseño; ~450 bloques listos en hyperframes-registry.',
      'Render en .mov transparente para colocarlo como capa; revisar_html_video y renderizar_html_video.',
      'Skill media-use: detección de beats de la música, medición de volumen, looks de color y recortes.',
    ],
  },
  {
    titulo: 'FFmpeg y Python (efectos a medida)',
    items: [
      'FFmpeg: rampas de velocidad y cámara lenta, congelar fotograma, reversa, máscaras, superposiciones complejas, estabilizar, quitar ruido, extraer fotogramas para revisar.',
      'Python: MediaPipe (persona, manos, cara, pose), OpenCV (seguir objetos, detectar), SciPy (análisis de audio), leer Word y PDF del material.',
    ],
  },
  {
    titulo: 'Material y referencias',
    items: [
      'Carpeta de material y adjuntos de la persona (fotos, videos, logos, guiones); descargas libres de internet (iconos, fotos, música y efectos sin derechos); yt-dlp para videos de referencia.',
      'Feedback del equipo (ver_feedback / tomar_feedback) y este manual (ver_manual / aprender_del_feedback).',
    ],
  },
];

function radarText(): string {
  return CAPABILITIES_RADAR.map((g) => `${g.titulo}:\n${g.items.map((i) => `- ${i}`).join('\n')}`).join('\n');
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
  out.push('## Lo que puedes usar (radar)', '', '_Recursos disponibles, no obligaciones: cada video usa lo que su concepto pida, con equilibrio._', '');
  for (const g of CAPABILITIES_RADAR) {
    out.push(`### ${g.titulo}`, '', ...g.items.map((i) => `- ${i}`), '');
  }
  return out.join('\n');
}

/** Bloque para las instrucciones de Claude: las reglas activas, por área, las más confirmadas primero. */
export async function manualPrompt(): Promise<string> {
  const { manual } = await loadManual();
  const activas = manual.reglas.filter((r) => r.estado === 'activa');
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
${lines.join('\n')}

## LO QUE PUEDES USAR (radar: recursos disponibles, no obligaciones; elige lo que pida cada video, con equilibrio)
${radarText()}`;
}
