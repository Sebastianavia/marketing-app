'use client';

import React, { useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Check, Clapperboard, Loader2, MessageSquareText, Film, ChevronDown, AlertTriangle, RotateCcw } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { CharacterBible, ProductStrategy, REFERENCE_ROLE_LABELS, StoryboardScene, SupervisorReview, UgcReference } from '@/types/ugc-studio.types';

export type SceneNodeData = {
  scene: StoryboardScene;
  references: UgcReference[];
  sentReferenceIds: string[]; // las que realmente recibe el modelo (ver chainReferenceIds)
  previousRendered: boolean;
  locked: boolean; // agentes trabajando: no se permiten acciones
};
export type SceneFlowNode = Node<SceneNodeData, 'scene'>;

const STATUS: Record<StoryboardScene['status'], { label: string; cls: string }> = {
  draft: { label: 'Borrador', cls: 'bg-slate-500/10 text-slate-600 dark:text-zinc-400 border-slate-500/20' },
  approved: { label: 'Aprobada', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/25' },
  rendering: { label: 'Renderizando', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/25' },
  rendered: { label: 'Renderizada', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/25' },
  failed: { label: 'Falló', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/25' },
};

const TRANSITION_LABEL = {
  apertura: 'Apertura desde referencias',
  continua: 'Continúa desde el último fotograma',
  corte_con_referencias: 'Plano nuevo con referencias',
} as const;

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-200 dark:border-white/[0.06]">
      <button type="button" onClick={() => setOpen(!open)} className="nodrag w-full flex items-center justify-between py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-500">
        {title}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-2 text-[11px] leading-relaxed text-slate-700 dark:text-zinc-300 space-y-1">{children}</div>}
    </div>
  );
}

export function SceneNode({ data }: NodeProps<SceneFlowNode>) {
  const { scene, references, sentReferenceIds, previousRendered, locked } = data;
  const { approveScene, reviseScene, requestRenderEstimate } = useUgcStudioStore.getState();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const sceneRefs = references.filter((r) => sentReferenceIds.includes(r.id));
  const isContinuous = scene.transition.type === 'continua';
  const blockedByPrevious = scene.transition.type === 'continua' && !previousRendered;
  const canRender = !locked && scene.status !== 'draft' && scene.status !== 'rendering' && !blockedByPrevious;
  const status = STATUS[scene.status];

  return (
    <div className="w-[340px] rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0B0B0D] shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-indigo-500 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500 !border-0" />

      {/* Cabecera */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-white dark:text-zinc-900 text-[11px] font-bold">
          {scene.index}
        </span>
        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate flex-1">{scene.title}</p>
        <span className="text-[10px] font-mono text-slate-500">{scene.durationSeconds}s</span>
        <span className={`text-[10px] font-medium border rounded-full px-1.5 py-0.5 ${status.cls}`}>{status.label}</span>
      </div>

      {/* Visual: clip renderizado o referencias asignadas */}
      <div className="px-3 pt-2">
        {scene.render?.videoUrl ? (
          <video src={scene.render.videoUrl} controls playsInline className="nodrag w-full max-h-[300px] rounded-lg bg-black object-contain" />
        ) : (
          <div className="flex gap-1.5 overflow-x-auto">
            {isContinuous && sceneRefs.length > 0 && (
              <div className="shrink-0 h-20 w-16 rounded-md border border-dashed border-indigo-400/50 flex items-center justify-center px-1 text-center text-[9px] text-indigo-500">
                Último fotograma esc. {scene.index - 1}
              </div>
            )}
            {isContinuous && sceneRefs.length === 0 ? (
              <div className="h-20 w-full rounded-lg border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center px-3 text-center text-[10px] text-slate-400">
                Arranca desde el último fotograma de la escena {scene.index - 1}: el modelo no recibe referencias aquí, así que el personaje y el producto llegan desde esa escena.
              </div>
            ) : (
              sceneRefs.length === 0 && (
                <div className="h-20 w-full rounded-lg border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center text-[10px] text-slate-400">
                  Sin referencias asignadas
                </div>
              )
            )}
            {sceneRefs.map((r) => (
              <figure key={r.id} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.label} className="h-20 w-16 rounded-md object-cover border border-slate-200 dark:border-white/10" />
                <figcaption className="text-[9px] text-center font-mono text-slate-500">
                  {r.id} · {REFERENCE_ROLE_LABELS[r.role]}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {scene.render?.stale && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> La escena anterior cambió: re-renderiza para que el empalme coincida.
          </p>
        )}
        {scene.render?.error && <p className="mt-1 text-[10px] text-rose-500">{scene.render.error}</p>}
      </div>

      {/* Contenido */}
      <div className="px-3 pt-2 space-y-1.5">
        <p className="text-[11px] text-slate-500 dark:text-zinc-500 line-clamp-3">{scene.objective}</p>
        <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03] p-2 space-y-1">
          {scene.dialogue.map((d, i) => (
            <p key={i} className="text-[11px] text-slate-800 dark:text-zinc-200">
              <span className="font-semibold">{d.speaker}:</span> “{d.line}”
            </p>
          ))}
          {scene.dialogue.length === 0 && <p className="text-[11px] text-slate-400">Sin diálogo</p>}
        </div>
        <p className="text-[10px] text-indigo-600 dark:text-indigo-300">↳ {TRANSITION_LABEL[scene.transition.type]}</p>
      </div>

      <div className="nowheel px-3 pt-1 max-h-[260px] overflow-y-auto">
        <Section title="Fotografía">
          <p><b>Plano:</b> {scene.visual.shot}</p>
          <p><b>Cámara:</b> {scene.visual.camera}</p>
          <p><b>Acción:</b> {scene.visual.action}</p>
          <p><b>Locación:</b> {scene.visual.setting}</p>
          {scene.referenceUsage.map((u) => (
            <p key={u.referenceId}>
              <b className="font-mono">{u.referenceId}:</b> {u.how}
            </p>
          ))}
        </Section>
        <Section title="Audio y SFX">
          <p><b>Voz:</b> {scene.audio.voiceTone}</p>
          <p><b>Ambiente:</b> {scene.audio.ambience}</p>
          <p><b>Música:</b> {scene.audio.music}</p>
          {scene.sfx.map((c, i) => (
            <p key={i}>
              <span className="font-mono">{c.at}</span> — {c.sound}
            </p>
          ))}
        </Section>
        <Section title="Empalme y VFX">
          <p><b>Inicio:</b> {scene.transition.startState}</p>
          <p><b>Final:</b> {scene.transition.endState}</p>
          {scene.transition.visualEffects && <p><b>VFX:</b> {scene.transition.visualEffects}</p>}
          {scene.continuityNotes && <p><b>Continuidad:</b> {scene.continuityNotes}</p>}
        </Section>
        <Section title="Prompt de video">
          <p className="font-mono text-[10px] whitespace-pre-wrap">{scene.videoPrompt}</p>
        </Section>
      </div>

      {/* Pedir cambios */}
      {feedbackOpen && (
        <div className="px-3 pb-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="¿Qué cambiarías de esta escena?"
            className="nodrag nowheel w-full rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] px-2 py-1.5 text-[11px] text-slate-900 dark:text-zinc-100 outline-none resize-none"
          />
          <button
            type="button"
            disabled={!feedback.trim() || locked}
            onClick={() => {
              void reviseScene(scene.id, feedback);
              setFeedback('');
              setFeedbackOpen(false);
            }}
            className="nodrag mt-1 w-full rounded-lg bg-indigo-600 text-white text-[11px] font-medium py-1.5 disabled:opacity-40"
          >
            Enviar a los agentes
          </button>
        </div>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-1.5 px-3 py-3 border-t border-slate-200 dark:border-white/[0.06]">
        {scene.status === 'draft' ? (
          <button
            type="button"
            disabled={locked}
            onClick={() => approveScene(scene.id)}
            className="nodrag flex-1 flex items-center justify-center gap-1 rounded-lg bg-emerald-600 text-white text-[11px] font-medium py-1.5 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" /> Aprobar
          </button>
        ) : (
          <button
            type="button"
            disabled={!canRender}
            onClick={() => void requestRenderEstimate(scene.id)}
            title={blockedByPrevious ? 'Renderiza primero la escena anterior para encadenar el primer fotograma' : undefined}
            className="nodrag flex-1 flex items-center justify-center gap-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-zinc-900 text-[11px] font-medium py-1.5 disabled:opacity-40"
          >
            {scene.status === 'rendering' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Renderizando…
              </>
            ) : scene.status === 'rendered' || scene.status === 'failed' ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Re-renderizar
              </>
            ) : (
              <>
                <Film className="h-3.5 w-3.5" /> {blockedByPrevious ? 'Espera la escena anterior' : 'Renderizar'}
              </>
            )}
          </button>
        )}
        <button
          type="button"
          disabled={locked || scene.status === 'rendering'}
          onClick={() => setFeedbackOpen(!feedbackOpen)}
          className="nodrag flex items-center gap-1 rounded-lg border border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-zinc-300 text-[11px] px-2.5 py-1.5 disabled:opacity-40"
        >
          <MessageSquareText className="h-3.5 w-3.5" /> Cambios
        </button>
      </div>
    </div>
  );
}

export type OverviewNodeData = {
  title: string;
  concept: string;
  hook: string;
  cta: string;
  tone: string;
  bible: CharacterBible;
  strategy?: ProductStrategy;
  supervision: SupervisorReview[];
};
export type OverviewFlowNode = Node<OverviewNodeData, 'overview'>;

export function OverviewNode({ data }: NodeProps<OverviewFlowNode>) {
  return (
    <div className="w-[300px] rounded-xl border border-indigo-500/30 bg-white dark:bg-[#0B0B0D] shadow-sm p-3 space-y-2">
      <Handle type="source" position={Position.Right} className="!bg-indigo-500 !border-0" />
      <div className="flex items-center gap-1.5">
        <Clapperboard className="h-4 w-4 text-indigo-500" />
        <p className="text-xs font-semibold text-slate-900 dark:text-white">{data.title}</p>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-zinc-400">{data.concept}</p>
      <p className="text-[11px]"><b className="text-slate-800 dark:text-zinc-200">Gancho:</b> <span className="text-slate-600 dark:text-zinc-400">{data.hook}</span></p>
      <p className="text-[11px]"><b className="text-slate-800 dark:text-zinc-200">CTA:</b> <span className="text-slate-600 dark:text-zinc-400">{data.cta}</span></p>
      <div className="nowheel max-h-48 overflow-y-auto">
        {data.strategy && (
          <Section title="Estrategia de producto">
            <p><b>{data.strategy.productName}:</b> {data.strategy.whatItIs}</p>
            <p><b>Objetivo:</b> {data.strategy.videoGoal}</p>
            <p><b>Uso:</b> {data.strategy.usage.howItIsUsed} ({data.strategy.usage.applicationArea})</p>
            <p><b>Gesto en cámara:</b> {data.strategy.usage.onCameraGesture}</p>
            {data.strategy.usage.illogicalUses.length > 0 && <p><b>Evitar:</b> {data.strategy.usage.illogicalUses.join(' · ')}</p>}
            {data.strategy.sensitivity.level === 'sensible' && <p><b>Producto sensible:</b> {data.strategy.sensitivity.guidelines}</p>}
          </Section>
        )}
        <Section title="Biblia de continuidad">
          {data.bible.characters.map((c) => (
            <p key={c.name}>
              <b>{c.name}</b> <span className="font-mono text-[10px]">({c.referenceIds.join(', ')})</span>: {c.appearance} {c.wardrobe}
            </p>
          ))}
          {data.bible.product && (
            <p>
              <b>Producto — {data.bible.product.name}:</b> {data.bible.product.description}
            </p>
          )}
          <p><b>Estilo:</b> {data.bible.style}</p>
        </Section>
        <Section title="Supervisores">
          {data.supervision.map((s) => (
            <p key={s.department}>
              <b className="capitalize">{s.department}</b>: {s.score}/10{s.revised ? ' → corregido' : ''}
            </p>
          ))}
        </Section>
      </div>
    </div>
  );
}
