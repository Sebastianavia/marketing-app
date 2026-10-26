'use client';

import { create } from 'zustand';

/**
 * Sesión de Lulo Studio.
 *
 * ⚠️ Por ahora es una FACHADA: "Continuar con Google" no habla con Google;
 * espera un momento y abre una sesión local para que el flujo de entrada ya
 * exista. Para conectarlo de verdad, reemplaza solo `authenticateWithGoogle`
 * (p. ej. con Auth.js + proveedor Google, o el OAuth nativo del shell de
 * escritorio) y deja que devuelva el usuario real. Nada más depende del
 * proveedor.
 */

export interface AuthUser {
  name: string;
  email: string | null;
  avatarUrl: string | null;
  provider: 'google';
}

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Lee la sesión guardada en este equipo. */
  init: () => void;
  /** Pide la identidad a Google (hoy simulado). No abre la sesión todavía. */
  authenticateWithGoogle: () => Promise<AuthUser>;
  /** Abre la sesión con el usuario ya autenticado. */
  startSession: (user: AuthUser) => void;
  signOut: () => void;
}

const STORAGE_KEY = 'lulo_session';

function readSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed || typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      email: parsed.email ?? null,
      avatarUrl: parsed.avatarUrl ?? null,
      provider: 'google',
    };
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,

  init: () => {
    const user = readSession();
    set({ status: user ? 'signed-in' : 'signed-out', user });
  },

  authenticateWithGoogle: async () => {
    // TODO(auth): conectar Google OAuth aquí. Hoy solo simula la espera.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    return { name: 'Equipo Lulo', email: null, avatarUrl: null, provider: 'google' };
  },

  startSession: (user) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      // Sin almacenamiento la sesión dura hasta cerrar la ventana.
    }
    set({ status: 'signed-in', user });
  },

  signOut: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nada que limpiar
    }
    set({ status: 'signed-out', user: null });
  },
}));
