'use client';

import { useCallback, useEffect, useState } from 'react';
import { postOrchestrated } from '@/lib/ai/orchestrator-client';
import type { Production } from '@/lib/director/production-store';

/** Estado del modo Director en la interfaz: producción abierta, borradores y la acción en curso. */

export interface DraftRow {
  id: string;
  nombre: string;
  estado: string;
  creada: string;
  actualizada: string;
}

export type ActResult =
  | { ok: true; before: Production; production: Production; aviso?: string }
  | { ok: false; error: string };

const ACTIVE_KEY = 'lulo_director_mode_active';

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // sin almacenamiento: no pasa nada
  }
}

/** `enabled: false` = no carga nada (lo usa una vista que recibe el estado desde fuera). */
export function useDirectorMode(enabled = true) {
  const [production, setProduction] = useState<Production | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  /** Clave de la acción en curso, p. ej. 'generar_guion' o 'rehacer_escena:e2'. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const loadDrafts = useCallback(async () => {
    const r = await fetch('/api/director-mode', { cache: 'no-store' }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (r?.ok) setDrafts(d.borradores ?? []);
  }, []);

  const open = useCallback(async (id: string | null) => {
    setError(null);
    setAviso(null);
    if (!id) {
      setProduction(null);
      writeActive(null);
      return;
    }
    const r = await fetch(`/api/director-mode/${id}`, { cache: 'no-store' }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (r?.ok && d.production) {
      setProduction(d.production);
      writeActive(id);
    } else {
      setProduction(null);
      writeActive(null);
      if (r && r.status !== 404) setError(d?.error || 'No se pudo abrir el borrador.');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      await Promise.all([loadDrafts(), open(readActive())]);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, loadDrafts, open]);

  const create = useCallback(
    async (entrada: object) => {
      setBusy('crear');
      setError(null);
      try {
        const r = await fetch('/api/director-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entrada),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudo crear el borrador.');
        setProduction(d.production);
        writeActive(d.production.id);
        void loadDrafts();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo crear el borrador.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [loadDrafts]
  );

  /**
   * Ejecuta una acción y devuelve el resultado (el chat lo usa para narrar).
   * Si Gemini gratis se agotó, postOrchestrated pregunta antes de usar Claude.
   */
  const run = useCallback(
    async (body: Record<string, unknown> & { accion: string }, key: string = body.accion): Promise<ActResult> => {
      if (!production) return { ok: false, error: 'No hay un borrador abierto.' };
      setBusy(key);
      setError(null);
      setAviso(null);
      try {
        const r = await postOrchestrated(`/api/director-mode/${production.id}`, body);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          // La etapa pudo quedar con el error anotado: se vuelve a leer
          void open(production.id);
          throw new Error(d.error || 'No se pudo completar.');
        }
        setProduction(d.production);
        if (d.aviso) setAviso(d.aviso);
        void loadDrafts();
        return { ok: true, before: production, production: d.production, aviso: d.aviso };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo completar.';
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setBusy(null);
      }
    },
    [production, open, loadDrafts]
  );

  /** Igual que run, pero solo dice si salió bien (lo usan los formularios). */
  const act = useCallback(
    (body: Record<string, unknown> & { accion: string }, key?: string) => run(body, key).then((r) => r.ok),
    [run]
  );

  return { production, drafts, busy, error, aviso, loading, open, create, act, run, setError };
}
