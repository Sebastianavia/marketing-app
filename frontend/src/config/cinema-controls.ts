/**
 * Controles visuales de dirección de fotografía (estilo Buzzy Canvas):
 * - Píldoras de encuadre, ángulo, movimiento de cámara e iluminación para escenas y prompts ($0).
 * - Modos de ADN visual para etiquetas (@personaje Turnaround 3 vistas, @lugar escenario vacío).
 * - Biblioteca rápida de looks para etiquetas @estilo.
 */

export interface CinemaPill {
  id: string;
  label: string;
  /** Texto corto en español para "qué se ve" en la escena. */
  es: string;
  /** Instrucción técnica en inglés para el prompt de imagen/video. */
  en: string;
}

export interface CinemaCategory {
  id: 'plano' | 'angulo' | 'movimiento' | 'luz';
  nombre: string;
  opciones: CinemaPill[];
}

export const CINEMA_CATEGORIES: CinemaCategory[] = [
  {
    id: 'plano',
    nombre: 'Plano',
    opciones: [
      {
        id: 'ecu',
        label: 'Detalle (ECU)',
        es: 'plano detalle extremo',
        en: 'Extreme close-up macro shot focusing on fine texture and detail.',
      },
      {
        id: 'cu',
        label: 'Primer plano',
        es: 'primer plano de rostro y hombros',
        en: 'Close-up shot framing face and shoulders with shallow depth of field.',
      },
      {
        id: 'ms',
        label: 'Plano medio',
        es: 'plano medio de cintura para arriba',
        en: 'Medium waist-up shot with natural conversational framing.',
      },
      {
        id: 'americano',
        label: 'Plano americano',
        es: 'plano americano de rodillas para arriba',
        en: 'Medium-wide knee-up shot showing body language and surroundings.',
      },
      {
        id: 'ws',
        label: 'Plano general',
        es: 'plano general amplio mostrando el lugar',
        en: 'Wide establishing shot showing the full subject within the environment.',
      },
    ],
  },
  {
    id: 'angulo',
    nombre: 'Ángulo',
    opciones: [
      {
        id: 'ojos',
        label: 'Nivel de ojos',
        es: 'cámara a la altura de los ojos',
        en: 'Neutral eye-level camera angle.',
      },
      {
        id: 'contrapicado',
        label: 'Contrapicado',
        es: 'ángulo contrapicado mirando ligeramente hacia arriba',
        en: 'Subtle low-angle perspective looking slightly up at the subject.',
      },
      {
        id: 'picado',
        label: 'Picado',
        es: 'ángulo picado mirando ligeramente hacia abajo',
        en: 'High-angle perspective looking down towards the subject.',
      },
      {
        id: 'ots',
        label: 'Sobre el hombro',
        es: 'toma sobre el hombro (OTS)',
        en: 'Over-the-shoulder perspective with foreground blur.',
      },
      {
        id: 'cenital',
        label: 'Cenital',
        es: 'plano cenital desde arriba',
        en: "Top-down overhead bird's-eye view.",
      },
    ],
  },
  {
    id: 'movimiento',
    nombre: 'Cámara',
    opciones: [
      {
        id: 'mano',
        label: 'En mano real',
        es: 'cámara en mano con movimiento orgánico',
        en: 'Handheld camera with natural micro-shake and human breathing motion.',
      },
      {
        id: 'dolly-in',
        label: 'Acercamiento lento',
        es: 'acercamiento lento hacia el sujeto',
        en: 'Slow, subtle push-in camera movement towards the subject.',
      },
      {
        id: 'paneo',
        label: 'Paneo suave',
        es: 'paneo lateral suave siguiendo la acción',
        en: 'Smooth horizontal panning movement following the action.',
      },
      {
        id: 'tracking',
        label: 'Seguimiento',
        es: 'cámara acompañando en movimiento al sujeto',
        en: 'Dynamic handheld tracking shot moving alongside the subject.',
      },
      {
        id: 'fijo',
        label: 'Fijo',
        es: 'encuadre fijo sin desplazamiento',
        en: 'Stationary framing with minimal camera drift.',
      },
    ],
  },
  {
    id: 'luz',
    nombre: 'Luz',
    opciones: [
      {
        id: 'ventana',
        label: 'Luz de ventana',
        es: 'luz natural suave de ventana',
        en: 'Soft natural side window daylight with realistic shadow falloff.',
      },
      {
        id: 'dorada',
        label: 'Hora dorada',
        es: 'luz cálida de atardecer',
        en: 'Warm golden hour sunlight with soft long shadows.',
      },
      {
        id: 'noche',
        label: 'Noche / Neón',
        es: 'ambiente nocturno con luces reales del lugar',
        en: 'Nighttime ambiance lit only by practical street and indoor lights.',
      },
      {
        id: 'interior',
        label: 'Interior cálido',
        es: 'luz interior cálida de lámparas reales',
        en: 'Warm practical indoor tungsten lighting from existing lamps.',
      },
      {
        id: 'dramatica',
        label: 'Contraste alto',
        es: 'iluminación lateral con sombras marcadas',
        en: 'High-contrast directional side light with deep natural shadows.',
      },
    ],
  },
];

