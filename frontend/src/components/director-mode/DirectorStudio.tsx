'use client';

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, List, Loader2, MessageSquare, Network, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { getDirectorSkill } from '@/config/director-skills';
import { DirectorCanvas } from './canvas/DirectorCanvas';
import { NodeInspector } from './canvas/NodeInspector';
import { TimelineDock } from './canvas/TimelineDock';
import { DirectorChat } from './chat/DirectorChat';
import { DirectorModeView } from './DirectorModeView';
import { ProductionBar } from './ProductionBar';
import { StartBox } from './StartBox';
import { materialApi } from '@/components/material/material-api';
import { useDirectorMode } from './useDirectorMode';
import { ClaudeAgentChat } from '@/components/claude/ClaudeAgentChat';
import { agentApi } from '@/components/claude/agent-api';
import { useOrchestratorMode } from '@/components/claude/useOrchestratorMode';

/**
 * Modo Director estilo Buzzy: caja de inicio → estudio con chat del agente (izquierda) y lienzo (derecha).
 * "Vista lista" = las tarjetas por etapa de la Fase 1, sobre el mismo borrador.
 */

type View = 'lienzo' | 'lista';

const CLAUDE_STEP_NAMES: Record<string, string> = {
  'lulo: ver_proyecto': 'Mirando el proyecto',
  'lulo: ver_feedback': 'Leyendo el feedback del equipo',
  'lulo: tomar_feedback': 'Descargando los cambios que pidió el equipo',
  'lulo: responder_feedback': 'Respondiendo al equipo en Feedback',
  'lulo: accion': 'Trabajando en el proyecto',
  'lulo: preparar_produccion': 'Preparando el presupuesto',
  'lulo: generar': 'Generando imágenes y clips',
  'lulo: estado_produccion': 'Revisando la generación',
  'lulo: montar_video': 'Montando el video',
  'lulo: agregar_referencia': 'Añadiendo material como referencia',
};

