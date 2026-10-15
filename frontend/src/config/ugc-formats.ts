/**
 * Catálogo de producción del UGC Studio: formatos de video, estilos visuales e idiomas.
 * Fuente única para la UI (ajustes), el agente creativo y el equipo de agentes (bloque PRODUCCIÓN).
 */

export const UGC_FORMAT_IDS = [
  'testimonio',
  'problema_solucion',
  'unboxing',
  'tutorial',
  'resena',
  'antes_despues',
  'grwm',
  'pov',
  'tres_razones',
] as const;
export type UgcFormatId = (typeof UGC_FORMAT_IDS)[number];
export type UgcFormatSetting = UgcFormatId | 'auto';

export interface UgcFormat {
  id: UgcFormatId;
  label: string;
  description: string; // para el usuario y el agente creativo
  structure: string; // arco de escenas que sigue el director
  hook: string; // tipo de gancho de los primeros 2 s
  shots: string; // planos y acciones típicos
  cta: string;
}

export const UGC_FORMATS: UgcFormat[] = [
  {
    id: 'testimonio',
    label: 'Testimonio',
    description: 'El creador cuenta su experiencia real con el producto, como a un amigo.',
    structure: 'Gancho personal → contexto de su vida antes del producto → cómo lo usa y qué notó → recomendación honesta.',
    hook: 'Confesión o frase en primera persona ("Llevo un mes usando esto y…").',
    shots: 'Plano medio hablando a cámara, producto en la mano, un momento de uso real, gesto de complicidad.',
    cta: 'Recomendación cercana ("si te pasa lo mismo, pruébalo").',
  },
  {
    id: 'problema_solucion',
    label: 'Problema → solución',
    description: 'Muestra un problema con el que la audiencia se identifica y el producto como la salida.',
    structure: 'Problema reconocible (frustración visible) → aparece el producto → demostración rápida → resultado y alivio.',
    hook: 'Pregunta o queja que la audiencia reconoce ("¿Te pasa que…?").',
    shots: 'Gesto de frustración, el producto entra en cuadro, demostración del uso, reacción de alivio o satisfacción.',
    cta: 'Invitación directa a resolverlo ahora (enlace, código, descuento).',
  },
  {
    id: 'unboxing',
    label: 'Unboxing',
    description: 'Abre el empaque en cámara y reacciona a lo que trae.',
    structure: 'Llega el paquete o la caja → abrirlo con expectativa → mostrar cada elemento y su detalle → primera impresión.',
    hook: 'Expectativa ("Por fin llegó…") con el empaque cerrado en cuadro.',
    shots: 'Manos abriendo el empaque, primeros planos del producto y la etiqueta, reacción del creador.',
    cta: 'Dónde conseguirlo y por qué vale la pena.',
  },
  {
    id: 'tutorial',
    label: 'Tutorial paso a paso',
    description: 'Enseña a usar el producto en pasos claros.',
    structure: 'Qué vamos a lograr → paso 1 → paso 2 → (paso 3) → resultado final.',
    hook: 'Promesa de resultado ("Así se usa para que dure el doble").',
    shots: 'Cada paso con una acción clara de las manos y el producto, el creador explicando mientras lo hace.',
    cta: 'Guardar el video o comprar para probarlo.',
  },
  {
    id: 'resena',
    label: 'Reseña honesta',
    description: 'Opina del producto con pros (y algún matiz) para ganar credibilidad.',
    structure: 'Veredicto adelantado → lo que más le gustó → un matiz honesto → para quién sí es.',
    hook: 'Veredicto directo ("Te digo la verdad sobre…").',
    shots: 'Producto en mano mirándolo con atención, detalle de textura o uso, gesto de aprobación.',
    cta: 'Recomendación con criterio ("si buscas X, es para ti").',
  },
  {
    id: 'antes_despues',
    label: 'Antes y después',
    description: 'Contrasta la situación sin el producto y con él.',
    structure: 'Antes (situación o estado sin el producto) → uso del producto → después (resultado visible).',
    hook: 'Mostrar el "antes" y prometer el cambio ("Mira esto…").',
    shots: 'Mismo encuadre para el antes y el después, demostración del uso entre ambos, reacción al resultado.',
    cta: 'Lograr el mismo cambio con el producto.',
  },
  {
    id: 'grwm',
    label: 'Get ready with me',
    description: 'El creador se arregla o prepara su rutina y el producto aparece de forma natural.',
    structure: 'Empieza la rutina conversando → el producto entra como paso de la rutina → resultado y salida.',
    hook: 'Plan del día o anécdota ("Arréglate conmigo que hoy…").',
    shots: 'Frente al espejo o tocador, acciones de rutina continuas, el producto usado como un paso más.',
    cta: 'Mención casual de dónde lo compra.',
  },
  {
    id: 'pov',
    label: 'POV',
    description: 'Situación en segunda persona ("POV: …") que el espectador vive a través del creador.',
    structure: 'Situación POV planteada en el gancho → giro donde aparece el producto → remate.',
    hook: 'Texto o frase "POV: …" con una situación cotidiana o graciosa.',
    shots: 'Actuación expresiva hacia cámara como si fuera el espectador, el producto resuelve el momento.',
    cta: 'Remate corto y memorable con el producto.',
  },
  {
    id: 'tres_razones',
    label: '3 razones para…',
    description: 'Lista rápida de motivos para comprar o probar el producto.',
    structure: 'Gancho con la promesa de la lista → razón 1 → razón 2 → razón 3 → cierre.',
    hook: '"3 razones por las que…" con el producto en cuadro.',
    shots: 'Cada razón con una acción o detalle distinto del producto, ritmo rápido y gestos que marcan el número.',
    cta: 'La razón final empuja a la compra.',
  },
];

