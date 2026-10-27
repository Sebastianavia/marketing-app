'use client';

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { STAGES, currentStage, isActiveStage } from '@/lib/director-mode/stages';
import type { ActiveStageId } from '@/lib/director-mode/types';
import { StageCard } from './StageCard';
import { IdeaForm, StageBody, StageSummary } from './stage-forms';
import { useDirectorMode } from './useDirectorMode';

/**
 * Modo Director de Guion a video, "Vista lista": línea de etapas con tarjetas, solo texto.
 * La IA solo piensa y escribe (Gemini gratis por el orquestador); nada de imagen, voz ni video todavía.
 * Recibe el estado desde fuera (`dm`) para compartir borrador con el lienzo; sin él, usa el suyo.
 * `embedded`: dentro del estudio (lienzo), que ya muestra borradores, errores y avisos.
 */

type DirectorModeState = ReturnType<typeof useDirectorMode>;

export function DirectorModeView({ dm: shared, embedded }: { dm?: DirectorModeState; embedded?: boolean } = {}) {
  const own = useDirectorMode(!shared);
  const dm = shared ?? own;
  const { production, drafts, busy, error, aviso, loading } = dm;
  const d = production?.director;
  const current = d ? currentStage(d) : 'idea';
  const [newOpen, setNewOpen] = useState(false);

  const busyStage: ActiveStageId | null = busy
    ? busy.startsWith('generar_preguntas')
      ? 'preguntas'
      : busy.startsWith('generar_guion')
      ? 'guion'
      : busy.startsWith('generar_prompts')
      ? 'prompts'
      : null
    : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
      </div>
    );
  }

  const showForm = !production || newOpen;

  return (
    <div className="space-y-4">
      {/* Borradores */}
      {!embedded && (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <select
            value={production && !newOpen ? production.id : ''}
            onChange={(e) => {
              setNewOpen(false);
              void dm.open(e.target.value || null);
            }}
            className="input-clean h-8 appearance-none pl-2 pr-7 text-[12px]"
            aria-label="Borrador abierto"
          >
            <option value="">{drafts.length ? 'Elige un borrador…' : 'Sin borradores'}</option>
            {drafts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre} · {new Date(r.actualizada).toLocaleDateString('es')}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-fg-subtle" />
        </div>
        {production && !newOpen && (
          <button type="button" onClick={() => setNewOpen(true)} className="btn-secondary h-8 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </button>
        )}
        {production && newOpen && (
          <button type="button" onClick={() => setNewOpen(false)} className="btn-secondary h-8 px-3 text-[12px]">
            <X className="h-3.5 w-3.5" /> Volver al borrador
          </button>
        )}
        <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wide text-fg-subtle">Fase 1 · solo texto · sin gastos de video</span>
      </div>
      )}

      {!embedded && error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => dm.setError(null)} aria-label="Cerrar" className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!embedded && aviso && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200">{aviso}</p>
      )}

      {showForm ? (
        <ol className="space-y-3">
          <StageCard def={STAGES[0]} state={{ estado: 'pendiente', rev: 0 }} current last>
            <IdeaForm
              busy={busy === 'crear'}
              submitLabel="Empezar"
              onSubmit={async (entrada) => {
                if (await dm.create(entrada)) setNewOpen(false);
              }}
            />
          </StageCard>
        </ol>
      ) : (
        production &&
        d && (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-display text-[15px] text-fg">{production.nombre}</h2>
              {d.confidencial && (
                <span className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                  <ShieldCheck className="h-3 w-3" /> Confidencial: Claude Haiku (de pago, menos de 1 ¢ por paso)
                </span>
              )}
            </div>
            <ol className="space-y-3">
              {STAGES.map((def, i) => {
                const last = i === STAGES.length - 1;
                if (!isActiveStage(def.id)) return <StageCard key={def.id} def={def} last={last} />;
                const id = def.id;
                return (
                  <StageCard
                    key={id}
                    def={def}
                    state={d.etapas[id]}
                    current={current === id}
                    generating={busyStage === id}
                    last={last}
                    summary={<StageSummary id={id} p={production} />}
                  >
                    <StageBody id={id} p={production} busy={busy} act={dm.act} />
                  </StageCard>
                );
              })}
            </ol>
          </>
        )
      )}
    </div>
  );
}
