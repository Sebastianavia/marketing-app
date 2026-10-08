'use client';

import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  initTheme: () => void;
}

const STORAGE_KEY = 'lulo_theme';

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    // Si no hay preferencia guardada, verificar el sistema operativo
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
};

const applyThemeToDOM = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',

  initTheme: () => {
    const initial = getInitialTheme();
    set({ theme: initial });
    applyThemeToDOM(initial);

    // Escuchar cambios de preferencia del sistema si el usuario no ha guardado uno explícito
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemChange = (e: MediaQueryListEvent) => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
          const newTheme: Theme = e.matches ? 'dark' : 'light';
          set({ theme: newTheme });
          applyThemeToDOM(newTheme);
        }
      };

      mediaQuery.addEventListener('change', handleSystemChange);

      // Sincronización entre múltiples pestañas del navegador
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
          set({ theme: e.newValue as Theme });
          applyThemeToDOM(e.newValue as Theme);
        }
      };

      window.addEventListener('storage', handleStorageChange);
    }
  },

  setTheme: (newTheme: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch (e) {
      console.warn('[useThemeStore] No se pudo persistir en localStorage:', e);
    }

    applyThemeToDOM(newTheme);
    set({ theme: newTheme });
  },

  toggleTheme: () => {
    const current = get().theme;
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));
