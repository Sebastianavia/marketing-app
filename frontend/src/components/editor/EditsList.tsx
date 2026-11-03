'use client';

import React from 'react';
import { ChevronRight, Film } from 'lucide-react';
import type { EditStatus, EditSummary } from '@/lib/editor/types';
import { formatClock } from '@/lib/editor/timeline';

export const STATUS_LABEL: Record<EditStatus, string> = {
  en_cola: 'En cola',
  transcribiendo: 'Transcribiendo',
  analizando: 'La IA revisa el guion',
  por_revisar: 'Guion por revisar',
  renderizando: 'Creando el video',
  borrador: 'Borrador listo',
  aprobado: 'Aprobado',
  error: 'Error',
};

export function StatusBadge({ estado }: { estado: EditStatus }) {
  const tone =
    estado === 'error'
      ? 'border-rose-500/30 text-rose-600 dark:text-rose-400'
      : estado === 'aprobado'
        ? 'border-accent/40 text-accent'
        : estado === 'por_revisar' || estado === 'borrador'
          ? 'border-amber-500/40 text-amber-700 dark:text-amber-300'
          : 'border-line-strong text-fg-muted';
  const pulse = ['en_cola', 'transcribiendo', 'analizando', 'renderizando'].includes(estado);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[estado]}
    </span>
  );
}

export function EditsList({ ediciones, onOpen }: { ediciones: EditSummary[]; onOpen: (id: string) => void }) {
  if (!ediciones.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-12 text-center text-[13px] text-fg-subtle">
        <Film className="h-6 w-6" />
        Todavía no hay ediciones. Sube tu primer video en “Nueva edición”.
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {ediciones.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onOpen(e.id)}
          className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-fg-subtle cursor-pointer"
        >
          <div className="flex h-16 w-10 shrink-0 items-center justify-center rounded-md bg-[#111] text-white/60">
            <Film className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-[13px] font-medium text-fg">{e.titulo}</p>
            <p className="text-[11px] text-fg-subtle">
              {e.perfilNombre} · {formatClock(e.duracionOriginal)}
              {e.duracionFinal ? ` → ${formatClock(e.duracionFinal)}` : ''} ·{' '}
              {new Date(e.creado).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
            </p>
            <StatusBadge estado={e.estado} />
          </div>
          <ChevronRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}
