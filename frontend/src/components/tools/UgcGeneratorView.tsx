'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, Film, FolderCheck, History, Loader2, MessageSquare, Pencil, RotateCcw, Settings2, Sparkles, Square, Terminal, X } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { useProjectHydrationStore } from '@/store/useProjectHydrationStore';
import { AgentChat } from './ugc-studio/AgentChat';
import { StoryboardCanvas } from './ugc-studio/StoryboardCanvas';
import { AgentActivityPanel } from './ugc-studio/AgentActivityPanel';
import { UgcHistoryPanel } from './ugc-studio/UgcHistoryPanel';
import {
  formatById,
  LANGUAGE_INFO,
  UGC_FORMATS,
  UGC_LANGUAGES,
  UGC_VISUAL_STYLES,
  VISUAL_STYLE_INFO,
  type UgcFormatSetting,
  type UgcLanguage,
  type UgcVisualStyle,
} from '@/config/ugc-formats';
import { LivePricingInfo, Storyboard, StudioAspectRatio, StudioSettings, UgcReference, VideoResolution } from '@/types/ugc-studio.types';

type Popover = 'settings' | 'agents' | 'history' | null;

/** Botón redondo de la barra flotante. */
function BarButton({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
  children,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`relative flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium transition-colors ${
        active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
      {badge && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
    </button>
  );
}

/**
 * UGC Studio: lienzo a pantalla completa con un agente creativo en el chat. El agente arma el
 * storyboard con el equipo de agentes (Gemini) y desde el chat o los botones de cada escena se
 * revisa, se insertan escenas, se cambia luz o ángulo y se renderiza con heygen-video-1
 * (OpenRouter), encadenando el último fotograma de cada escena con la siguiente.
 */
export function UgcGeneratorView({ onExit }: { onExit?: () => void }) {
  const storyboard = useUgcStudioStore((s) => s.storyboard);
  const settings = useUgcStudioStore((s) => s.settings);
  const busy = useUgcStudioStore((s) => s.busy);
  const estimate = useUgcStudioStore((s) => s.estimate);
  const finalVideoUrl = useUgcStudioStore((s) => s.finalVideoUrl);
  const savedProjectPath = useUgcStudioStore((s) => s.savedProjectPath);
  const assembling = useUgcStudioStore((s) => s.assembling);
  const messages = useUgcStudioStore((s) => s.messages);
  const renderQueue = useUgcStudioStore((s) => s.renderQueue);
  const actionsRunning = useUgcStudioStore((s) => s.actionsRunning);
  const { setSettings, confirmRender, dismissEstimate, assemble, reset, hydrate, renameProject, stopRenderQueue, requestRenderPending } =
    useUgcStudioStore.getState();

  const [chatOpen, setChatOpen] = useState(true);
  const [popover, setPopover] = useState<Popover>(null);
  const [injectedBrief, setInjectedBrief] = useState<string>();
  const [injectedNotice, setInjectedNotice] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStaleJoin, setConfirmStaleJoin] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [pricing, setPricing] = useState<LivePricingInfo | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null); // no nulo = editando el nombre
  const commitTitle = () => {
    if (titleDraft !== null && titleDraft.trim() && titleDraft.trim() !== storyboard?.title) renameProject(titleDraft);
    setTitleDraft(null);
  };
  const togglePopover = (p: Popover) => setPopover((cur) => (cur === p ? null : p));

  // Recuperar el trabajo tras recargar la página (una vez por carga; volver a esta vista no lo repite)
  useEffect(() => {
    if (!useUgcStudioStore.persist.hasHydrated()) void useUgcStudioStore.persist.rehydrate();
  }, []);

  // Tarifas actuales de OpenRouter (incluye promociones vigentes)
  useEffect(() => {
    fetch('/api/ugc-studio/pricing')
      .then((r) => (r.ok ? r.json() : null))
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  // Inyección desde el Asistente Mia: rellena el chat del agente
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);
  useEffect(() => {
    if (injectedData && injectedData.targetTool === 'ugc-generator') {
      setInjectedBrief(injectedData.content);
      setInjectedNotice(true);
      setChatOpen(true);
      clearInjectedData();
      const timer = setTimeout(() => setInjectedNotice(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [injectedData, clearInjectedData]);

  // Hidratación desde la Biblioteca de proyectos. El proyecto se consume UNA vez: si quedara guardado,
  // al volver a esta vista pisaría lo que el usuario abrió después desde el historial o el chat.
  const activeProject = useProjectHydrationStore((s) => s.activeProject);
  useEffect(() => {
    const data = activeProject?.category === 'UGC' ? activeProject.ugcStudio : undefined;
    if (!data?.storyboard) return;
    useProjectHydrationStore.getState().clearActiveProject();
    if (useUgcStudioStore.getState().storyboard?.id === (data.storyboard as Storyboard).id) return;
    hydrate(
      {
        storyboard: data.storyboard as Storyboard,
        references: data.references as UgcReference[],
        settings: data.settings as StudioSettings,
      },
      { path: activeProject!.path, videoUrl: activeProject!.videoUrl }
    );
  }, [activeProject, hydrate]);

  const costs = useMemo(() => {
    const scenes = storyboard?.scenes ?? [];
    return {
      spent: scenes.reduce((sum, s) => sum + (s.render?.videoUrl ? s.render.costUSD ?? 0 : 0), 0),
      totalSeconds: scenes.reduce((sum, s) => sum + s.durationSeconds, 0),
      rendered: scenes.filter((s) => s.render?.videoUrl && !s.render.stale).length,
      pending: scenes.filter((s) => !s.render?.videoUrl || s.render.stale || s.status === 'failed').filter((s) => s.status !== 'rendering').length,
      allRendered: scenes.length > 0 && scenes.every((s) => s.status === 'rendered' && s.render?.videoUrl),
      anyStale: scenes.some((s) => s.render?.stale),
      atRisk: scenes.some((s) => s.status === 'rendering') || (!savedProjectPath && scenes.some((s) => s.render?.videoUrl)),
    };
  }, [storyboard, savedProjectPath]);

  const renderedAspect = storyboard?.scenes.find((s) => s.render?.videoUrl && s.render.aspectRatio)?.render?.aspectRatio;
  const pendingCards = messages.some((m) => m.card?.status === 'pending');
  const pendingCount = messages.filter((m) => m.card?.status === 'pending').length;
  const error = useUgcStudioStore((s) => s.error);
  // Las confirmaciones y los errores viven en el chat: si estaba oculto, se abre para que no pasen desapercibidos
  useEffect(() => {
    if (pendingCount > 0 || error) setChatOpen(true);
  }, [pendingCount, error]);
  const estimateScene = storyboard?.scenes.find((s) => s.id === estimate?.sceneId);

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      {/* Lienzo a pantalla completa */}
      <div className="absolute inset-0">
        <StoryboardCanvas rightInset={chatOpen ? 412 : 0} />
      </div>

      {/* Barra superior flotante */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-30 flex items-start gap-2">
        <div className="glass-panel pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1">
          {onExit && <BarButton icon={ArrowLeft} label="Volver al dashboard" onClick={onExit} />}
          <div className="flex items-center gap-2 px-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <div className="max-w-[260px]">
              {titleDraft !== null ? (
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={120}
                  aria-label="Nombre del proyecto"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle();
                    if (e.key === 'Escape') setTitleDraft(null);
                  }}
                  className="input-clean w-[220px] px-1.5 py-0.5 text-[13px] font-semibold"
                />
              ) : storyboard ? (
                <button
                  type="button"
                  title="Cambiar el nombre del proyecto"
                  disabled={!!busy || actionsRunning}
                  onClick={() => setTitleDraft(storyboard.title)}
                  className="group flex max-w-full items-center gap-1 text-left"
                >
                  <span className="truncate text-[13px] font-semibold text-fg">{storyboard.title}</span>
                  <Pencil className="h-3 w-3 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ) : (
                <p className="truncate text-[13px] font-semibold text-fg">UGC Studio</p>
              )}
              <p className="text-[11px] text-fg-subtle">
                {storyboard
                  ? `${storyboard.scenes.length} escenas · ${costs.totalSeconds}s · gastado $${costs.spent.toFixed(2)}`
                  : 'Lienzo con agente creativo'}
              </p>
            </div>
          </div>
          <span className="mx-1 h-6 w-px bg-line" />
          <BarButton icon={Settings2} label="Ajustes del video" active={popover === 'settings'} onClick={() => togglePopover('settings')} />
          <BarButton icon={Bot} label="Equipo de agentes y cuota" active={popover === 'agents'} badge={Boolean(busy)} onClick={() => togglePopover('agents')} />
          <BarButton icon={History} label="Historial de proyectos" active={popover === 'history'} onClick={() => togglePopover('history')} />
          {storyboard && (
            <button
              type="button"
              disabled={!!busy || actionsRunning}
              onClick={() => {
                // Escenas renderizándose o clips pagados sin guardar se perderían: pedir un segundo clic
                if (costs.atRisk && !confirmReset) {
                  setConfirmReset(true);
                  return;
                }
                setConfirmReset(false);
                reset();
              }}
              onBlur={() => setConfirmReset(false)}
              className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${
                confirmReset ? 'bg-rose-500/10 text-rose-500' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <RotateCcw className="h-4 w-4" />
              {confirmReset ? '¿Descartar? Hay clips sin guardar' : 'Nuevo'}
            </button>
          )}
        </div>
      </div>

      {/* Popovers de la barra */}
      {popover && <div className="absolute inset-0 z-10" onClick={() => setPopover(null)} />}
      {popover === 'settings' && (
        <div className="absolute left-3 top-16 z-20 max-h-[calc(100%-6rem)] w-[320px] space-y-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-xl">
          <p className="text-[13px] font-semibold text-fg">Ajustes del video</p>
          <label className="block text-[12px] text-fg-muted">
            Resolución
            <select
              value={settings.resolution}
              disabled={!!busy || actionsRunning}
              onChange={(e) => setSettings({ resolution: e.target.value as VideoResolution })}
              className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
            >
              {(['480p', '768p'] as const).map((res) => (
                <option key={res} value={res}>
                  {pricing ? `${res} · $${pricing.rates[res].base}/s · $${pricing.rates[res].references}/s con referencias` : res}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] text-fg-muted">
            Formato
            <select
              value={settings.aspectRatio}
              disabled={!!busy || actionsRunning}
              onChange={(e) => setSettings({ aspectRatio: e.target.value as StudioAspectRatio })}
              className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
            >
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 cuadrado</option>
              <option value="16:9">16:9 horizontal</option>
            </select>
            {renderedAspect && renderedAspect !== settings.aspectRatio && (
              <span className="mt-1 block text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                Las escenas ya renderizadas están en {renderedAspect}. Para unir el video todas deben tener el mismo formato: vuelve a
                renderizarlas o regresa a {renderedAspect}.
              </span>
            )}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] text-fg-muted">
              Máx. escenas
              <input
                type="number"
                min={1}
                max={8}
                value={settings.maxScenes}
                disabled={!!busy || actionsRunning}
                onChange={(e) => setSettings({ maxScenes: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
                className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
              />
            </label>
            <label className="block text-[12px] text-fg-muted">
              Máx. segundos
              <input
                type="number"
                min={5}
                max={120}
                value={settings.maxTotalSeconds}
                disabled={!!busy || actionsRunning}
                onChange={(e) => setSettings({ maxTotalSeconds: Math.max(5, Math.min(120, Number(e.target.value) || 5)) })}
                className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
              />
            </label>
          </div>
          <div className="space-y-2 border-t border-line pt-3">
            <label className="block text-[12px] text-fg-muted">
              Formato UGC
              <select
                value={settings.format}
                disabled={!!busy || actionsRunning}
                onChange={(e) => setSettings({ format: e.target.value as UgcFormatSetting })}
                className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
              >
                <option value="auto">Automático (el director elige)</option>
                {UGC_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-snug text-fg-subtle">
                {settings.format === 'auto'
                  ? 'El director elige el formato que mejor sirva al brief.'
                  : formatById(settings.format)?.description}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-fg-muted">
                Estilo visual
                <select
                  value={settings.visualStyle}
                  disabled={!!busy || actionsRunning}
                  onChange={(e) => setSettings({ visualStyle: e.target.value as UgcVisualStyle })}
                  className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
                >
                  {UGC_VISUAL_STYLES.map((v) => (
                    <option key={v} value={v}>
                      {VISUAL_STYLE_INFO[v].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[12px] text-fg-muted">
                Idioma del diálogo
                <select
                  value={settings.language}
                  disabled={!!busy || actionsRunning}
                  onChange={(e) => setSettings({ language: e.target.value as UgcLanguage })}
                  className="input-clean mt-1 w-full px-2 py-1.5 text-[12px]"
                >
                  {UGC_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_INFO[l].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {storyboard && (
              <p className="text-[11px] leading-snug text-fg-subtle">
                Formato, estilo e idioma se aplican al crear un storyboard. El actual es{' '}
                {formatById(storyboard.format)?.label ?? 'libre'}, {VISUAL_STYLE_INFO[storyboard.production?.visualStyle ?? 'celular'].label.toLowerCase()}, en{' '}
                {LANGUAGE_INFO[storyboard.production?.language ?? 'es'].label.toLowerCase()}.
              </p>
            )}
          </div>
          {pricing && pricing.discount > 0 && (
            <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              {Math.round(pricing.discount * 100)}% de descuento vigente en OpenRouter
            </p>
          )}
        </div>
      )}
      {popover === 'agents' && (
        <div className="absolute left-3 top-16 z-20 max-h-[calc(100%-6rem)] w-[min(460px,calc(100%-1.5rem))] overflow-auto rounded-2xl">
          <AgentActivityPanel />
        </div>
      )}
      {popover === 'history' && (
        <div className="glass-panel absolute bottom-3 left-3 top-16 z-20 w-[440px] overflow-y-auto rounded-2xl p-1">
          <UgcHistoryPanel
            refreshKey={savedProjectPath + (finalVideoUrl ?? '')}
            onOpen={(p) => {
              hydrate(
                {
                  storyboard: p.ugcStudio.storyboard as Storyboard,
                  references: p.ugcStudio.references as UgcReference[],
                  settings: p.ugcStudio.settings as StudioSettings,
                },
                { path: p.path, videoUrl: p.videoUrl }
              );
              setPopover(null);
            }}
          />
        </div>
      )}

      {injectedNotice && (
        <div className="glass-panel absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] text-emerald-600 dark:text-emerald-300">
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          Brief inyectado desde el Asistente. Revísalo y envíalo.
        </div>
      )}

      {/* Video final (abajo al centro) */}
      {storyboard && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
          {finalOpen && finalVideoUrl && (
            <div className="glass-panel pointer-events-auto rounded-2xl p-2">
              <video src={finalVideoUrl} controls autoPlay playsInline className="max-h-[60vh] rounded-xl bg-black" />
              {savedProjectPath && (
                <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <FolderCheck className="h-3.5 w-3.5" /> Guardado en {savedProjectPath}
                </p>
              )}
            </div>
          )}
          <div className="glass-panel pointer-events-auto flex items-center gap-2 rounded-2xl p-1.5 pl-3">
            <Film className="h-4 w-4 text-accent" />
            <p className="text-[12px] text-fg-muted">
              {renderQueue.length > 0
                ? `Renderizando… quedan ${renderQueue.length}`
                : costs.allRendered
                  ? costs.anyStale
                    ? 'Hay escenas desactualizadas'
                    : 'Todas las escenas listas'
                  : `${costs.rendered}/${storyboard.scenes.length} escenas renderizadas`}
            </p>
            {renderQueue.length > 0 ? (
              <button
                type="button"
                onClick={stopRenderQueue}
                title="La escena que ya se está generando termina igual (ya está pagada)"
                className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium text-rose-500 hover:bg-rose-500/10"
              >
                <Square className="h-3 w-3" /> Detener cola
              </button>
            ) : (
              costs.pending > 0 && (
                <button
                  type="button"
                  disabled={!!busy || actionsRunning}
                  onClick={() => void requestRenderPending()}
                  title="Calcula el costo y pide confirmación en el chat"
                  className="h-8 rounded-xl px-2.5 text-[12px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  Renderizar pendientes ({costs.pending})
                </button>
              )
            )}
            {finalVideoUrl && (
              <button
                type="button"
                onClick={() => setFinalOpen((o) => !o)}
                className="h-8 rounded-xl px-2.5 text-[12px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                {finalOpen ? 'Ocultar video' : 'Ver video final'}
              </button>
            )}
            <button
              type="button"
              disabled={!costs.allRendered || assembling || !!busy || actionsRunning}
              onClick={() => {
                // Con clips desactualizados los empalmes saltan: pedir un segundo clic
                if (costs.anyStale && !confirmStaleJoin) {
                  setConfirmStaleJoin(true);
                  return;
                }
                setConfirmStaleJoin(false);
                void assemble();
              }}
              onBlur={() => setConfirmStaleJoin(false)}
              title={costs.anyStale ? 'Hay escenas desactualizadas: sus empalmes pueden saltar' : undefined}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              {assembling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {confirmStaleJoin ? '¿Unir con escenas desactualizadas?' : finalVideoUrl ? 'Volver a unir' : 'Unir y guardar'}
            </button>
          </div>
        </div>
      )}

      {/* Chat flotante con el agente */}
      <AgentChat open={chatOpen} onClose={() => setChatOpen(false)} initialText={injectedBrief} />
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Abrir chat con el agente"
          className="btn-primary absolute bottom-4 right-4 z-20 h-12 gap-2 rounded-full px-4 text-[13px] shadow-lg"
        >
          <MessageSquare className="h-4 w-4" />
          Agente
          {(pendingCards || busy) && <span className="h-2 w-2 rounded-full bg-white" />}
        </button>
      )}

      {/* Confirmación de gasto por escena */}
      {estimate && estimateScene && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="glass-panel w-full max-w-sm space-y-3 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-fg">Renderizar escena {estimateScene.index}</p>
              <button type="button" onClick={dismissEstimate} aria-label="Cerrar" className="rounded-md p-1 text-fg-subtle hover:bg-surface-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-1 text-[12px] text-fg-muted">
              <li>Modelo: heygen/heygen-video-1 · {settings.resolution} · {settings.aspectRatio}</li>
              <li>
                Duración: {estimateScene.durationSeconds}s × ${estimate.ratePerSecondUSD}/s
                {estimate.discount > 0 && ` (precio actual, ${Math.round(estimate.discount * 100)}% de descuento)`}
              </li>
              {!estimate.livePricing && <li className="text-amber-600 dark:text-amber-400">OpenRouter no respondió: es un estimado con la tarifa de lista.</li>}
              <li>
                {estimate.continuityReference
                  ? `Continúa desde el último fotograma de la escena anterior, enviado como referencia junto a ${estimate.referenceCount - 1} imagen(es) del personaje y el producto.`
                  : estimate.usesFirstFrame
                    ? 'Arranca desde el último fotograma de la escena anterior (empalme continuo).'
                    : `Usa ${estimate.referenceCount} imagen(es) de referencia para mantener al personaje.`}
              </li>
            </ul>
            <p className="text-2xl font-bold tabular-nums text-fg">
              ~${estimate.estimatedCostUSD.toFixed(2)} <span className="text-xs font-normal text-fg-subtle">USD</span>
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => void confirmRender()} className="btn-primary h-9 flex-1 text-[13px]">
                Renderizar
              </button>
              <button
                type="button"
                onClick={dismissEstimate}
                className="h-9 flex-1 rounded-lg border border-line text-[13px] text-fg-muted hover:border-line-strong hover:text-fg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
