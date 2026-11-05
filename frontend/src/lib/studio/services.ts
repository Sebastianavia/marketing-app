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
    estado: 'en_pruebas',
    hace: 'Locuciones con ElevenLabs y voces clonadas. Funciona en su pantalla; aún no desde el estudio.',
    costo: '≈ $0,04 por 1000 caracteres',
    herramientas: [],
  },
  {
    id: 'imagenes',
    nombre: 'Creación de imágenes',
    estado: 'en_pruebas',
    hace: 'Imágenes con avatar y referencias (Seedream). Funciona en su pantalla; aún no desde el estudio.',
    costo: '≈ $0,018 por imagen',
    herramientas: [],
  },
  {
    id: 'genjutsu',
    nombre: 'Clonación y reemplazo (Genjutsu)',
    estado: 'en_construccion',
    hace: 'Cambio de cara. Todavía es una simulación.',
    costo: '—',
    herramientas: [],
  },
  {
    id: 'buzzy',
    nombre: 'Buzzy',
    estado: 'en_construccion',
    hace: 'Plataforma externa de video. Falta la conexión (URL y clave del MCP).',
    costo: '—',
    herramientas: [],
  },
];
