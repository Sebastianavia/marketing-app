'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface CatalogState {
  ok: boolean;
  unavailable?: string;
  missing: Array<{ id: string; usedIn: string }>;
  durationMismatch: Array<{ id: string; app: number[]; catalog: number[] }>;
}

/**
 * Al abrir la app revisa que los modelos de video sigan en OpenRouter.
 * Solo se muestra si hay algo que corregir antes de gastar.
 */
export function VideoCatalogAlert() {
  const [state, setState] = useState<CatalogState | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/system/video-models', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setState(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!state || state.unavailable || (state.missing.length === 0 && state.durationMismatch.length === 0)) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
        title="Hay modelos de video que cambiaron en OpenRouter"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Modelos</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 space-y-2 rounded-xl border border-line bg-surface p-3 text-[12px] shadow-lg">
          {state.missing.length > 0 && (
            <div>
              <p className="font-medium text-fg">Ya no están en OpenRouter</p>
              <ul className="mt-1 space-y-1 text-fg-muted">
                {state.missing.map((m) => (
                  <li key={m.id}>
                    <code className="text-fg">{m.id}</code> · {m.usedIn}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.durationMismatch.length > 0 && (
            <div>
              <p className="font-medium text-fg">Duraciones distintas a las del catálogo</p>
              <ul className="mt-1 space-y-1 text-fg-muted">
                {state.durationMismatch.map((m) => (
                  <li key={m.id}>
                    <code className="text-fg">{m.id}</code>: la app usa {m.app.join(', ')} s; OpenRouter admite{' '}
                    {m.catalog.length > 8 ? `${m.catalog[0]}–${m.catalog[m.catalog.length - 1]}` : m.catalog.join(', ')} s
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-fg-subtle">La app no deja generar con un modelo que ya no existe, así que no se gasta nada por error.</p>
        </div>
      )}
    </div>
  );
}
