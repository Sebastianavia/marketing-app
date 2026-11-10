import { z } from 'zod';

/**
 * Edición de video: perfiles guardados ("looks") y sus valores por defecto.
 * Archivo compartido por cliente y servidor (sin imports de Node).
 *
 * Un perfil reúne todo lo que se repite en cada edición: quién eres (para la IA),
 * reglas propias, formato, subtítulos, texto gancho y ritmo de cortes.
 */

export type EditFormat = '9:16' | '4:5' | '1:1';
export type SubtitleStyle = 'karaoke' | 'frase' | 'palabra' | 'pop' | 'caja_activa';
export type SubtitlePosition = 'arriba' | 'centro' | 'abajo';

export const EDIT_FORMATS: Array<{ id: EditFormat; label: string; size: { width: number; height: number } }> = [
  { id: '9:16', label: 'Reel / Story / TikTok (9:16)', size: { width: 1080, height: 1920 } },
  { id: '4:5', label: 'Feed vertical (4:5)', size: { width: 1080, height: 1350 } },
  { id: '1:1', label: 'Cuadrado (1:1)', size: { width: 1080, height: 1080 } },
];

export function formatSize(f: EditFormat): { width: number; height: number } {
  return (EDIT_FORMATS.find((x) => x.id === f) ?? EDIT_FORMATS[0]).size;
}

export type SocialNetwork = 'instagram' | 'tiktok' | 'shorts';

/**
 * Zona segura sobre un lienzo de 1080×1920: lo que tapan los botones y textos de cada app.
 * Instagram según la guía de Viegas (220/380/140); TikTok y Shorts, valores habituales de las plantillas de cada red.
 * En 4:5 y 1:1 se escala con la altura del lienzo.
 */
export const SOCIAL_NETWORKS: Array<{
  id: SocialNetwork;
  label: string;
  safe: { top: number; bottom: number; right: number };
  /** Duración máxima que admite la red para este formato (s). */
  maxSeg: number;
}> = [
  { id: 'instagram', label: 'Instagram Reels', safe: { top: 220, bottom: 380, right: 140 }, maxSeg: 180 },
  { id: 'tiktok', label: 'TikTok', safe: { top: 160, bottom: 440, right: 160 }, maxSeg: 600 },
  { id: 'shorts', label: 'YouTube Shorts', safe: { top: 200, bottom: 400, right: 120 }, maxSeg: 180 },
];

export function networkInfo(id: SocialNetwork | undefined) {
  return SOCIAL_NETWORKS.find((n) => n.id === id) ?? SOCIAL_NETWORKS[0];
}

/** Zona segura en píxeles del lienzo real del perfil. */
export function safeZone(red: SocialNetwork | undefined, formato: EditFormat) {
  const { height } = formatSize(formato);
  const k = height / 1920;
  const s = networkInfo(red).safe;
  return { top: Math.round(s.top * k), bottom: Math.round(s.bottom * k), right: Math.round(s.right * k) };
}

export type MusicChoice = 'ninguna' | 'pad' | 'pulso' | 'archivo';

export const MUSIC_CHOICES: Array<{ id: MusicChoice; label: string; hint: string }> = [
  { id: 'ninguna', label: 'Sin música', hint: 'Solo tu voz y los efectos' },
  { id: 'pad', label: 'Suave (generada)', hint: 'Acordes cálidos estilo lo-fi, la crea la app' },
  { id: 'pulso', label: 'Pulso synth (generada)', hint: 'Bajo y batería con energía, la crea la app' },
  { id: 'archivo', label: 'Mi música', hint: 'Un archivo de tu carpeta de música' },
];

export const SUBTITLE_STYLES: Array<{ id: SubtitleStyle; label: string; hint: string }> = [
  { id: 'karaoke', label: 'Karaoke', hint: 'Frase corta y la palabra que suena se pinta' },
  { id: 'palabra', label: 'Palabra a palabra', hint: 'Una palabra a la vez, con un pequeño salto' },
  { id: 'frase', label: 'Frase fija', hint: 'Frase corta sin animación; las palabras clave en color' },
  { id: 'pop', label: 'Aparecen al hablar', hint: 'Cada palabra entra con un rebote justo cuando se dice (estilo viral)' },
  { id: 'caja_activa', label: 'Caja en la palabra', hint: 'La palabra que suena lleva un bloque de color detrás' },
];

