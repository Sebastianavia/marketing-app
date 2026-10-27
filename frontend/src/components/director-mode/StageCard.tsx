'use client';

import React from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import { STAGE_LABELS, type StageDef } from '@/lib/director-mode/stages';
import type { StageState } from '@/lib/director-mode/types';

/** Un paso de la línea de etapas: punto en la línea + tarjeta con estado, modelo y costo. */

interface Props {
  def: StageDef;
  state?: StageState;
  /** La interfaz está esperando a la IA en esta etapa. */
  generating?: boolean;
  /** Etapa en la que está la persona (acento). */
  current?: boolean;
  last?: boolean;
  summary?: React.ReactNode;
  children?: React.ReactNode;
}

const CHIP: Record<string, string> = {
  bloqueada: 'bg-surface-2 text-fg-subtle',
  pendiente: 'bg-surface-2 text-fg-muted',
  por_revisar: 'bg-accent/15 text-accent',
  aprobada: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  desactualizada: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  error: 'bg-red-500/10 text-red-700 dark:text-red-400',
  generando: 'bg-accent/15 text-accent',
  futura: 'bg-surface-2 text-fg-subtle',
};

export function StageCard({ def, state, generating, current, last, summary, children }: Props) {
  const future = !state;
  const key = generating ? 'generando' : future ? 'futura' : state.estado;
  const label = generating ? 'Generando…' : future ? `Próximamente · Fase ${def.fase}` : STAGE_LABELS[state.estado];
  const approved = state?.estado === 'aprobada' && !generating;

  return (
    <li className="relative pl-9">
      {!last && <span aria-hidden className="absolute left-[11px] top-7 bottom-[-12px] w-px bg-line" />}
      <span
        aria-hidden
        className={`absolute left-0 top-3 flex h-[23px] w-[23px] items-center justify-center rounded-full border text-[10.5px] font-mono ${
          approved
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : current || generating
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-line bg-surface text-fg-subtle'
        }`}
      >
        {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : approved ? <Check className="h-3 w-3" /> : future ? <Lock className="h-2.5 w-2.5" /> : def.numero}
      </span>

      <section
        className={`rounded-xl border p-4 transition-colors ${
          future
            ? 'border-dashed border-line bg-transparent opacity-60'
            : current
            ? 'border-accent/40 bg-surface'
            : 'border-line bg-surface'
        }`}
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className={`text-[13px] font-semibold ${future ? 'text-fg-muted' : 'text-fg'}`}>
            {def.numero}. {def.nombre}
          </h3>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${CHIP[key]}`}>{label}</span>
          {state?.modelo && !future && (
            <span className="font-mono text-[10.5px] text-fg-subtle">
              {state.modelo} · {state.costoUSD ? `$${state.costoUSD.toFixed(4)}` : '$0'}
            </span>
          )}
        </header>
        {future ? (
          <p className="mt-1 text-[11.5px] text-fg-subtle">{def.descripcion}</p>
        ) : (
          <>
            {summary && <div className="mt-1 text-[12px] text-fg-muted">{summary}</div>}
            {state.error && (
              <p className="mt-2 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-700 dark:text-red-400">{state.error}</p>
            )}
            {children && <div className="mt-3">{children}</div>}
          </>
        )}
      </section>
    </li>
  );
}