const CLAUDE_SUGGESTIONS = ['Hazlo más corto, de 20 segundos', 'Que la escena 2 sea de noche', 'Cambia el tono a más divertido', 'Revisa los prompts'];
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
  // Con Claude Code (suscripción o API Key) el chat principal es Claude; "Acciones" es el chat de siempre
  const orchestratorMode = useOrchestratorMode();
  const claudeMode = orchestratorMode === 'claude-subscription' || orchestratorMode === 'claude-apikey';
  const [chatTab, setChatTab] = useState<'claude' | 'acciones'>('claude');

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
          showMaterial={claudeMode}
          onStart={async (entrada, refs, locucion, material) => {
            const created = await dm.create(entrada);
            if (!created) return;
            setNewOpen(false);
            if (material) {
              await materialApi.set(`director:${created.id}`, material).catch((err) => dm.setError(err instanceof Error ? err.message : 'No se pudo guardar la carpeta de material.'));
            }
            if (claudeMode) {
              // Primero se guardan las referencias, para que Claude las vea al empezar
              chooseView('lienzo');
              setChatTab('claude');
              if (refs.length) {
                const up = await dm.uploadRefs(refs, { productionId: created.id });
                const voice =
                  up.ok && locucion
                    ? (up.production.director?.referencias ?? []).find((x) => up.nuevas.includes(x.id) && x.medio === 'audio' && x.nombreOriginal === locucion)
                    : undefined;
                if (voice) await dm.act({ accion: 'usar_locucion', refId: voice.id, usarComoVoz: true });
              }
              await agentApi
                .start(`/api/director-mode/${created.id}/claude`)
                .catch((err) => dm.setError(err instanceof Error ? err.message : 'Claude no pudo empezar.'));
              void dm.open(created.id);
              return;
            }
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
  // Nodo Clip del lienzo: modelo, calidad e imagen inicial de una escena ($0)
  const onClip = (body: { accion: 'ajustar_clip'; escenaId: string }) => void dm.act(body, `ajustar_clip:${body.escenaId}`);
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
          <span
            className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"
            title="Se usa Claude Haiku (de pago, menos de 1 ¢ por paso)"
          >
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

      {d.etapas.prompts.estado === 'aprobada' || d.produccion ? (
        <ProductionBar dm={dm} production={production} pulirConClaude={claudeMode} />
      ) : null}

      {view === 'lienzo' ? (
        <div className="grid h-[calc(100vh-290px)] min-h-[560px] grid-rows-[1fr_minmax(0,1fr)] gap-3 lg:grid-cols-[360px_1fr] lg:grid-rows-1">
          <aside className="order-2 flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface lg:order-1" aria-label="Chat del Director">
            {claudeMode && (
              <div className="grid shrink-0 grid-cols-2 gap-0.5 border-b border-line p-1" role="tablist" aria-label="Chat">
                {(
                  [
                    ['claude', 'Claude', <Sparkles key="i" className="h-3.5 w-3.5" />],
                    ['acciones', 'Acciones', <MessageSquare key="i" className="h-3.5 w-3.5" />],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={chatTab === id}
                    onClick={() => setChatTab(id)}
                    className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-[12px] transition-colors ${
                      chatTab === id ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            )}
            {claudeMode && chatTab === 'claude' && (
              <div className="min-h-0 flex-1">
                <ClaudeAgentChat
                  key={production.id}
                  endpoint={`/api/director-mode/${production.id}/claude`}
                  mensajes={d.claude?.mensajes ?? []}
                  onChanged={() => void dm.open(production.id)}
                  title="Claude · director"
                  intro="Claude arma tu video desde la idea y te guía. Usa tu suscripción ($0 extra); lo que cambia lo ves en el lienzo."
                  suggestions={CLAUDE_SUGGESTIONS}
                  placeholder="Ej.: hazlo más emocional y que termine con el logo"
                  stepNames={CLAUDE_STEP_NAMES}
                  refreshOnStep
                  fill
                  materialKey={`director:${production.id}`}
                  attachAccept="application/pdf,image/jpeg,image/png,image/webp,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                  onAttach={async (files) => {
                    const up = await dm.uploadRefs(files, { productionId: production.id });
                    if (!up.ok) throw new Error(up.error);
                    return [`${files.map((f) => f.name).join(', ')} (quedaron como referencias ${up.nuevas.join(', ')}; míralas con ver_proyecto)`];
                  }}
                />
              </div>
            )}
            {/* El chat de siempre sigue montado: recibe los archivos soltados en el lienzo */}
            <div className={claudeMode && chatTab === 'claude' ? 'hidden' : 'min-h-0 flex-1'}>
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
            </div>
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
            <DirectorCanvas
              productionId={production.id}
              d={d}
              paid={production.escenas}
              selectedId={focusId}
              onSelect={setFocusId}
              onClip={onClip}
              onRunPaidScene={(paidId) => void dm.produce('generar', { escenaPagoId: paidId })}
              onRedoPaidScene={(paidId) => void dm.produce('rehacer_pago', { escenaPagoId: paidId })}
              onAuditPaidScene={async (paidId) => {
                const res = await dm.produce('auditar_clip', { escenaPagoId: paidId });
                if (!res || typeof res.ok !== 'boolean') return null;
                return {
                  ok: Boolean(res.ok),
                  sintomas: Array.isArray(res.sintomas) ? (res.sintomas as string[]) : [],
                  resumen: typeof res.resumen === 'string' ? res.resumen : '',
                };
              }}
              busy={!!busy}
            />
            <NodeInspector dm={dm} selectedId={focusId} onClose={() => setFocusId(null)} />
            <TimelineDock dm={dm} selectedId={focusId} onSelect={setFocusId} />
            {dragging && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-bg/60 text-[13px] text-fg">
                Suelta para añadir referencias{' '}
                {focusId?.startsWith('escena:') || focusId?.startsWith('prompt:')
                  ? 'a la escena elegida'
                  : focusId?.startsWith('etiqueta:')
                    ? 'a la etiqueta elegida'
                    : 'a todo el proyecto'}
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