export const SUBTITLE_POSITIONS: Array<{ id: SubtitlePosition; label: string }> = [
  { id: 'arriba', label: 'Arriba' },
  { id: 'centro', label: 'Centro' },
  { id: 'abajo', label: 'Abajo' },
];

/**
 * Fuentes que trae Windows. Se puede escribir cualquier otra instalada en el PC
 * o copiar archivos .ttf/.otf a la carpeta de fuentes de la edición (ver /api/editor/system).
 */
export const FONT_SUGGESTIONS = [
  'Arial Black',
  'Impact',
  'Arial',
  'Segoe UI Black',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Bahnschrift',
];

export interface SubtitleSettings {
  activo: boolean;
  estilo: SubtitleStyle;
  fuente: string;
  /** Tamaño en píxeles sobre un video de 1080 de ancho. */
  tamano: number;
  mayusculas: boolean;
  colorTexto: string;
  colorResaltado: string;
  colorBorde: string;
  /** Grosor del borde en píxeles (0 = sin borde). */
  grosorBorde: number;
  /** Caja de color detrás del texto. */
  caja: boolean;
  colorCaja: string;
  posicion: SubtitlePosition;
  /** Máximo de palabras en pantalla a la vez. */
  palabrasPorLinea: number;
  /** Tamaño de la palabra clave respecto al resto (%). */
  escalaClave: number;
  /** Opacidad de la caja detrás del texto (%), p. ej. 85 = se ve un poco el video. */
  opacidadCaja: number;
}

export interface HookSettings {
  activo: boolean;
  colorTexto: string;
  colorFondo: string;
  tamano: number;
  /** Segundos que se ve el gancho al inicio. */
  duracionSeg: number;
  /** Fuente propia del gancho (vacío = la de los subtítulos). */
  fuente: string;
  mayusculas: boolean;
}

export type SignaturePosition = 'arriba' | 'abajo';

/** Firma o usuario siempre en pantalla (p. ej. "@santiagoruiz"), pequeño y discreto. */
export interface SignatureSettings {
  activo: boolean;
  texto: string;
  /** Vacío = la de los subtítulos. */
  fuente: string;
  tamano: number;
  color: string;
  /** Opacidad (%). */
  opacidad: number;
  posicion: SignaturePosition;
}

export const DEFAULT_SIGNATURE: SignatureSettings = {
  activo: false,
  texto: '',
  fuente: '',
  tamano: 34,
  color: '#FFFFFF',
  opacidad: 70,
  posicion: 'arriba',
};

export interface RhythmSettings {
  /** Pausas más largas que esto se recortan (segundos). */
  pausaMaxSeg: number;
  /** Aire que se deja antes y después de cada frase (segundos). */
  margenSeg: number;
  /** La IA marca falsos comienzos, repeticiones y muletillas para cortar. */
  quitarErrores: boolean;
  /** Acercamiento alterno en cada corte (efecto "jump cut"). */
  zoomEnCortes: boolean;
  /** Acercamiento lento y continuo dentro de cada plano (sin saltos). */
  zoomSuave: boolean;
  /** Porcentaje de acercamiento (5–25). */
  zoomPct: number;
  /** Iguala el volumen a lo que piden Instagram y TikTok. */
  normalizarAudio: boolean;
}

export interface SoundSettings {
  /** Filtro de graves, reducción de ruido y compresor suave en la voz. */
  limpiarVoz: boolean;
  musica: MusicChoice;
  /** Nombre del archivo en la carpeta de música (si musica = 'archivo'). */
  musicaArchivo: string;
  /** dB por debajo de la voz. */
  musicaBajoVozDb: number;
  /** dB extra que baja la música mientras hablas. */
  duckingDb: number;
  /** Interruptor general de efectos de sonido (si está apagado, no suena ninguno). */
  efectos: boolean;
  /** Golpe cuando aparece el texto gancho. */
  efectosGancho: boolean;
  /** Whoosh en los cortes con zoom. */
  efectosCortes: boolean;
  /** Whoosh/golpe cuando entra un gráfico o una palabra gigante. */
  efectosGraficos: boolean;
  /** dB por debajo de la voz. */
  efectosBajoVozDb: number;
}

