'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Check, X, Loader2 } from 'lucide-react';

interface PendingScene {
  id: string;
  orden: number;
  tipo: 'avatar' | 'toma_de_apoyo' | 'imagen' | 'voz';
  titulo?: string;
  texto?: string;
  prompt?: string;
  detalle: string;
  costoUSD: number;
}

interface PendingProduction {
  id: string;
  nombre: string;
  presupuestoUSD: number;
  gastadoUSD: number;
  aprobacionPendiente: {
    id: string;
    montoUSD: number;
    motivo: string;
    pedida: string;
    escenas: PendingScene[];
  } | null;
}

const POLL_MS = 8_000;

const TIPO_LABEL: Record<PendingScene['tipo'], string> = {
  avatar: 'Avatar',
  toma_de_apoyo: 'Toma de apoyo',
  imagen: 'Imagen',
  voz: 'Voz',
};

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

/**
 * Aviso «El Director pide $X» en la barra superior. Es el ÚNICO sitio donde se aprueba un gasto
 * del Director: el agente no puede aprobar (la ruta rechaza su token).
 * Se aprueba exactamente lo que se ve: si el agente cambia algo mientras tanto, el servidor lo rechaza.
 */
export function DirectorApprovals() {
  const [items, setItems] = useState<PendingProduction[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/productions?pendientes=1', { cache: 'no-store' });
      if (r.ok) setItems(await r.json());
    } catch {
      // la app sigue funcionando aunque falle la consulta
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pending = items.filter((p) => p.aprobacionPendiente);
  if (!pending.length) return null;
  const total = pending.reduce((t, p) => t + (p.aprobacionPendiente?.montoUSD ?? 0), 0);

  const decide = async (p: PendingProduction, action: 'approve' | 'reject') => {
    const a = p.aprobacionPendiente;
    if (!a) return;
    setBusy(`${p.id}:${action}`);
    setError(null);
    try {
      const body =
        action === 'approve'
          ? { approvalId: a.id, montoUSD: a.montoUSD, escenas: a.escenas.map((s) => s.id) }
          : { approvalId: a.id };
      const r = await fetch(`/api/productions/${p.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) setError(data.error || 'No se pudo guardar la decisión.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[13px] font-medium text-brand-fg transition-opacity hover:opacity-90"
        title="El Director espera tu aprobación para gastar"
      >
        <Clapperboard className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">El Director pide {usd(total)}</span>
        <span className="sm:hidden">{usd(total)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Aprobaciones del Director"
          className="desktop-scroll absolute right-0 top-9 z-50 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-[12px] shadow-lg"
        >
          {pending.map((p) => {
            const a = p.aprobacionPendiente!;
            return (
              <section key={p.id} className="space-y-2">
                <header className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium text-fg">{p.nombre}</p>
                  <p className="shrink-0 font-mono text-[11px] text-fg-subtle">
                    gastado {usd(p.gastadoUSD)} / {usd(p.presupuestoUSD)}
                  </p>
                </header>
                <p className="text-fg-muted">{a.motivo}</p>
                <ul className="space-y-1.5">
                  {a.escenas.map((s) => (
                    <li key={s.id} className="rounded-lg border border-line bg-surface-2 p-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-wide text-fg-subtle">
                          {s.orden}. {TIPO_LABEL[s.tipo]}
                        </span>
                        <span className="font-mono text-fg">{usd(s.costoUSD)}</span>
                      </div>
                      {s.titulo && <p className="mt-0.5 text-fg">{s.titulo}</p>}
                      {(s.texto || s.prompt) && (
                        <p className="mt-0.5 line-clamp-3 text-fg-muted">{s.texto ? `«${s.texto}»` : s.prompt}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-fg-subtle">{s.detalle}</p>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide(p, 'reject')}
                    className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-fg-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy === `${p.id}:reject` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Rechazar
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide(p, 'approve')}
                    className="flex h-8 items-center gap-1 rounded-lg bg-fg px-3 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === `${p.id}:approve` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Aprobar {usd(a.montoUSD)}
                  </button>
                </div>
              </section>
            );
          })}
          {error && <p className="rounded-lg bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">{error}</p>}
          <p className="text-fg-subtle">
            Solo se genera lo que apruebes aquí. Si el Director cambia algo, te lo volverá a pedir.
          </p>
        </div>
      )}
    </div>
  );
}
