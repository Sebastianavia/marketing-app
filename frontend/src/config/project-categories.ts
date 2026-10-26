/**
 * Carpetas de proyectos en disco. Los nombres de carpeta se mantienen por compatibilidad
 * con lo ya guardado; en pantalla se muestran con el nombre de la herramienta.
 * (Creación de avatar no es un proyecto: sus avatares viven en la carpeta Avatares.)
 */
export type ProjectCategory = 'HeyGen' | 'UGC' | 'TextToVideo' | 'Genjutsu' | 'Imagenes';

export const PROJECT_CATEGORIES: Array<{ id: ProjectCategory; label: string; tool: string }> = [
  { id: 'HeyGen', label: 'Avatar Studio', tool: 'avatar-studio' },
  { id: 'Genjutsu', label: 'Clonación y reemplazo', tool: 'deep-swap' },
  { id: 'UGC', label: 'Generador UGC', tool: 'ugc-generator' },
  { id: 'TextToVideo', label: 'Guion a video', tool: 'text-to-video' },
  { id: 'Imagenes', label: 'Creación de imágenes', tool: 'image-studio' },
];

export function projectCategoryLabel(id: string): string {
  return PROJECT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
