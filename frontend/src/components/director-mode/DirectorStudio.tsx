'use client';

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, List, Loader2, Network, Plus, ShieldCheck, X } from 'lucide-react';
import { getDirectorSkill } from '@/config/director-skills';
import { DirectorCanvas } from './canvas/DirectorCanvas';
import { DirectorChat } from './chat/DirectorChat';
import { DirectorModeView } from './DirectorModeView';
import { StartBox } from './StartBox';
import { useDirectorMode } from './useDirectorMode';

/**
 * Modo Director estilo Buzzy: caja de inicio → estudio con chat del agente (izquierda) y lienzo (derecha).
 * "Vista lista" = las tarjetas por etapa de la Fase 1, sobre el mismo borrador.
 */

type View = 'lienzo' | 'lista';
const VIEW_KEY = 'lulo_director_view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'lienzo';
  } catch {
    return 'lienzo';
  }
}

export function DirectorStudio() {
  const dm = useDirectorMode();
  const { production, drafts, busy, error, aviso, loading } = dm;
  const [view, setView] = useState<View>(readView);
  const [newOpen, setNewOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusFor, setFocusFor] = useState<string | null>(null);
  /** Archivos de + Ref que esperan al chat (de la caja de inicio o soltados en el lienzo). */
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [pendingVoiceover, setPendingVoiceover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // El enfoque es de un borrador: al cambiar de borrador se quita
  if (production && focusFor !== production.id) {
    setFocusFor(production.id);
    setFocusId(null);
  }

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // solo no se recuerda
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
      </div>
    );
  }

  const banners = (
    <>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => dm.setError(null)} aria-label="Cerrar" className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {aviso && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200">{aviso}</p>}
    </>
  );

  if (!production?.director || newOpen) {
    return (
      <div className="space-y-3">
        {banners}
        <StartBox
          busy={busy === 'crear'}
          drafts={drafts}
          onStart={async (entrada, refs, locucion) => {
            if (!(await dm.create(entrada))) return;
            setNewOpen(false);
            // El chat (en el lienzo) los guarda en la carpeta de la producción y propone etiquetas
            if (refs.length) {
              chooseView('lienzo');
              setPendingVoiceover(locucion ?? null);
              setPendingFiles(refs);
            }
          }}
          onOpen={(id) => {
            setNewOpen(false);
            void dm.open(id);
          }}
          onCancel={production ? () => setNewOpen(false) : undefined}
        />
      </div>
    );
  }

  const d = production.director;
  const skill = getDirectorSkill(d.skill);

  return (
    <div className="space-y-3">
      {/* Barra del estudio */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 truncate font-display text-[16px] text-fg" title={production.nombre}>
          {production.nombre}
        </h2>
        {skill && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">
            {skill.icono} {skill.nombre}
          </span>
        )}
        {d.confidencial && (
          <span className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted" title="Se usa Claude Haiku (de pago, menos de 1 ¢ por paso)">
            <ShieldCheck className="h-3 w-3" /> Confidencial
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Vista">
            {(
              [
                ['lienzo', 'Lienzo', <Network key="i" className="h-3.5 w-3.5" />],
                ['lista', 'Vista lista', <List key="i" className="h-3.5 w-3.5" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => chooseView(id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
                  view === id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <select
              value={production.id}
              onChange={(e) => void dm.open(e.target.value)}
              className="input-clean h-8 max-w-[220px] appearance-none pl-2 pr-7 text-[12px]"
              aria-label="Borrador abierto"
            >
              {drafts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} · {new Date(r.actualizada).toLocaleDateString('es')}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-fg-subtle" />
          </div>
          <button type="button" onClick={() => setNewOpen(true)} className="btn-secondary h-8 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </button>
        </div>
      </div>

      {banners}

      {view === 'lienzo' ? (
        <div className="grid h-[calc(100vh-290px)] min-h-[560px] grid-rows-[1fr_minmax(0,1fr)] gap-3 lg:grid-cols-[360px_1fr] lg:grid-rows-1">
          <aside className="order-2 min-h-0 overflow-hidden rounded-xl border border-line bg-surface lg:order-1" aria-label="Chat del Director">
            <DirectorChat
              key={production.id}
              dm={dm}
              production={production}
              focusId={focusId}
              onClearFocus={() => setFocusId(null)}
              onFocus={setFocusId}
              pendingFiles={pendingFiles}
              pendingVoiceover={pendingVoiceover}
              onPendingTaken={() => {
                setPendingFiles(null);
                setPendingVoiceover(null);
              }}
            />
          </aside>
          <section
            className={`relative order-1 min-h-0 overflow-hidden rounded-xl border lg:order-2 ${dragging ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}
            aria-label="Lienzo"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              setDragging(false);
              setPendingFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <DirectorCanvas productionId={production.id} d={d} selectedId={focusId} onSelect={setFocusId} />
            {dragging && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-bg/60 text-[13px] text-fg">
                Suelta para añadir referencias {focusId?.startsWith('escena:') || focusId?.startsWith('prompt:') ? 'a la escena elegida' : focusId?.startsWith('etiqueta:') ? 'a la etiqueta elegida' : 'a todo el proyecto'}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl">
          <DirectorModeView dm={dm} embedded />
        </div>
      )}
    </div>
  );
}