export type GraphicsAmount = 'ninguno' | 'pocos' | 'equilibrado' | 'muchos';

export const GRAPHICS_AMOUNTS: Array<{ id: GraphicsAmount; label: string; hint: string; max: number }> = [
  { id: 'ninguno', label: 'Sin gráficos', hint: 'Solo subtítulos', max: 0 },
  { id: 'pocos', label: 'Pocos', hint: '2–3 tarjetas', max: 3 },
  { id: 'equilibrado', label: 'Equilibrado', hint: '4–6 gráficos', max: 6 },
  { id: 'muchos', label: 'Muchos', hint: 'Un cambio visual cada pocos segundos', max: 9 },
];

export interface GraphicsSettings {
  cantidad: GraphicsAmount;
  /** Palabras gigantes detrás de la cabeza (necesita el recorte; si no, van delante). */
  textoDetras: boolean;
  colorFondo: string;
  colorBorde: string;
  colorTexto: string;
  colorAcento: string;
  /** Opacidad de la tarjeta (%). */
  opacidad: number;
  /** Fuente de las cifras y las palabras gigantes. */
  fuenteImpacto: string;
  /** Ocultar los subtítulos mientras se ve un gráfico (una idea cada vez). */
  ocultarSubtitulos: boolean;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  cantidad: 'equilibrado',
  textoDetras: true,
  colorFondo: '#160A26',
  colorBorde: '#A855F7',
  colorTexto: '#FFFFFF',
  colorAcento: '#F2C84B',
  opacidad: 78,
  fuenteImpacto: 'Impact',
  ocultarSubtitulos: true,
};

export interface EditProfile {
  id: string;
  nombre: string;
  descripcion: string;
  creado: string;
  actualizado: string;
  /** Negocio, público y tono: contexto para la IA. */
  sobreTi: string;
  /** Reglas propias de edición que la IA debe seguir siempre. */
  instrucciones: string;
  formato: EditFormat;
  red: SocialNetwork;
  subtitulos: SubtitleSettings;
  gancho: HookSettings;
  ritmo: RhythmSettings;
  sonido: SoundSettings;
  graficos: GraphicsSettings;
  firma: SignatureSettings;
}

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color en formato #RRGGBB');

