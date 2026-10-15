'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  Film,
  Info,
  Loader2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Shuffle,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { EdgeMenuPanel } from './InsertEdge';
import {
  CharacterBible,
  ProductStrategy,
  REFERENCE_ROLE_LABELS,
  StoryboardScene,
  StudioAspectRatio,
  SupervisorReview,
  UgcReference,
} from '@/types/ugc-studio.types';

// -----------------------------------------------------------------------------
// Utilidades compartidas
// -----------------------------------------------------------------------------

const STATUS: Record<StoryboardScene['status'], { label: string; dot: string }> = {
  draft: { label: 'Borrador', dot: 'bg-fg-subtle' },
  approved: { label: 'Aprobada', dot: 'bg-accent' },
  rendering: { label: 'Renderizando', dot: 'bg-amber-500 animate-pulse' },
  rendered: { label: 'Renderizada', dot: 'bg-emerald-500' },
  failed: { label: 'Falló', dot: 'bg-rose-500' },
};

const TRANSITION_LABEL = {
  apertura: 'Abre desde las referencias',
  continua: 'Continúa desde el último fotograma',
  corte_con_referencias: 'Plano nuevo con referencias',
} as const;

const CARD_WIDTH: Record<StudioAspectRatio, number> = { '9:16': 210, '1:1': 280, '16:9': 360 };
const ASPECT_CLASS: Record<StudioAspectRatio, string> = { '9:16': 'aspect-[9/16]', '1:1': 'aspect-square', '16:9': 'aspect-video' };

const LIGHTING_PRESETS = ['Luz natural de ventana', 'Atardecer cálido', 'Noche con luz de lámpara', 'Luz de estudio suave', 'Neón de colores'];
const ANGLE_PRESETS = ['Primer plano del rostro', 'Plano medio', 'Plano detalle del producto', 'Plano cenital', 'Contrapicado'];

// Solo una barra flotante a la vez: si las tarjetas se mueven bajo un cursor quieto (al insertar o
// reencuadrar), el navegador no avisa que el cursor salió de la anterior.
let closeActiveHover: (() => void) | null = null;

