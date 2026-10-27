import { TOOLS, normalizeToolId } from '@/config/tools.config';

/**
 * Color fijo por herramienta en la vista Costos (todas las gráficas y la leyenda).
 * Valores en `globals.css` (--chart-1…6, --chart-other), paleta validada con la skill dataviz
 * para modo claro y oscuro. El color sigue a la herramienta, nunca a su puesto en el ranking.
 * El rojo no se usa aquí: queda reservado para "te pasaste del límite".
 */

export interface ToolSeries {
  /** Clave estable del grupo de color. */
  id: string;
  label: string;
  /** Variable CSS del color. */
  color: string;
  /** Orden fijo de apilado y de la leyenda. */
  order: number;
}

const SERIES: ToolSeries[] = [
  { id: 'avatar-studio', label: 'Avatar Studio', color: 'var(--chart-1)', order: 1 },
  { id: 'text-to-video', label: 'Guion a video', color: 'var(--chart-2)', order: 2 },
  { id: 'image-studio', label: 'Creación de imágenes', color: 'var(--chart-3)', order: 3 },
  { id: 'voice-studio', label: 'Voice Studio', color: 'var(--chart-4)', order: 4 },
  { id: 'director', label: 'Producciones (Director)', color: 'var(--chart-5)', order: 5 },
  { id: 'ugc-generator', label: 'Generador UGC', color: 'var(--chart-6)', order: 6 },
];

export const OTHER_SERIES: ToolSeries = { id: 'other', label: 'Otras', color: 'var(--chart-other)', order: 99 };

/** Serie de color de una herramienta del registro (chat, Mia, Clonación, Buzzy… → "Otras"). */
export function toolSeries(tool: string): ToolSeries {
  const id = tool === 'director' ? 'director' : normalizeToolId(tool) ?? tool;
  return SERIES.find((s) => s.id === id) ?? OTHER_SERIES;
}

/** Nombre visible de la herramienta (el de la serie si la tiene; si no, el del menú o el id). */
export function toolLabel(tool: string): string {
  const s = toolSeries(tool);
  if (s !== OTHER_SERIES) return s.label;
  const t = normalizeToolId(tool);
  if (t) return TOOLS[t].title;
  if (tool === 'chat') return 'Chat de guiones';
  return tool;
}