export const ProfileInputSchema = z.object({
  nombre: z.string().trim().min(2, 'El nombre necesita al menos 2 letras').max(60),
  descripcion: z.string().trim().max(200).default(''),
  sobreTi: z.string().trim().max(1500).default(''),
  instrucciones: z.string().trim().max(1500).default(''),
  formato: z.enum(['9:16', '4:5', '1:1']),
  red: z.enum(['instagram', 'tiktok', 'shorts']).default('instagram'),
  subtitulos: z.object({
    activo: z.boolean(),
    estilo: z.enum(['karaoke', 'frase', 'palabra', 'pop', 'caja_activa']),
    fuente: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[\p{L}\p{N} ._-]+$/u, 'La fuente solo puede tener letras, números, espacios, punto, guion y guion bajo'),
    tamano: z.number().int().min(30).max(160),
    mayusculas: z.boolean(),
    colorTexto: hex,
    colorResaltado: hex,
    colorBorde: hex,
    grosorBorde: z.number().min(0).max(12),
    caja: z.boolean(),
    colorCaja: hex,
    posicion: z.enum(['arriba', 'centro', 'abajo']),
    palabrasPorLinea: z.number().int().min(1).max(8),
    escalaClave: z.number().min(100).max(250).default(130),
    opacidadCaja: z.number().min(30).max(100).default(100),
  }),
  gancho: z.object({
    activo: z.boolean(),
    colorTexto: hex,
    colorFondo: hex,
    tamano: z.number().int().min(30).max(140),
    duracionSeg: z.number().min(1).max(10),
    fuente: z
      .string()
      .trim()
      .max(60)
      .regex(/^[\p{L}\p{N} ._-]*$/u, 'La fuente solo puede tener letras, números, espacios, punto, guion y guion bajo')
      .default(''),
    mayusculas: z.boolean().default(true),
  }),
  ritmo: z.object({
    pausaMaxSeg: z.number().min(0.15).max(2),
    margenSeg: z.number().min(0).max(0.4),
    quitarErrores: z.boolean(),
    zoomEnCortes: z.boolean(),
    zoomSuave: z.boolean().default(false),
    zoomPct: z.number().min(5).max(25),
    normalizarAudio: z.boolean(),
  }),
  sonido: z
    .object({
      limpiarVoz: z.boolean(),
      musica: z.enum(['ninguna', 'pad', 'pulso', 'archivo']),
      musicaArchivo: z
        .string()
        .trim()
        .max(200)
        .regex(/^[^\\/:*?"<>|]*$/, 'Nombre de archivo de música no válido'),
      musicaBajoVozDb: z.number().min(6).max(30),
      duckingDb: z.number().min(0).max(15),
      efectos: z.boolean(),
      efectosGancho: z.boolean().default(true),
      efectosCortes: z.boolean().default(true),
      efectosGraficos: z.boolean().default(true),
      efectosBajoVozDb: z.number().min(10).max(35),
    })
    .default(() => ({ ...DEFAULT_SOUND })),
  graficos: z
    .object({
      cantidad: z.enum(['ninguno', 'pocos', 'equilibrado', 'muchos']),
      textoDetras: z.boolean(),
      colorFondo: hex,
      colorBorde: hex,
      colorTexto: hex,
      colorAcento: hex,
      opacidad: z.number().min(30).max(100),
      fuenteImpacto: z
        .string()
        .trim()
        .min(2)
        .max(60)
        .regex(/^[\p{L}\p{N} ._-]+$/u, 'La fuente solo puede tener letras, números, espacios, punto, guion y guion bajo'),
      ocultarSubtitulos: z.boolean(),
    })
    .default(() => ({ ...DEFAULT_GRAPHICS })),
  firma: z
    .object({
      activo: z.boolean(),
      texto: z.string().trim().max(40).default(''),
      fuente: z
        .string()
        .trim()
        .max(60)
        .regex(/^[\p{L}\p{N} ._-]*$/u, 'La fuente solo puede tener letras, números, espacios, punto, guion y guion bajo')
        .default(''),
      tamano: z.number().int().min(20).max(80),
      color: hex,
      opacidad: z.number().min(20).max(100),
      posicion: z.enum(['arriba', 'abajo']),
    })
    .default(() => ({ ...DEFAULT_SIGNATURE })),
});

export type ProfileInput = z.infer<typeof ProfileInputSchema>;

/** Sonido por defecto: los números de la guía (música 12 dB bajo la voz, ducking 7 dB, efectos 20–25 dB bajo la voz). */
export const DEFAULT_SOUND: SoundSettings = {
  limpiarVoz: true,
  musica: 'ninguna',
  musicaArchivo: '',
  musicaBajoVozDb: 12,
  duckingDb: 7,
  efectos: true,
  efectosGancho: true,
  efectosCortes: true,
  efectosGraficos: true,
  efectosBajoVozDb: 22,
};

/** Perfiles con los que arranca la biblioteca (se crean una vez; luego son tuyos y editables). */
export const DEFAULT_PROFILES: ProfileInput[] = [
  {
    nombre: 'Lulo energía',
    descripcion: 'Blanco con la palabra que suena en lima. Cortes rápidos con zoom.',
    sobreTi: '',
    instrucciones: '',
    formato: '9:16',
    red: 'instagram',
    subtitulos: {
      activo: true,
      estilo: 'karaoke',
      fuente: 'Arial Black',
      tamano: 78,
      mayusculas: true,
      colorTexto: '#FFFFFF',
      colorResaltado: '#C6FF3D',
      colorBorde: '#000000',
      grosorBorde: 5,
      caja: false,
      colorCaja: '#000000',
      posicion: 'abajo',
      palabrasPorLinea: 3,
      escalaClave: 125,
      opacidadCaja: 100,
    },
    gancho: { activo: true, colorTexto: '#0A0A0B', colorFondo: '#C6FF3D', tamano: 70, duracionSeg: 3, fuente: '', mayusculas: true },
    ritmo: { pausaMaxSeg: 0.3, margenSeg: 0.08, quitarErrores: true, zoomEnCortes: true, zoomSuave: false, zoomPct: 12, normalizarAudio: true },
    sonido: { ...DEFAULT_SOUND, musica: 'pulso' },
    graficos: { ...DEFAULT_GRAPHICS, colorFondo: '#0A0A0B', colorBorde: '#C6FF3D', colorAcento: '#C6FF3D' },
    firma: { ...DEFAULT_SIGNATURE },
  },
  {
    nombre: 'Autoridad',
    descripcion: 'Negro, blanco y amarillo eléctrico. Directo y con peso.',
    sobreTi: '',
    instrucciones: '',
    formato: '9:16',
    red: 'instagram',
    subtitulos: {
      activo: true,
      estilo: 'palabra',
      fuente: 'Impact',
      tamano: 96,
      mayusculas: true,
      colorTexto: '#FFFFFF',
      colorResaltado: '#FFD60A',
      colorBorde: '#000000',
      grosorBorde: 6,
      caja: false,
      colorCaja: '#000000',
      posicion: 'centro',
      palabrasPorLinea: 1,
      escalaClave: 120,
      opacidadCaja: 100,
    },
    gancho: { activo: true, colorTexto: '#000000', colorFondo: '#FFD60A', tamano: 72, duracionSeg: 3, fuente: '', mayusculas: true },
    ritmo: { pausaMaxSeg: 0.25, margenSeg: 0.06, quitarErrores: true, zoomEnCortes: true, zoomSuave: false, zoomPct: 15, normalizarAudio: true },
    sonido: { ...DEFAULT_SOUND },
    graficos: { ...DEFAULT_GRAPHICS, colorFondo: '#000000', colorBorde: '#FFD60A', colorAcento: '#FFD60A' },
    firma: { ...DEFAULT_SIGNATURE },
  },
  {
    nombre: 'Minimal',
    descripcion: 'Texto sobrio en caja oscura. Sin zoom, ritmo natural.',
    sobreTi: '',
    instrucciones: '',
    formato: '9:16',
    red: 'instagram',
    subtitulos: {
      activo: true,
      estilo: 'frase',
      fuente: 'Segoe UI',
      tamano: 58,
      mayusculas: false,
      colorTexto: '#FFFFFF',
      colorResaltado: '#FFFFFF',
      colorBorde: '#000000',
      grosorBorde: 0,
      caja: true,
      colorCaja: '#111111',
      posicion: 'abajo',
      palabrasPorLinea: 5,
      escalaClave: 115,
      opacidadCaja: 100,
    },
    gancho: { activo: false, colorTexto: '#FFFFFF', colorFondo: '#111111', tamano: 60, duracionSeg: 3, fuente: '', mayusculas: true },
    ritmo: { pausaMaxSeg: 0.5, margenSeg: 0.12, quitarErrores: true, zoomEnCortes: false, zoomSuave: true, zoomPct: 10, normalizarAudio: true },
    sonido: { ...DEFAULT_SOUND, musica: 'pad', efectos: false },
    graficos: { ...DEFAULT_GRAPHICS, cantidad: 'pocos', textoDetras: false, colorFondo: '#111111', colorBorde: '#FFFFFF', colorAcento: '#FFFFFF', opacidad: 85, fuenteImpacto: 'Segoe UI Black' },
    firma: { ...DEFAULT_SIGNATURE },
  },
];

/** Copia profunda de un perfil por defecto para "Nuevo perfil". */
export function blankProfileInput(): ProfileInput {
  const base = JSON.parse(JSON.stringify(DEFAULT_PROFILES[0])) as ProfileInput;
  return { ...base, nombre: '', descripcion: '' };
}
