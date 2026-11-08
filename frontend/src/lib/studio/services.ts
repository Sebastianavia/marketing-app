/**
 * Servicios de la app y si el Estudio Claude puede usarlos. Lo leen Claude (herramienta `servicios`)
 * y la pantalla del estudio. Actualizar el estado cuando un servicio se termine de probar.
 *  - listo: probado con dinero real y Claude lo usa desde el estudio.
 *  - en_pruebas: funciona en su herramienta, pero aún no se ha probado de punta a punta.
 *  - en_construccion: no disponible desde el estudio (o simulado).
 */

export type ServiceStatus = 'listo' | 'en_pruebas' | 'en_construccion';

export interface StudioService {
  id: string;
  nombre: string;
  estado: ServiceStatus;
  /** Qué hace, en una línea. */
  hace: string;
  /** Costo aproximado. */
  costo: string;
  /** Herramientas de Claude que lo usan (vacío = solo desde su pantalla). */
  herramientas: string[];
}

export const STUDIO_SERVICES: StudioService[] = [
  {
    id: 'ugc',
    nombre: 'UGC Studio',
    estado: 'listo',
    hace: 'Storyboard con equipo de agentes (Gemini) + revisión de Claude → render con HeyGen → montaje.',
    costo: 'Storyboard $0 · render ≈ $0,035–0,05 por segundo',
    herramientas: ['ugc_storyboard', 'ugc_cambiar_escena', 'ugc_costo', 'ugc_renderizar', 'ugc_montar'],
  },
  {
    id: 'editor',
    nombre: 'Edición de video',
    estado: 'listo',
    hace: 'Claude edita un video: cortes, subtítulos, zooms, efectos de sonido, pantalla dividida, color.',
    costo: 'Transcripción ≈ $0,004/min · edición $0 (tu suscripción)',
    herramientas: ['editar_video', 'editar_mas'],
  },
  {
    id: 'director',
    nombre: 'Guion a video · Director',
    estado: 'en_pruebas',
    hace: 'Idea → guion → prompts → voz + tomas de apoyo → montaje. Falta probar la generación y el montaje con dinero.',
    costo: 'Voz ≈ $0,01 · tomas Veo ≈ $0,12 por 4 s',
    herramientas: [],
  },
  {
    id: 'avatar',
    nombre: 'Avatar Studio',
    estado: 'listo',
    hace: 'Foto (avatar guardado o adjunta) + texto o audio → persona hablando con labios sincronizados (voz ElevenLabs + HeyGen Avatar IV).',
    costo: 'Voz ≈ $0,04/1000 caracteres · video ≈ $0,05 por segundo',
    herramientas: ['avatares_y_voces', 'avatar_costo', 'avatar_video'],
  },
  {
    id: 'voz',
    nombre: 'Voice Studio',
    estado: 'listo',
    hace: 'Locuciones con ElevenLabs (voces clonadas o la predeterminada) → MP3 en la carpeta del proyecto, listo para un avatar o una edición.',
    costo: '≈ $0,04–0,10 por 1000 caracteres según el modelo',
    herramientas: ['avatares_y_voces', 'voz_costo', 'voz_generar'],
  },
  {
    id: 'imagenes',
    nombre: 'Creación de imágenes',
    estado: 'listo',
    hace: 'Imágenes realistas con un avatar guardado (su cara) y fotos de referencia (producto, ropa, lugar): GPT-Image-2, Seedream, Nano Banana.',
    costo: '≈ $0,018–0,20 por imagen según modelo y resolución',
    herramientas: ['avatares_y_voces', 'imagen_costo', 'imagen_crear'],
  },
  {
    id: 'genjutsu',
    nombre: 'Clonación y reemplazo (Genjutsu)',
    estado: 'listo',
    hace: 'Seedance 2.0 (Apimart): copia movimiento, cámara y pose de un video corto (1,8–15 s) y pone otra cara (avatar o foto), otro objeto o una voz nueva.',
    costo: 'Mini ≈ $0,03/s · Fast ≈ $0,04/s · Estándar ≈ $0,066/s (hasta 4K)',
    herramientas: ['avatares_y_voces', 'clonacion_costo', 'clonacion_video'],
  },
];
