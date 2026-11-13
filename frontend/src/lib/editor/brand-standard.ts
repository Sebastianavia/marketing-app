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
  'Los gráficos y piezas del kit van en coordenadas de PANTALLA: con un zoom fuerte la cabeza sube y crece. Las piezas «arriba» y «pecho» se colocan según la cara en el plano normal: mira un fotograma de cada pieza en su plano real y corrige si toca la cara.',
  'Subtítulos anclados a la cara: la posición se calcula al empezar cada línea (no se desliza dentro de la línea).',
  'Transcribir el audio final (verificar_audio_final): gratis solo con Whisper local; si no, ElevenLabs con aprobación (céntimos).',
  'Mockups de apps que no sean Instagram (WhatsApp, ChatGPT, Canva…): no hay pieza fija; usa capturas o grabaciones reales con kit «pantalla», o un mockup fiel en HyperFrames.',
  'Fuentes: solo las de Google Fonts se instalan solas (instalar_fuente); una fuente de pago hay que ponerla a mano en la carpeta de fuentes.',
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

LO QUE YA TIENES PARA CUMPLIRLO: cortar_palabras (corte por palabra; los arranques repetidos ya vienen quitados), subtítulos con posicion «cara» (bajo el mentón, siguen el zoom; en pantalla dividida en la mitad de la persona; sin persona en cuadro al 68 %) y sombraSuave, instalar_fuente (Sora, Anton, Prata…), kit «comentario_instagram» y posicion «pecho» para la palabra grande, transición «barrido», colaFinal (aire tras la última palabra), aire automático sobre la cabeza con zoom, verificar_audio_final, voces_de_fondo, crear_variante (gancho A/B en dos archivos).

LÍMITES QUE QUEDAN (no los prometas; resuélvelos por otra vía o avísalos ANTES de entregar, con el segundo exacto y la regla):
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
