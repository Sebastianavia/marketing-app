import { create } from 'zustand';
import type { ToolId } from '@/config/tools.config';

/**
 * Navegación entre herramientas desde dentro de una vista
 * (p. ej. "Crear imágenes con este avatar" abre Creación de imágenes con el avatar elegido).
 */
interface NavState {
  requestedTool: ToolId | null;
  pendingAvatarId: string | null;
  openTool: (id: ToolId) => void;
  clearRequest: () => void;
  openImagesWithAvatar: (avatarId: string) => void;
  takePendingAvatar: () => string | null;
}

export const useNavStore = create<NavState>((set, get) => ({
  requestedTool: null,
  pendingAvatarId: null,
  openTool: (id) => set({ requestedTool: id }),
  clearRequest: () => set({ requestedTool: null }),
  openImagesWithAvatar: (avatarId) => set({ pendingAvatarId: avatarId, requestedTool: 'image-studio' }),
  takePendingAvatar: () => {
    const id = get().pendingAvatarId;
    if (id) set({ pendingAvatarId: null });
    return id;
  },
}));