export type CharacterRefMode = 'portrait' | 'turnaround';

export const CHARACTER_REF_MODES: Array<{ id: CharacterRefMode; label: string; hint: string; buildPrompt: (desc: string, name: string) => string }> = [
  {
    id: 'turnaround',
    label: 'Ficha 3 vistas (Frente · Perfil · 3/4)',
    hint: 'Como Buzzy: genera a la persona en 3 ángulos con la misma ropa para que nunca cambie de cara al girar.',
    buildPrompt: (desc, name) =>
      `Three-view character turnaround reference sheet of ${name} (${desc}). Show the exact same person side by side in three angles: front view, 3/4 view, and side profile view, wearing the exact same clothing, neutral plain indoor wall background, consistent natural daylight, realistic skin texture with pores and natural asymmetry, no text or labels.`,
  },
  {
    id: 'portrait',
    label: 'Retrato realista (1 vista)',
    hint: 'Un solo retrato de cintura para arriba con luz natural realista.',
    buildPrompt: (desc, name) =>
      `Realistic waist-up portrait photo of ${name} (${desc}), natural indoor lighting, looking at camera, realistic skin texture with pores, no text or watermarks.`,
  },
];

export const EMPTY_SET_PROMPT_PREFIX =
  'Empty location establishing plate, NO people, NO characters, nobody in frame. Show only the environment, architecture, props and natural lighting of: ';

export interface StylePreset {
  id: string;
  nombre: string;
  icono: string;
  descripcionEn: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'ugc-iphone',
    nombre: 'UGC iPhone Real',
    icono: '📱',
    descripcionEn:
      'Shot on iPhone front camera, natural indoor ambient light, slightly wide lens, authentic social media creator look, zero studio polish, natural skin tone.',
  },
  {
    id: 'kodak-35mm',
    nombre: 'Cine 35mm Kodak',
    icono: '🎞️',
    descripcionEn:
      '35mm Kodak Vision3 500T film stock aesthetic, organic halation, fine analog grain, muted highlights, rich natural shadow contrast, spherical prime lens.',
  },
  {
    id: 'docu-natural',
    nombre: 'Documental Luz Día',
    icono: '🌿',
    descripcionEn:
      'Observational documentary cinematography, available daylight only, handheld 35mm lens, neutral earthy color palette, authentic lived-in textures.',
  },
  {
    id: 'comercial-limpio',
    nombre: 'Producto Editorial',
    icono: '✨',
    descripcionEn:
      'Clean editorial product cinematography, soft diffused key light, crisp tactile surface details, warm neutral background, shallow depth of field.',
  },
  {
    id: 'noir-urbano',
    nombre: 'Noche Urbana',
    icono: '🌃',
    descripcionEn:
      'Moody night urban cinematography, practical sodium vapor and shopfront lights, wet asphalt reflections, deep shadows, natural high-ISO sensor grain.',
  },
  {
    id: 'calido-hogar',
    nombre: 'Hogar Cálido',
    icono: '☕',
    descripcionEn:
      'Cozy morning home atmosphere, warm sunlight streaming through curtains, soft natural contrast, inviting domestic textures, 50mm lens look.',
  },
];

