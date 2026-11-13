import { findBrand, loadBrands, type Brand } from './kit/brands';
import type { EditProject } from './types';

/**
 * Estándar de edición de una marca (el que entrega el cliente, p. ej. «ESTÁNDAR DE EDICIÓN ETM ·
 * v1», copia en docs/marcas/). Se guarda en la marca (pestaña «Marcas», compartida en R2) y, si la
 * edición es de esa marca, Claude lo sigue POR ENCIMA del manual general y del criterio creativo.
 *
 * ENGINE_LIMITS: lo que el motor de Lulo todavía NO hace. Claude lo recibe para cumplir la regla
 * típica de estos estándares («si no puedes cumplir una regla, dilo antes de entregar»): no debe
 * prometer lo que el motor no hace; lo resuelve por otra vía (HyperFrames, FFmpeg) o lo avisa.
 */
export const ENGINE_LIMITS: string[] = [
  'Corte DENTRO de una frase: cambiar_guion corta frases enteras. Para quitar palabras sueltas dentro de una frase, avisa con el segundo exacto (lista para corte manual) o reconstruye ese tramo con FFmpeg y publicar_borrador.',
  'Subtítulos ANCLADOS a la cara (que se muevan con el zoom o el plano): el motor los pone en una posición fija (abajo, centro o arriba, y baja si chocan con la barbilla). Elige la posición y el zoom para que caigan bajo el mentón o avisa de los planos donde no.',
  'Subtítulos en la mitad de la persona en pantalla dividida: el motor los centra en la unión. Avísalo o evita la pantalla dividida con subtítulos.',
  'Subtítulos al 68 % del alto cuando la persona no está en cuadro: no es automático.',
  'Sombra suave desenfocada (8 px) en subtítulos: el motor hace sombra dura (campo sombra); es una aproximación.',
  'Fuentes que no estén en la carpeta de fuentes (p. ej. Sora, Anton, Prata): instálalas en <datos>/fuentes (.ttf de Google Fonts, licencia OFL) o usa las alternativas que da el propio estándar.',
  'Caja de comentarios de Instagram que se escribe sola: no hay pieza del kit; hazla en HyperFrames (mockup fiel de la app) o avísalo.',
  'Aire de 0,8 s después de la última palabra: el render termina con un margen corto; alárgalo con FFmpeg (congelar o mantener el último plano) o avísalo.',
  'Aire mínimo sobre la cabeza con zoom: la cámara sigue la cara, pero no garantiza el 4 % de aire arriba; revísalo en los planos cerrados.',
  'Transcribir el audio FINAL para comprobar el guion: no es automático (palabras_borrador viene de la transcripción del original). Revisa escuchando (escuchar_audio) y mirando, y di que no se re-transcribió.',
  'Barrido con desenfoque de movimiento: no está entre las transiciones del motor (flash, negro, glitch, desenfoque); hazlo con FFmpeg o usa corte seco.',
  'Piezas del kit con blanco puro (bordes de sticker, antes/después): si la marca prohíbe el blanco, no las uses o pásales paleta sin blanco.',
];

export async function brandOf(p: EditProject): Promise<Brand | null> {
  if (!p.marcaId) return null;
  return findBrand(p.marcaId).catch(() => null);
}

/** Bloque de instrucciones con el estándar de la marca (o vacío si la edición no tiene marca con estándar). */
export async function brandStandardPrompt(p: EditProject): Promise<string> {
  const b = await brandOf(p);
  if (!b?.estandar?.trim()) return '';
  return `
════ ESTÁNDAR DE EDICIÓN DE LA MARCA «${b.nombre}» (entregado por el cliente) ════
Esta edición es de ${b.nombre}. Su estándar MANDA sobre el manual de edición y sobre tu criterio creativo general: si chocan, gana el estándar (colores, fuentes, subtítulos, efectos permitidos, transiciones, cierre…). Lo que el estándar no diga, lo decides tú con el criterio general.
${b.estandar.trim()}

LO QUE EL MOTOR DE LULO AÚN NO HACE (no lo prometas; resuélvelo por otra vía o avísalo ANTES de entregar, con el segundo exacto y la regla):
${ENGINE_LIMITS.map((x) => `- ${x}`).join('\n')}
════ FIN DEL ESTÁNDAR ════`;
}

/** Recordatorio en cada mensaje (con --resume el prompt de sistema del primer mensaje no cambia). */
export async function brandMessagePrefix(p: EditProject): Promise<string> {
  const b = await brandOf(p);
  if (!b?.estandar?.trim()) return '';
  return `[Esta edición es de la marca «${b.nombre}»: su ESTÁNDAR DE EDICIÓN manda sobre el manual (míralo con estandar_marca si no lo tienes presente). Si una regla no se puede cumplir, dilo antes de entregar.]\n\n`;
}

/** Estándares de todas las marcas, para la vista «skill» del manual. */
export async function brandStandardsMarkdown(): Promise<string> {
  const { marcas } = await loadBrands().catch(() => ({ marcas: [] as Brand[] }));
  const withStd = marcas.filter((m) => m.estado === 'activa' && m.estandar?.trim());
  if (!withStd.length) return '';
  return `\n\n## Estándares de marca\n\nCuando una edición es de una de estas marcas, su estándar manda sobre las reglas de arriba.\n\n${withStd
    .map((m) => `### ${m.nombre}\n\n\`\`\`text\n${m.estandar!.trim()}\n\`\`\``)
    .join('\n\n')}\n`;
}