export const UGC_VISUAL_STYLES = ['celular', 'estudio', 'cinematografico'] as const;
export type UgcVisualStyle = (typeof UGC_VISUAL_STYLES)[number];

export const VISUAL_STYLE_INFO: Record<UgcVisualStyle, { label: string; description: string; prompt: string; camera: string }> = {
  celular: {
    label: 'Celular (UGC clásico)',
    description: 'Grabado con el celular en mano o selfie, luz natural, auténtico.',
    prompt: 'Vertical UGC video shot on a handheld smartphone, natural light, authentic creator look.',
    camera: 'handheld smartphone or selfie with natural micro-movement',
  },
  estudio: {
    label: 'Estudio',
    description: 'Set limpio con luz suave de estudio y cámara en trípode o slider.',
    prompt: 'Clean studio set, soft diffused key light, crisp professional camera, polished commercial look.',
    camera: 'camera on a tripod or slow slider move, smooth and precise',
  },
  cinematografico: {
    label: 'Cinematográfico',
    description: 'Look de cine: profundidad de campo, luz motivada, movimientos de gimbal.',
    prompt: 'Cinematic look, shallow depth of field, motivated lighting, rich color grade, filmic texture.',
    camera: 'smooth gimbal or dolly movement with intentional framing',
  },
};

export const UGC_LANGUAGES = ['es', 'en', 'pt'] as const;
export type UgcLanguage = (typeof UGC_LANGUAGES)[number];

export const LANGUAGE_INFO: Record<UgcLanguage, { label: string; promptName: string }> = {
  es: { label: 'Español', promptName: 'Spanish' },
  en: { label: 'Inglés', promptName: 'English' },
  pt: { label: 'Portugués (Brasil)', promptName: 'Brazilian Portuguese' },
};

const ASPECT_TEXT: Record<string, string> = {
  '9:16': 'vertical 9:16 (en el prompt: "Vertical 9:16 video")',
  '1:1': 'cuadrado 1:1 (en el prompt: "Square 1:1 video")',
  '16:9': 'horizontal 16:9 (en el prompt: "Horizontal 16:9 video")',
};

export const formatById = (id: string | undefined) => UGC_FORMATS.find((f) => f.id === id);

/**
 * Bloque PRODUCCIÓN que reciben los agentes: estilo visual, idioma y formato. Tiene prioridad sobre
 * los ejemplos de sus instrucciones (escritas pensando en UGC de celular en español).
 * `formatId` = el formato ya elegido para el storyboard; si no, el de los ajustes ('auto' = el director elige).
 */
export function productionBlock(
  settings: { language: UgcLanguage; visualStyle: UgcVisualStyle; format: UgcFormatSetting; aspectRatio?: string },
  formatId?: string
): string {
  const style = VISUAL_STYLE_INFO[settings.visualStyle];
  const language = LANGUAGE_INFO[settings.language];
  const chosen = formatById(formatId) ?? formatById(settings.format);
  const format = chosen
    ? `FORMATO: ${chosen.label} (${chosen.id}). ${chosen.description}\n- Estructura: ${chosen.structure}\n- Gancho: ${chosen.hook}\n- Planos típicos: ${chosen.shots}\n- CTA: ${chosen.cta}`
    : `FORMATO: libre. El director elige el que mejor sirva al objetivo entre: ${UGC_FORMATS.map((f) => `${f.id} (${f.description})`).join('; ')}.`;
  return `PRODUCCIÓN (tiene prioridad sobre cualquier ejemplo de tus instrucciones):
- PANTALLA: ${ASPECT_TEXT[settings.aspectRatio ?? '9:16'] ?? ASPECT_TEXT['9:16']}
- ESTILO VISUAL: ${style.label}. ${style.description} Cámara: ${style.camera}. En inglés para el prompt: "${style.prompt}"
- IDIOMA del diálogo hablado: ${language.label} (en el prompt: "${language.promptName}"). Todo lo que el personaje dice va en este idioma; el resto del JSON sigue en español.
- ${format}`;
}
