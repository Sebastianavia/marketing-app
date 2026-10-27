'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export type UploadResult = (ActResult & { ok: true; nuevas: string[] }) | { ok: false; error: string };

export interface ChatPlanDto {
  body: Record<string, unknown> & { accion: string };
  ejecucion: 'auto' | 'confirmar';
  resumen: string;
  boton: string;
  costo: string;
}

export type AskResult = { ok: true; respuesta: string; plan: ChatPlanDto | null; motivo?: string } | { ok: false; error: string };

export interface UploadOptions {
  escenaId?: string;
  etiquetaId?: string;
  /** Recién creado: todavía no está en el estado. */
  productionId?: string;
}

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
  const [production, setProductionState] = useState<Production | null>(null);
  // La última producción conocida, para acciones encadenadas (crear → subir → proponer) antes del siguiente render
  const prodRef = useRef<Production | null>(null);
  const setProduction = useCallback((p: Production | null) => {
    prodRef.current = p;
    setProductionState(p);
  }, []);
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
  }, [setProduction]);

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

  /** Crea el borrador y lo abre. Devuelve la producción (o null si falló). */
  const create = useCallback(
    async (entrada: object): Promise<Production | null> => {
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
        return d.production as Production;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo crear el borrador.');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [loadDrafts, setProduction]
  );

  /**
   * Ejecuta una acción y devuelve el resultado (el chat lo usa para narrar).
   * Si Gemini gratis se agotó, postOrchestrated pregunta antes de usar Claude.
   */
  const run = useCallback(
    async (body: Record<string, unknown> & { accion: string }, key: string = body.accion): Promise<ActResult> => {
      const current = prodRef.current;
      if (!current) return { ok: false, error: 'No hay un borrador abierto.' };
      setBusy(key);
      setError(null);
      setAviso(null);
      try {
        const r = await postOrchestrated(`/api/director-mode/${current.id}`, body);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          // La etapa pudo quedar con el error anotado: se vuelve a leer
          void open(current.id);
          throw new Error(d.error || 'No se pudo completar.');
        }
        setProduction(d.production);
        if (d.aviso) setAviso(d.aviso);
        void loadDrafts();
        return { ok: true, before: current, production: d.production, aviso: d.aviso };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo completar.';
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setBusy(null);
      }
    },
    [open, loadDrafts, setProduction]
  );

  /**
   * Chat libre: la IA responde con el contexto y, si hay un cambio, propone la acción (no cambia nada aquí).
   * Si Gemini gratis se agotó, postOrchestrated pregunta antes de usar Claude.
   */
  const ask = useCallback(
    async (input: { mensaje: string; historial: Array<{ rol: 'agente' | 'tu'; texto: string }>; enfoque: string | null }): Promise<AskResult> => {
      const current = prodRef.current;
      if (!current) return { ok: false, error: 'No hay un borrador abierto.' };
      setBusy('chat');
      try {
        const r = await postOrchestrated(`/api/director-mode/${current.id}/chat`, input);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'El Director no pudo responder.');
        return { ok: true, respuesta: d.respuesta, plan: d.plan ?? null, motivo: d.motivo };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'El Director no pudo responder.' };
      } finally {
        setBusy(null);
      }
    },
    []
  );

  /** + Ref: sube archivos a la carpeta de la producción ($0). */
  const uploadRefs = useCallback(
    async (files: File[], o: UploadOptions = {}): Promise<UploadResult> => {
      const current = prodRef.current;
      const id = o.productionId ?? current?.id;
      if (!id || !current) return { ok: false, error: 'No hay un borrador abierto.' };
      setBusy('subir_referencias');
      setError(null);
      try {
        const form = new FormData();
        for (const f of files) form.append('archivos', f, f.name);
        if (o.escenaId) form.append('escenaId', o.escenaId);
        if (o.etiquetaId) form.append('etiquetaId', o.etiquetaId);
        const r = await fetch(`/api/director-mode/${id}/referencias`, { method: 'POST', body: form });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudieron guardar las referencias.');
        setProduction(d.production);
        return { ok: true, before: current, production: d.production, nuevas: d.nuevas ?? [] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudieron guardar las referencias.';
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setBusy(null);
      }
    },
    [setProduction]
  );

  /** Igual que run, pero solo dice si salió bien (lo usan los formularios). */
  const act = useCallback(
    (body: Record<string, unknown> & { accion: string }, key?: string) => run(body, key).then((r) => r.ok),
    [run]
  );

  return { production, drafts, busy, error, aviso, loading, open, create, act, run, ask, uploadRefs, setError };
}
