'use client';

import { create } from 'zustand';

export interface CloudinaryState {
  totalCount: number | null;
  breakdown: Record<string, number>;
  oldestCreatedAt: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  isModalOpen: boolean;
  lastError: string | null;
  lastCleanedCount: number | null;

  // Actions
  fetchCount: () => Promise<number | null>;
  cleanOldest: (limit?: number) => Promise<{ success: boolean; deletedCount: number; remainingCount: number; error?: string }>;
  openModal: () => void;
  closeModal: () => void;
}

export const useCloudinaryStore = create<CloudinaryState>((set, get) => ({
  totalCount: null,
  breakdown: {},
  oldestCreatedAt: null,
  isLoading: false,
  isDeleting: false,
  isModalOpen: false,
  lastError: null,
  lastCleanedCount: null,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  fetchCount: async () => {
    try {
      set({ isLoading: true, lastError: null });
      const res = await fetch('/api/storage/cloudinary', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al consultar almacenamiento');
      }

      const data = await res.json();
      const count = typeof data.totalCount === 'number' ? data.totalCount : 0;
      set({
        totalCount: count,
        breakdown: data.breakdown || {},
        oldestCreatedAt: data.oldestCreatedAt || null,
        isLoading: false,
      });
      return count;
    } catch (err: any) {
      console.warn('[useCloudinaryStore] Error consultando conteo de Cloudinary:', err);
      set({
        isLoading: false,
        lastError: err.message || 'No se pudo obtener el conteo de Cloudinary',
      });
      return null;
    }
  },

  cleanOldest: async (limit: number = 100) => {
    try {
      set({ isDeleting: true, lastError: null });
      const res = await fetch(`/api/storage/cloudinary?limit=${limit}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fallo al ejecutar la limpieza por lotes');
      }

      const deletedCount = data.deletedCount ?? 0;
      const remainingCount = data.remainingCount ?? 0;

      set({
        totalCount: remainingCount,
        lastCleanedCount: deletedCount,
        isDeleting: false,
        isModalOpen: false,
      });

      // Refrescar conteo real
      get().fetchCount();

      return {
        success: true,
        deletedCount,
        remainingCount,
      };
    } catch (err: any) {
      console.error('[useCloudinaryStore] Error en limpieza masiva:', err);
      set({
        isDeleting: false,
        lastError: err.message || 'Error al eliminar archivos antiguos',
      });
      return {
        success: false,
        deletedCount: 0,
        remainingCount: get().totalCount || 0,
        error: err.message,
      };
    }
  },
}));
