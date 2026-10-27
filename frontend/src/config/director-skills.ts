import { DEFAULT_BROLL_MODEL, type VoiceMode } from '@/config/broll-models';

/**
 * Skills del modo Director (plantillas basadas en los skills de Buzzy: ai-story, ugc-ads, faceless-reels).
 * Cada una fija ajustes por defecto, sobre qué pregunta la IA y la forma del guion.
 * Se guarda en produccion.json → director.skill (opcional: los borradores viejos no la tienen).
 */

export type DirectorSkillId = 'pelicula' | 'ugc' | 'presentador' | 'explicativo';

export interface DirectorSkill {
  id: DirectorSkillId;
  nombre: string;
  descripcion: string;
  /** Emoji del selector. */
  icono: string;
  ajustes: {
    formato: '9:16' | '16:9' | '1:1';
    duracionSeg: number;
    modoVoz: VoiceMode;
    modeloBroll: string;
  };
  /** Ejemplos que rellenan la caja de inicio. */
  ejemplos: string[];
  placeholder: string;
  /** Para la IA: sobre qué hacer las 2 preguntas de dirección. */
  preguntasSobre: string;
  /** Para la IA: forma del guion. */
  formaGuion: string;
  /** Para la IA: matiz de los prompts de video. */
  notaPrompts: string;
}

export const DIRECTOR_SKILLS: DirectorSkill[] = [
  {
    id: 'pelicula',
    nombre: 'Película corta',
    descripcion: 'Una historia con personajes que hablan.',
    icono: '🎬',
    ajustes: { formato: '9:16', duracionSeg: 45, modoVoz: 'native', modeloBroll: DEFAULT_BROLL_MODEL },
    ejemplos: [
      'Una abuela enseña a su nieto la receta secreta de la familia antes de mudarse.',
      'Dos amigos encuentran una cámara vieja con un último rollo sin revelar.',
      'Una repartidora en bicicleta llega tarde a la entrega más importante del día.',
    ],
    placeholder: 'Cuenta la historia o pega el guion con los diálogos…',
    preguntasSobre: 'el género y el tono de la historia, y cómo termina (final abierto, sorpresa, emotivo…).',
    formaGuion:
      'Historia con arco: inicio que presenta al personaje y su deseo, conflicto, cierre. Personajes con rasgos fijos (edad, aspecto, ropa) repetidos igual en cada escena. Diálogos cortos y naturales, nada de narrador.',
    notaPrompts: 'Encuadres de cine (plano general para situar, medio para diálogo, detalle para emoción), siempre con los mismos rasgos de cada personaje.',
  },
  {
    id: 'ugc',
    nombre: 'Anuncio UGC',
    descripcion: 'Una persona real recomienda tu producto, estilo selfie.',
    icono: '📱',
    ajustes: { formato: '9:16', duracionSeg: 30, modoVoz: 'avatar', modeloBroll: DEFAULT_BROLL_MODEL },
    ejemplos: [
      'Sérum de vitamina C para piel apagada, para mujeres de 25 a 40.',
      'Botella térmica que mantiene el café caliente 12 horas.',
      'App para organizar las finanzas del hogar en pareja.',
    ],
    placeholder: 'Producto, a quién va dirigido y qué lo hace distinto…',
    preguntasSobre: 'el ángulo del gancho (dolor, curiosidad, resultado) y el tipo de prueba (testimonio, demo, antes y después).',
    formaGuion:
      'Anuncio UGC: gancho en los primeros 3 segundos → problema que la persona reconoce → demostración del producto en uso → prueba (resultado, testimonio) → llamado a la acción claro. Tono de persona real hablando a su celular, frases cortas.',
    notaPrompts: 'Estilo grabado con celular: cámara en mano, luz de casa, producto real en primer plano en las tomas de apoyo.',
  },
  {
    id: 'presentador',
    nombre: 'Video con presentador',
    descripcion: 'Tu avatar explica a cámara con cortes a lo que cuenta.',
    icono: '🎤',
    ajustes: { formato: '9:16', duracionSeg: 45, modoVoz: 'avatar', modeloBroll: DEFAULT_BROLL_MODEL },
    ejemplos: [
      'Tres errores que cometen los emprendedores al poner precio a su servicio.',
      'Qué es la inteligencia artificial generativa, explicado en 45 segundos.',
      'Cómo elegir el protector solar según tu tipo de piel.',
    ],
    placeholder: 'Tema que explica el presentador, o pega su guion…',
    preguntasSobre: 'a quién le habla el presentador (nivel de conocimiento) y qué quiere que haga al final.',
    formaGuion:
      'La primera y la última escena son de la persona hablando a cámara. Entre medio, cortes a tomas de apoyo que muestran lo que se explica, alternando con la persona. Un solo mensaje claro.',
    notaPrompts: 'Tomas de apoyo que ilustran literalmente lo que se dice en esa escena.',
  },
  {
    id: 'explicativo',
    nombre: 'Explicativo sin rostro',
    descripcion: 'Voz en off sobre tomas de apoyo, sin nadie a cámara.',
    icono: '🧩',
    ajustes: { formato: '9:16', duracionSeg: 30, modoVoz: 'voiceover', modeloBroll: DEFAULT_BROLL_MODEL },
    ejemplos: [
      '5 datos sorprendentes sobre el café que casi nadie sabe.',
      'Por qué tu planta de interior se pone amarilla y cómo salvarla.',
      'Cómo funciona el interés compuesto, con un ejemplo de la vida real.',
    ],
    placeholder: 'Tema del video y los puntos que no pueden faltar…',
    preguntasSobre: 'el ángulo del tema (curiosidad, error común, paso a paso) y cuántos puntos tendrá (3, 4 o 5).',
    formaGuion:
      'Video explicativo sin rostro: gancho con pregunta o dato en la primera escena → de 3 a 5 puntos, uno por escena → cierre con resumen o llamado. Todo con voz en off; nadie habla a cámara.',
    notaPrompts: 'Tomas visuales y concretas de cada punto (objetos, manos, lugares), sin personas hablando.',
  },
];

export const DEFAULT_SKILL: DirectorSkillId = 'ugc';

export function getDirectorSkill(id: string | undefined | null): DirectorSkill | null {
  return DIRECTOR_SKILLS.find((s) => s.id === id) ?? null;
}
