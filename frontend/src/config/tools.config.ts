import {
  AudioLines,
  Clapperboard,
  FolderOpen,
  LayoutGrid,
  ScanFace,
  UserRound,
  Megaphone,
  Sparkles,
  Receipt,
  type LucideIcon,
} from 'lucide-react';

/**
 * Catálogo único de herramientas: lo usan el dashboard, la barra lateral,
 * los atajos de teclado y el encabezado del modo enfoque.
 */
export type ToolId =
  | 'avatar-studio'
  | 'deep-swap'
  | 'ugc-generator'
  | 'text-to-video'
  | 'voice-studio'
  | 'buzzy'
  | 'projects'
  | 'costs';

export interface ToolDefinition {
  id: ToolId;
  title: string;
  /** Una línea: qué entra y qué sale. */
  formula: string;
  description: string;
  icon: LucideIcon;
  /** Proveedores reales detrás de la herramienta (texto discreto en la tarjeta). */
  engines?: string;
  /** Herramientas cuyo flujo todavía es una simulación. */
  preview?: boolean;
  shortcut: string;
}

export const TOOLS: Record<ToolId, ToolDefinition> = {
  'avatar-studio': {
    id: 'avatar-studio',
    title: 'Avatar Studio',
    formula: 'Foto + voz → video hablado',
    description:
      'Convierte un retrato y una locución en un presentador con sincronización labial, listo para anuncios verticales.',
    icon: UserRound,
    engines: 'ElevenLabs · HeyGen Avatar IV',
    shortcut: '1',
  },
  'deep-swap': {
    id: 'deep-swap',
    title: 'Clonación y reemplazo',
    formula: 'Video + foto → sujeto reemplazado',
    description:
      'Sustituye a la persona de un video existente a partir de una sola foto frontal, conservando gestos y audio.',
    icon: ScanFace,
    preview: true,
    shortcut: '2',
  },
  'ugc-generator': {
    id: 'ugc-generator',
    title: 'Generador UGC',
    formula: 'Brief → anuncio estilo creador',
    description:
      'Escribe el guion persuasivo y produce piezas 9:16 con el tono natural de contenido hecho por usuarios.',
    icon: Megaphone,
    engines: 'OpenRouter · Hailuo · Kling · Seedance',
    shortcut: '3',
  },
  'text-to-video': {
    id: 'text-to-video',
    title: 'Guion a video',
    formula: 'Guion, idea o PDF → video por escenas',
    description:
      'Arma escenas editables, genera la voz completa, un clip por escena (avatar o toma de apoyo) y el montaje final con fundidos.',
    icon: Clapperboard,
    engines: 'ElevenLabs · HeyGen Avatar IV · Veo / Kling / Hailuo · FFmpeg',
    shortcut: '4',
  },
  'voice-studio': {
    id: 'voice-studio',
    title: 'Voice Studio',
    formula: 'Muestras → voz clonada',
    description: 'Clona una voz con pocos minutos de audio y genera locuciones en español, inglés y portugués.',
    icon: AudioLines,
    engines: 'ElevenLabs',
    shortcut: '5',
  },
  buzzy: {
    id: 'buzzy',
    title: 'Buzzy',
    formula: 'Idea → escenas consistentes',
    description: 'Videos largos y anuncios UGC con Seedance 2.5, Wan 3.0 y MiniMax H3 a través de Buzzy.',
    icon: Sparkles,
    engines: 'Buzzy · MCP',
    preview: true,
    shortcut: '6',
  },
  projects: {
    id: 'projects',
    title: 'Proyectos',
    formula: 'Todo lo generado, en tu disco',
    description: 'Videos, guiones y audios guardados en carpetas ordenadas en tu equipo.',
    icon: FolderOpen,
    shortcut: '7',
  },
  costs: {
    id: 'costs',
    title: 'Costos',
    formula: 'Cada generación, con fecha, hora y precio',
    description: 'Registro de todo lo que se gastó en este PC, por día, herramienta y proveedor, exportable a Excel.',
    icon: Receipt,
    shortcut: '8',
  },
};

/** Identificadores antiguos que pueden venir de proyectos guardados o atajos viejos. */
export const LEGACY_TOOL_IDS: Record<string, ToolId> = { busi: 'buzzy' };

export function normalizeToolId(id: string): ToolId | null {
  if (id in TOOLS) return id as ToolId;
  return LEGACY_TOOL_IDS[id] ?? null;
}

/** Las cuatro herramientas principales del dashboard. */
export const PRIMARY_TOOLS: ToolId[] = ['avatar-studio', 'deep-swap', 'ugc-generator', 'text-to-video'];

/** Orden de la barra lateral. */
export const NAV_ORDER: ToolId[] = [
  'avatar-studio',
  'deep-swap',
  'ugc-generator',
  'text-to-video',
  'voice-studio',
  'buzzy',
];

export const HOME_ICON = LayoutGrid;

export function getToolByShortcut(key: string): ToolId | null | undefined {
  if (key === '0') return null;
  const match = Object.values(TOOLS).find((t) => t.shortcut === key);
  return match?.id;
}
