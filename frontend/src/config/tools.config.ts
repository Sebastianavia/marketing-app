import {
  AudioLines,
  Clapperboard,
  FolderOpen,
  LayoutGrid,
  ScanFace,
  UserRound,
  Megaphone,
  LineChart,
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
  | 'busi'
  | 'projects';

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
    formula: 'Guion → escenas renderizadas',
    description:
      'Transforma un guion de marketing en tomas con dirección visual, movimiento de cámara y gradación de color.',
    icon: Clapperboard,
    preview: true,
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
  busi: {
    id: 'busi',
    title: 'Auditor de campañas',
    formula: 'Métricas → variantes ganadoras',
    description: 'Detecta fatiga de creativos y propone nuevas variantes para Meta y TikTok.',
    icon: LineChart,
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
};

/** Las cuatro herramientas principales del dashboard. */
export const PRIMARY_TOOLS: ToolId[] = ['avatar-studio', 'deep-swap', 'ugc-generator', 'text-to-video'];

/** Orden de la barra lateral. */
export const NAV_ORDER: ToolId[] = [
  'avatar-studio',
  'deep-swap',
  'ugc-generator',
  'text-to-video',
  'voice-studio',
  'busi',
];

export const HOME_ICON = LayoutGrid;

export function getToolByShortcut(key: string): ToolId | null | undefined {
  if (key === '0') return null;
  const match = Object.values(TOOLS).find((t) => t.shortcut === key);
  return match?.id;
}
