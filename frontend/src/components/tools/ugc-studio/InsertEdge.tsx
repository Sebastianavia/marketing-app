'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { AlertTriangle, Link2, Plus, Scissors, X } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import type { JointIssue, StoryboardScene, TransitionType } from '@/types/ugc-studio.types';

export type InsertEdgeData = {
  afterIndex: number;
  anchorId: string; // escena a la que llega la conexión
  transition: TransitionType;
  jointIssue?: JointIssue;
  rendered: boolean; // la escena ya tiene clip (cambiar su inicio lo descarta)
  sceneBusy: boolean; // renderizándose o en cola
  locked: boolean;
};
export type InsertFlowEdge = Edge<InsertEdgeData, 'insert'>;

const TRANSITIONS = [
  { type: 'continua', icon: Link2, label: 'Continúa', detail: 'Arranca del último fotograma de la anterior, sin corte.' },
  { type: 'corte_con_referencias', icon: Scissors, label: 'Plano nuevo (corte)', detail: 'Otro encuadre o lugar, con el mismo personaje y producto.' },
] as const;

function EdgeButton({
  label,
  onClick,
  disabled,
  active,
  warn,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-all hover:scale-110 disabled:opacity-40 disabled:hover:scale-100 ${
        warn
          ? 'border-amber-500 bg-amber-500 text-white'
          : active
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-line bg-surface text-fg-muted hover:border-accent hover:text-accent'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Conexión entre escenas: "+" para insertar una escena intermedia, el tipo de empalme (continúa o
 * corte) y un aviso cuando el empalme no encaja tras reordenar. Los menús se abren junto a la escena
 * siguiente (ver EdgeMenuPanel): las etiquetas de las conexiones quedan bajo las tarjetas.
 */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<InsertFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const insertDraft = useUgcStudioStore((s) => s.insertDraft);
  const edgeMenu = useUgcStudioStore((s) => s.edgeMenu);
  if (!data) return <BaseEdge id={id} path={path} markerEnd={markerEnd} />;
  const { setInsertDraft, setEdgeMenu } = useUgcStudioStore.getState();

  const continuous = data.transition !== 'corte_con_referencias';
  const opening = data.afterIndex === 0; // de la tarjeta del concepto a la escena 1
  const insertActive = insertDraft?.anchorId === data.anchorId && insertDraft?.afterIndex === data.afterIndex;
  const menu = edgeMenu?.sceneId === data.anchorId ? edgeMenu.kind : null;
  const current = TRANSITIONS.find((t) => t.type === data.transition) ?? TRANSITIONS[0];
  const toggleMenu = (kind: 'transition' | 'joint') => setEdgeMenu(menu === kind ? null : { sceneId: data.anchorId, kind });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: data.jointIssue ? 'rgb(245 158 11)' : continuous ? 'var(--accent)' : 'var(--line-strong)',
          strokeWidth: 1.5,
          strokeDasharray: continuous ? undefined : '6 4',
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data.jointIssue && (
            <EdgeButton label="El empalme no encaja" warn active={menu === 'joint'} onClick={() => toggleMenu('joint')}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </EdgeButton>
          )}
          <EdgeButton
            label="Insertar una escena aquí"
            active={insertActive}
            disabled={data.locked}
            onClick={() => setInsertDraft(insertActive ? null : { afterIndex: data.afterIndex, anchorId: data.anchorId })}
          >
            <Plus className="h-3.5 w-3.5" />
          </EdgeButton>
          {!opening && (
            <EdgeButton
              label={`Empalme: ${current.label}. Clic para cambiarlo`}
              active={menu === 'transition'}
              disabled={data.locked || data.sceneBusy}
              onClick={() => toggleMenu('transition')}
            >
              <current.icon className="h-3.5 w-3.5" />
            </EdgeButton>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** Menú del empalme que llega a `scene`: cambiar continúa/corte o decidir sobre un empalme que no encaja. */
export function EdgeMenuPanel({ scene, kind, disabled }: { scene: StoryboardScene; kind: 'transition' | 'joint'; disabled: boolean }) {
  const { setEdgeMenu, setTransition, resolveJoint } = useUgcStudioStore.getState();
  const close = () => setEdgeMenu(null);
  const rendered = Boolean(scene.render?.videoUrl);
  const opening = scene.index === 1;
  return (
    <div className="nodrag nowheel w-[260px] rounded-2xl border border-line bg-surface p-3 text-fg shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">{kind === 'joint' ? `Empalme de la escena ${scene.index}` : `Cómo arranca la escena ${scene.index}`}</p>
        <button type="button" onClick={close} aria-label="Cerrar" className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {kind === 'transition' && (
        <>
          {TRANSITIONS.map((t) => {
            const selected = t.type === scene.transition.type;
            return (
              <button
                key={t.type}
                type="button"
                disabled={selected || disabled}
                onClick={() => {
                  close();
                  void setTransition(scene.id, t.type);
                }}
                className={`mb-1.5 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  selected ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong disabled:opacity-40'
                }`}
              >
                <t.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  <span className="block text-[12px] font-medium">
                    {t.label}
                    {selected ? ' · actual' : ''}
                  </span>
                  <span className="block text-[11px] leading-snug text-fg-muted">{t.detail}</span>
                </span>
              </button>
            );
          })}
          <p className="text-[11px] leading-snug text-fg-subtle">
            Los agentes reescriben el inicio de la escena (gratis).{rendered ? ' Su clip actual se descarta y habrá que renderizarla de nuevo.' : ''}
          </p>
        </>
      )}

      {kind === 'joint' && scene.jointIssue && (
        <>
          <p className="mb-2 text-[12px] leading-relaxed text-fg-muted">{scene.jointIssue.problem}</p>
          {rendered && <p className="mb-2 text-[11px] text-fg-subtle">Corregirlo descarta su clip: habrá que renderizarla de nuevo.</p>}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                close();
                void resolveJoint(scene.id, 'reescribir');
              }}
              className="btn-primary h-8 text-[12px]"
            >
              Reescribir su inicio{scene.jointIssue.suggestion === 'reescribir' || opening ? ' (sugerido)' : ''}
            </button>
            {!opening && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  close();
                  void resolveJoint(scene.id, 'corte');
                }}
                className="h-8 rounded-lg border border-line text-[12px] text-fg transition-colors hover:border-line-strong disabled:opacity-40"
              >
                Pasar a plano nuevo{scene.jointIssue.suggestion === 'corte' ? ' (sugerido)' : ''}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                close();
                void resolveJoint(scene.id, 'ignorar');
              }}
              className="h-8 rounded-lg text-[12px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              Dejar así
            </button>
          </div>
        </>
      )}
    </div>
  );
}
