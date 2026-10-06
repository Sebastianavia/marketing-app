import { create } from 'zustand';
import { ProjectMetadata } from '@/lib/storage/project-storage';

export interface ProjectHydrationState {
  activeProject: ProjectMetadata | null;
  mediaWarnings: string[];
  isLoading: boolean;
  error: string | null;

  // Acciones
  loadProject: (
    projectOrPath: ProjectMetadata | { category: string; name: string } | string
  ) => Promise<ProjectMetadata | null>;
  setActiveProject: (project: ProjectMetadata | null) => void;
  clearActiveProject: () => void;
  clearWarnings: () => void;
}

export const useProjectHydrationStore = create<ProjectHydrationState>((set, get) => ({
  activeProject: null,
  mediaWarnings: [],
  isLoading: false,
  error: null,

  loadProject: async (target) => {
    set({ isLoading: true, error: null, mediaWarnings: [] });
    try {
      let project: ProjectMetadata | null = null;
      let warnings: string[] = [];

      if (typeof target === 'string') {
        // Carga por ruta absoluta o relativa de carpeta
        const res = await fetch(`/api/projects/load?path=${encodeURIComponent(target)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `No se pudo leer el proyecto desde: ${target}`);
        }
        const data = await res.json();
        project = data.project;
        warnings = data.mediaWarnings || [];
      } else if (
        target &&
        typeof target === 'object' &&
        'category' in target &&
        'name' in target &&
        !('createdAt' in target)
      ) {
        // Carga por identificador { category, name }
        const res = await fetch(
          `/api/projects/load?category=${encodeURIComponent(
            (target as any).category
          )}&name=${encodeURIComponent((target as any).name)}`
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `No se pudo cargar el proyecto ${(target as any).name}`);
        }
        const data = await res.json();
        project = data.project;
        warnings = data.mediaWarnings || [];
      } else if (target && typeof target === 'object' && 'path' in target) {
        // Carga con ProjectMetadata ya provisto por la tarjeta
        const p = target as ProjectMetadata;
        try {
          const res = await fetch(`/api/projects/load?path=${encodeURIComponent(p.path)}`);
          if (res.ok) {
            const data = await res.json();
            project = data.project || p;
            warnings = data.mediaWarnings || [];
          } else {
            project = p;
          }
        } catch {
          project = p;
        }
      }

      if (!project) {
        throw new Error('No se pudo resolver la estructura del proyecto en disco');
      }

      // Validar advertencias multimedia de cliente si el servidor no generó alguna
      if (warnings.length === 0) {
        if (!project.imageUrl && !project.imagePath) {
          warnings.push(
            'El proyecto no tiene una foto de retrato asociada. Tu guion y configuración están listos.'
          );
        }
        if (project.audioMode === 'local' && !project.audioUrl && !project.audioPath) {
          warnings.push(
            'No se encontró el archivo de audio local original. Puedes cargar un nuevo MP3 o usar la voz por IA.'
          );
        }
      }

      set({
        activeProject: project,
        mediaWarnings: warnings,
        isLoading: false,
        error: null,
      });

      return project;
    } catch (err: any) {
      console.error('[Hydration Error]:', err);
      set({
        error: err.message || 'Error cargando metadatos del proyecto',
        isLoading: false,
      });
      return null;
    }
  },

  setActiveProject: (project) => set({ activeProject: project, mediaWarnings: [] }),

  clearActiveProject: () => set({ activeProject: null, mediaWarnings: [], error: null }),

  clearWarnings: () => set({ mediaWarnings: [] }),
}));

/**
 * Hook para consumo ergonómico en componentes de workspace
 */
export function useProjectHydration() {
  const activeProject = useProjectHydrationStore((s) => s.activeProject);
  const mediaWarnings = useProjectHydrationStore((s) => s.mediaWarnings);
  const isLoading = useProjectHydrationStore((s) => s.isLoading);
  const error = useProjectHydrationStore((s) => s.error);
  const loadProject = useProjectHydrationStore((s) => s.loadProject);
  const setActiveProject = useProjectHydrationStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectHydrationStore((s) => s.clearActiveProject);
  const clearWarnings = useProjectHydrationStore((s) => s.clearWarnings);

  return {
    activeProject,
    mediaWarnings,
    isLoading,
    error,
    loadProject,
    setActiveProject,
    clearActiveProject,
    clearWarnings,
  };
}