/** Mantiene visibles los botones flotantes mientras el cursor pasa de la tarjeta a la barra. */
function useHoverIntent(delay = 180) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useRef(() => setHover(false));
  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    if (closeActiveHover && closeActiveHover !== close.current) closeActiveHover();
    closeActiveHover = close.current;
    setHover(true);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), delay);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (closeActiveHover === close.current) closeActiveHover = null;
    },
    []
  );
  return { hover, enter, leave };
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`nodrag flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-35 ${
        active
          ? 'bg-accent text-accent-fg'
          : danger
            ? 'text-fg-muted hover:bg-rose-500/10 hover:text-rose-500'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Panel({ title, onClose, children, width = 340 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="nodrag nowheel rounded-2xl border border-line bg-surface p-3 text-fg shadow-xl" style={{ width }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">{title}</p>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Campo con sugerencias rápidas para pedir un cambio a los agentes. */
function InstructionForm({
  placeholder,
  presets,
  submitLabel,
  onSubmit,
  disabled,
}: {
  placeholder: string;
  presets?: string[];
  submitLabel: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSubmit(text.trim());
    setText('');
  };
  return (
    <div className="space-y-2">
      {presets && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setText(p)}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="input-clean w-full resize-none px-2.5 py-1.5 text-[12px]"
      />
      <button type="button" disabled={!text.trim() || disabled} onClick={submit} className="btn-primary h-8 w-full text-[12px]">
        {submitLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-fg-muted">
      <span className="font-medium text-fg">{label}:</span> {children}
    </p>
  );
}

// -----------------------------------------------------------------------------
// Escena
// -----------------------------------------------------------------------------

export type SceneNodeData = {
  scene: StoryboardScene;
  references: UgcReference[];
  sentReferenceIds: string[]; // las que realmente recibe el modelo (ver sentReferenceIds)
  previousRendered: boolean;
  locked: boolean; // agentes trabajando: no se permiten acciones
  aspectRatio: StudioAspectRatio;
  queued: boolean; // en la cola de "renderizar todo"
  sceneCount: number;
  queueActive: boolean; // con una cola de render en marcha no se reordena (cada escena parte de la anterior)
};
export type SceneFlowNode = Node<SceneNodeData, 'scene'>;

type Mode = 'info' | 'relight' | 'angle' | 'edit' | null;
const INFO_PANEL_WIDTH = 360;
const CHAT_RESERVED_PX = 430; // ancho del chat flotante + margen
const INFO_TABS = ['Guion', 'Cámara', 'Audio', 'Empalme', 'Prompt'] as const;

export function SceneNode({ data }: NodeProps<SceneFlowNode>) {
  const { scene, references, sentReferenceIds, previousRendered, locked, aspectRatio, queued, sceneCount, queueActive } = data;
  const {
    approveScene,
    reviseScene,
    relightScene,
    changeAngle,
    requestRenderEstimate,
    retakeScene,
    requestDeleteScenes,
    moveScene,
    duplicateScene,
  } = useUgcStudioStore.getState();
  const { hover, enter, leave } = useHoverIntent();
  const [mode, setMode] = useState<Mode>(null);
  const [tab, setTab] = useState<(typeof INFO_TABS)[number]>('Guion');
  const insertDraft = useUgcStudioStore((s) => s.insertDraft);
  const insertHere = insertDraft?.anchorId === scene.id ? insertDraft : null;
  const edgeMenu = useUgcStudioStore((s) => s.edgeMenu);
  const edgeMenuHere = edgeMenu?.sceneId === scene.id ? edgeMenu.kind : null;
  const [infoSide, setInfoSide] = useState<Position>(Position.Right);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const status = STATUS[scene.status];
  const sentRefs = references.filter((r) => sentReferenceIds.includes(r.id));
  const blockedByPrevious = scene.transition.type === 'continua' && !previousRendered;
  const isRendering = scene.status === 'rendering' || queued;
  const canRender = !locked && !isRendering && !blockedByPrevious;
  // Reordenar o duplicar cambia de qué fotograma parte cada escena: no con renders en marcha
  const structureLocked = locked || isRendering || queueActive;
  const toggle = (m: Mode) => {
    // El panel de detalles se abre del lado con espacio: a la derecha suele estar el chat flotante
    if (m === 'info' && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setInfoSide(rect.right + INFO_PANEL_WIDTH + CHAT_RESERVED_PX > window.innerWidth ? Position.Left : Position.Right);
    }
    setMode((cur) => (cur === m ? null : m));
  };

  // El clip se reproduce al pasar el cursor, como una vista previa
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hover) void v.play().catch(() => {});
    else v.pause();
  }, [hover]);

  return (
    <div onMouseEnter={enter} onMouseLeave={leave} style={{ width: CARD_WIDTH[aspectRatio] }}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" />

      {/* Barra flotante de acciones (aparece al pasar el cursor) */}
      <NodeToolbar isVisible={hover || mode !== null} position={Position.Top} offset={10}>
        <div onMouseEnter={enter} onMouseLeave={leave} className="glass-panel flex items-center gap-0.5 rounded-xl p-1">
          <ToolButton icon={Info} label="Detalles de la escena" active={mode === 'info'} onClick={() => toggle('info')} />
          {scene.status === 'draft' ? (
            <ToolButton icon={Check} label="Aprobar escena" disabled={locked} onClick={() => approveScene(scene.id)} />
          ) : (
            <ToolButton
              icon={scene.render?.videoUrl ? RotateCcw : Film}
              label={
                blockedByPrevious
                  ? 'Renderiza primero la escena anterior'
                  : scene.render?.videoUrl
                    ? 'Volver a renderizar'
                    : 'Renderizar escena'
              }
              disabled={!canRender}
              onClick={() => void requestRenderEstimate(scene.id)}
            />
          )}
          <ToolButton
            icon={Shuffle}
            label="Repetir toma (otra variación, mismo guion)"
            disabled={!canRender || !scene.render?.videoUrl}
            onClick={() => void retakeScene(scene.id)}
          />
          <span className="mx-0.5 h-5 w-px bg-line" />
          <ToolButton icon={Sun} label="Cambiar iluminación" disabled={locked || isRendering} active={mode === 'relight'} onClick={() => toggle('relight')} />
          <ToolButton icon={Camera} label="Cambiar ángulo de cámara" disabled={locked || isRendering} active={mode === 'angle'} onClick={() => toggle('angle')} />
          <ToolButton icon={MessageSquareText} label="Pedir cambios" disabled={locked || isRendering} active={mode === 'edit'} onClick={() => toggle('edit')} />
          <span className="mx-0.5 h-5 w-px bg-line" />
          <ToolButton
            icon={ChevronLeft}
            label="Mover a la izquierda"
            disabled={structureLocked || scene.index === 1}
            onClick={() => void moveScene(scene.id, scene.index - 1)}
          />
          <ToolButton
            icon={ChevronRight}
            label="Mover a la derecha"
            disabled={structureLocked || scene.index === sceneCount}
            onClick={() => void moveScene(scene.id, scene.index + 1)}
          />
          <ToolButton icon={Copy} label="Duplicar escena" disabled={structureLocked} onClick={() => void duplicateScene(scene.id)} />
          <ToolButton icon={Trash2} label="Eliminar escena" danger disabled={locked || isRendering} onClick={() => requestDeleteScenes([scene.id])} />
        </div>
      </NodeToolbar>

      {/* Paneles flotantes */}
      <NodeToolbar isVisible={mode === 'info'} position={infoSide} offset={14} align="start">
        <Panel title={`Escena ${scene.index}: ${scene.title}`} onClose={() => setMode(null)} width={INFO_PANEL_WIDTH}>
          <div className="mb-2 flex gap-1">
            {INFO_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${tab === t ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:text-fg'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {tab === 'Guion' && (
              <>
                <p className="text-[12px] leading-relaxed text-fg-muted">{scene.objective}</p>
                {scene.dialogue.map((d, i) => (
                  <p key={i} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg">
                    <span className="font-medium">{d.speaker}:</span> “{d.line}”
                  </p>
                ))}
                {scene.dialogue.length === 0 && <p className="text-[12px] text-fg-subtle">Sin diálogo</p>}
              </>
            )}
            {tab === 'Cámara' && (
              <>
                <Field label="Plano">{scene.visual.shot}</Field>
                <Field label="Cámara">{scene.visual.camera}</Field>
                <Field label="Acción">{scene.visual.action}</Field>
                <Field label="Locación">{scene.visual.setting}</Field>
                {scene.referenceUsage.map((u) => (
                  <Field key={u.referenceId} label={u.referenceId}>
                    {u.how}
                  </Field>
                ))}
              </>
            )}
            {tab === 'Audio' && (
              <>
                <Field label="Voz">{scene.audio.voiceTone}</Field>
                <Field label="Ambiente">{scene.audio.ambience}</Field>
                <Field label="Música">{scene.audio.music}</Field>
                {scene.sfx.map((c, i) => (
                  <Field key={i} label={c.at}>
                    {c.sound}
                  </Field>
                ))}
              </>
            )}
            {tab === 'Empalme' && (
              <>
                {scene.jointIssue && (
                  <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                    El empalme no encaja: {scene.jointIssue.problem} Decide qué hacer en el aviso de la conexión o en el chat.
                  </p>
                )}
                <Field label="Tipo">{TRANSITION_LABEL[scene.transition.type]}</Field>
                <Field label="Inicio">{scene.transition.startState}</Field>
                <Field label="Final">{scene.transition.endState}</Field>
                {scene.transition.visualEffects && <Field label="VFX">{scene.transition.visualEffects}</Field>}
                {scene.continuityNotes && <Field label="Continuidad">{scene.continuityNotes}</Field>}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {scene.transition.type === 'continua' && (
                    <span className="rounded-md border border-dashed border-accent/50 px-1.5 py-0.5 text-[10px] text-accent">
                      Último fotograma esc. {scene.index - 1}
                    </span>
                  )}
                  {sentRefs.map((r) => (
                    <span key={r.id} className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-fg-muted">
                      {r.id} · {REFERENCE_ROLE_LABELS[r.role]}
                    </span>
                  ))}
                </div>
              </>
            )}
            {tab === 'Prompt' && (
              <p className="allow-select whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-muted">{scene.videoPrompt}</p>
            )}
          </div>
        </Panel>
      </NodeToolbar>

      <NodeToolbar isVisible={mode === 'relight' || mode === 'angle' || mode === 'edit'} position={Position.Bottom} offset={12}>
        {mode === 'relight' && (
          <Panel title="Cambiar iluminación" onClose={() => setMode(null)} width={300}>
            <InstructionForm
              placeholder="¿Qué luz quieres? ej. atardecer cálido entrando por la ventana"
              presets={LIGHTING_PRESETS}
              submitLabel="Aplicar iluminación"
              disabled={locked}
              onSubmit={(t) => {
                setMode(null);
                void relightScene(scene.id, t);
              }}
            />
          </Panel>
        )}
        {mode === 'angle' && (
          <Panel title="Cambiar ángulo de cámara" onClose={() => setMode(null)} width={300}>
            <InstructionForm
              placeholder="¿Qué plano? ej. primer plano desde abajo"
              presets={ANGLE_PRESETS}
              submitLabel="Aplicar ángulo"
              disabled={locked}
              onSubmit={(t) => {
                setMode(null);
                void changeAngle(scene.id, t);
              }}
            />
          </Panel>
        )}
        {mode === 'edit' && (
          <Panel title="Pedir cambios a los agentes" onClose={() => setMode(null)} width={300}>
            <InstructionForm
              placeholder="¿Qué cambiarías? ej. que se ría al final y diga el precio"
              submitLabel="Enviar a los agentes"
              disabled={locked}
              onSubmit={(t) => {
                setMode(null);
                void reviseScene(scene.id, t);
              }}
            />
          </Panel>
        )}
      </NodeToolbar>

      <NodeToolbar isVisible={Boolean(insertHere)} position={Position.Left} offset={16}>
        {insertHere && (
          <Panel
            title={insertHere.afterIndex === 0 ? 'Escena nueva al inicio' : `Escena nueva entre la ${insertHere.afterIndex} y la ${scene.index}`}
            onClose={() => useUgcStudioStore.getState().setInsertDraft(null)}
            width={290}
          >
            <InstructionForm
              placeholder="¿Qué pasa en esta escena? ej. muestra de cerca la textura del producto"
              submitLabel="Crear escena intermedia"
              disabled={locked}
              onSubmit={(t) => {
                useUgcStudioStore.getState().setInsertDraft(null);
                void useUgcStudioStore.getState().insertScene(insertHere.afterIndex, t);
              }}
            />
          </Panel>
        )}
      </NodeToolbar>

      <NodeToolbar isVisible={Boolean(edgeMenuHere)} position={Position.Left} offset={16}>
        {edgeMenuHere && <EdgeMenuPanel scene={scene} kind={edgeMenuHere} disabled={locked || isRendering} />}
      </NodeToolbar>

      {/* Tarjeta: solo el video (o un marcador mientras no hay clip) */}
      <div
        ref={cardRef}
        className={`relative overflow-hidden rounded-2xl border bg-surface shadow-sm transition-shadow ${ASPECT_CLASS[aspectRatio]} ${
          hover ? 'border-line-strong shadow-lg' : 'border-line'
        }`}
      >
        {scene.render?.videoUrl ? (
          <video ref={videoRef} src={scene.render.videoUrl} muted loop playsInline preload="metadata" className="h-full w-full bg-black object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col justify-end bg-gradient-to-b from-surface-2 to-surface p-3">
            <p className="line-clamp-2 text-[13px] font-semibold text-fg">{scene.title}</p>
            <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-fg-muted">
              {scene.dialogue[0] ? `“${scene.dialogue.map((d) => d.line).join(' ')}”` : scene.objective}
            </p>
          </div>
        )}

        {isRendering && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-[11px] font-medium">{scene.status === 'rendering' ? 'Renderizando…' : 'En cola'}</span>
          </div>
        )}

        {/* Insignias */}
        <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-lg bg-black/55 px-1.5 text-[11px] font-semibold text-white backdrop-blur">
          {scene.index}
        </span>
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white backdrop-blur">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur">
          {scene.durationSeconds}s
        </span>
        {(scene.render?.stale || scene.render?.error) && (
          <span
            title={scene.render?.error ?? 'La escena anterior cambió: vuelve a renderizar para que el empalme coincida.'}
            className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >
            <AlertTriangle className="h-3 w-3" /> {scene.render?.error ? 'Error' : 'Desactualizada'}
          </span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Concepto (primer nodo)
// -----------------------------------------------------------------------------

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

const OVERVIEW_TABS = ['Concepto', 'Producto', 'Biblia', 'Supervisores'] as const;

export function OverviewNode({ data }: NodeProps<OverviewFlowNode>) {
  const { hover, enter, leave } = useHoverIntent();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof OVERVIEW_TABS)[number]>('Concepto');

  return (
    <div onMouseEnter={enter} onMouseLeave={leave} className="w-[220px]">
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" />
      <NodeToolbar isVisible={hover && !open} position={Position.Top} offset={10}>
        <div onMouseEnter={enter} onMouseLeave={leave} className="glass-panel rounded-xl p-1">
          <ToolButton icon={Info} label="Ver concepto, producto y biblia" onClick={() => setOpen(true)} />
        </div>
      </NodeToolbar>
      <NodeToolbar isVisible={open} position={Position.Right} offset={14} align="start">
        <Panel title={data.title} onClose={() => setOpen(false)} width={380}>
          <div className="mb-2 flex gap-1">
            {OVERVIEW_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${tab === t ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:text-fg'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
            {tab === 'Concepto' && (
              <>
                <p className="text-[12px] leading-relaxed text-fg-muted">{data.concept}</p>
                <Field label="Gancho">{data.hook}</Field>
                <Field label="CTA">{data.cta}</Field>
                <Field label="Tono">{data.tone}</Field>
              </>
            )}
            {tab === 'Producto' &&
              (data.strategy ? (
                <>
                  <Field label={data.strategy.productName}>{data.strategy.whatItIs}</Field>
                  <Field label="Objetivo">{data.strategy.videoGoal}</Field>
                  {data.strategy.usage.useUnit && <Field label="Se usa">{data.strategy.usage.useUnit}</Field>}
                  <Field label="Uso">
                    {data.strategy.usage.howItIsUsed} ({data.strategy.usage.applicationArea})
                  </Field>
                  <Field label="Gesto en cámara">{data.strategy.usage.onCameraGesture}</Field>
                  {data.strategy.usage.illogicalUses.length > 0 && (
                    <Field label="Evitar">{data.strategy.usage.illogicalUses.join(' · ')}</Field>
                  )}
                  {data.strategy.sensitivity.level === 'sensible' && (
                    <Field label="Producto sensible">{data.strategy.sensitivity.guidelines}</Field>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-fg-subtle">Este storyboard es anterior al estratega de producto.</p>
              ))}
            {tab === 'Biblia' && (
              <>
                {data.bible.characters.map((c) => (
                  <Field key={c.name} label={`${c.name} (${c.referenceIds.join(', ')})`}>
                    {c.appearance} {c.wardrobe}
                  </Field>
                ))}
                {data.bible.product && <Field label={`Producto: ${data.bible.product.name}`}>{data.bible.product.description}</Field>}
                {data.bible.locations.map((l) => (
                  <Field key={l.name} label={l.name}>
                    {l.description}
                  </Field>
                ))}
                <Field label="Estilo">{data.bible.style}</Field>
              </>
            )}
            {tab === 'Supervisores' &&
              data.supervision.map((s) => (
                <Field key={s.department} label={s.department}>
                  {s.score}/10{s.revised ? ' (corregido)' : ''}. {s.notes}
                </Field>
              ))}
          </div>
        </Panel>
      </NodeToolbar>

      <div className={`rounded-2xl border bg-surface p-3.5 shadow-sm transition-shadow ${hover ? 'border-line-strong shadow-lg' : 'border-line'}`}>
        <div className="flex items-center gap-1.5">
          <Clapperboard className="h-4 w-4 text-accent" />
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Concepto</p>
        </div>
        <p className="mt-1.5 text-[14px] font-semibold leading-snug text-fg">{data.title}</p>
        <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-fg-muted">{data.hook}</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// "Añadir escena" (último nodo)
// -----------------------------------------------------------------------------

export type AddSceneNodeData = { afterIndex: number; locked: boolean };
export type AddSceneFlowNode = Node<AddSceneNodeData, 'addScene'>;

export function AddSceneNode({ data }: NodeProps<AddSceneFlowNode>) {
  const [open, setOpen] = useState(false);
  const insertScene = useUgcStudioStore((s) => s.insertScene);
  return (
    <div>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-line-strong" />
      <NodeToolbar isVisible={open} position={Position.Bottom} offset={12}>
        <Panel title="Añadir escena al final" onClose={() => setOpen(false)} width={300}>
          <InstructionForm
            placeholder="¿Qué pasa en la escena nueva? ej. ella se despide y muestra el código de descuento"
            submitLabel="Crear escena"
            disabled={data.locked}
            onSubmit={(t) => {
              setOpen(false);
              void insertScene(data.afterIndex, t);
            }}
          />
        </Panel>
      </NodeToolbar>
      <button
        type="button"
        disabled={data.locked}
        onClick={() => setOpen((o) => !o)}
        className="nodrag flex h-[120px] w-[120px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong text-fg-subtle transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
      >
        <Plus className="h-5 w-5" />
        <span className="text-[11px] font-medium">Añadir escena</span>
      </button>
    </div>
  );
}
