'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, Film, FlaskConical, Loader2, RotateCcw, Terminal, X, FolderCheck } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { useProjectHydrationStore } from '@/store/useProjectHydrationStore';
import { BriefChat } from './ugc-studio/BriefChat';
import { StoryboardCanvas } from './ugc-studio/StoryboardCanvas';
import { AgentActivityPanel } from './ugc-studio/AgentActivityPanel';
import { UgcHistoryPanel } from './ugc-studio/UgcHistoryPanel';
import { Storyboard, StudioSettings, UgcReference, VideoResolution, StudioAspectRatio } from '@/types/ugc-studio.types';

interface LivePricingResponse {
  discount: number;
  live: boolean;
  rates: Record<'480p' | '768p', { base: number; references: number }>;
}

const selectClass =
  'rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] px-2 py-1 text-[11px] text-slate-800 dark:text-zinc-200 outline-none';

/**
 * UGC Studio: brief en chat → equipo de agentes (Gemini) arma el storyboard en un lienzo →
 * el usuario aprueba cada escena → render con heygen/heygen-video-1 vía OpenRouter, encadenando
 * el último fotograma de cada escena como primer fotograma de la siguiente.
 */
export function UgcGeneratorView() {
  const storyboard = useUgcStudioStore((s) => s.storyboard);
  const settings = useUgcStudioStore((s) => s.settings);
  const busy = useUgcStudioStore((s) => s.busy);
  const estimate = useUgcStudioStore((s) => s.estimate);
  const error = useUgcStudioStore((s) => s.error);
  const finalVideoUrl = useUgcStudioStore((s) => s.finalVideoUrl);
  const savedProjectPath = useUgcStudioStore((s) => s.savedProjectPath);
  const assembling = useUgcStudioStore((s) => s.assembling);
  const { setSettings, confirmRender, dismissEstimate, assemble, clearError, reset, hydrate } = useUgcStudioStore.getState();

  const [injectedBrief, setInjectedBrief] = useState<string>();
  const [injectedNotice, setInjectedNotice] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  // Nombre de la carpeta del proyecto abierto: volver a unir debe sobrescribirla, no crear otra
  const savedName = savedProjectPath?.split(/[\\/]/).filter(Boolean).pop() ?? '';

  // Recuperar el trabajo tras recargar la página (una vez por carga; volver a esta vista no lo repite)
  useEffect(() => {
    if (!useUgcStudioStore.persist.hasHydrated()) void useUgcStudioStore.persist.rehydrate();
  }, []);
  const [pricing, setPricing] = useState<LivePricingResponse | null>(null);

  // Tarifas actuales de OpenRouter (incluye promociones vigentes)
  useEffect(() => {
    fetch('/api/ugc-studio/pricing')
      .then((r) => (r.ok ? r.json() : null))
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  // Inyección desde el Asistente Mia: rellena el chat del brief
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);
  useEffect(() => {
    if (injectedData && injectedData.targetTool === 'ugc-generator') {
      setInjectedBrief(injectedData.content);
      setInjectedNotice(true);
      clearInjectedData();
      const timer = setTimeout(() => setInjectedNotice(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [injectedData, clearInjectedData]);

  // Hidratación desde la Biblioteca de proyectos
  const activeProject = useProjectHydrationStore((s) => s.activeProject);
  useEffect(() => {
    const data = activeProject?.category === 'UGC' ? activeProject.ugcStudio : undefined;
    // Solo si es otro storyboard: volver a esta vista no debe pisar el trabajo en curso
    if (!data?.storyboard || useUgcStudioStore.getState().storyboard?.id === (data.storyboard as Storyboard).id) return;
    hydrate(
      {
        storyboard: data.storyboard as Storyboard,
        references: data.references as UgcReference[],
        settings: data.settings as StudioSettings,
      },
      { path: activeProject!.path, videoUrl: activeProject!.videoUrl }
    );
    setProjectName(activeProject!.name);
  }, [activeProject, hydrate]);

  const costs = useMemo(() => {
    const scenes = storyboard?.scenes ?? [];
    return {
      spent: scenes.reduce((sum, s) => sum + (s.render?.videoUrl ? s.render.costUSD ?? 0 : 0), 0),
      totalSeconds: scenes.reduce((sum, s) => sum + s.durationSeconds, 0),
      allRendered: scenes.length > 0 && scenes.every((s) => s.status === 'rendered' && s.render?.videoUrl),
      anyStale: scenes.some((s) => s.render?.stale),
      atRisk: scenes.some((s) => s.status === 'rendering') || (!savedProjectPath && scenes.some((s) => s.render?.videoUrl)),
    };
  }, [storyboard, savedProjectPath]);

  const estimateScene = storyboard?.scenes.find((s) => s.id === estimate?.sceneId);

  return (
    <div className="space-y-4">
      {injectedNotice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-600 dark:text-emerald-300 font-mono">
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          <span>✓ Brief inyectado desde el Asistente. Revísalo y envíalo.</span>
        </div>
      )}

      {/* Barra de ajustes y presupuesto */}
      <div className="surface-card rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <FlaskConical className="h-3.5 w-3.5" /> Modo prueba
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
          Resolución
          <select value={settings.resolution} disabled={!!busy} onChange={(e) => setSettings({ resolution: e.target.value as VideoResolution })} className={selectClass}>
            {(['480p', '768p'] as const).map((res) => (
              <option key={res} value={res}>
                {pricing ? `${res} ($${pricing.rates[res].base}/s · $${pricing.rates[res].references}/s con referencias)` : res}
              </option>
            ))}
          </select>
        </label>
        {pricing && pricing.discount > 0 && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            {Math.round(pricing.discount * 100)}% de descuento en OpenRouter
          </span>
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
          Formato
          <select value={settings.aspectRatio} disabled={!!busy} onChange={(e) => setSettings({ aspectRatio: e.target.value as StudioAspectRatio })} className={selectClass}>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
          Máx. escenas
          <input type="number" min={1} max={8} value={settings.maxScenes} disabled={!!busy} onChange={(e) => setSettings({ maxScenes: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} className={`${selectClass} w-14`} />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
          Máx. segundos
          <input type="number" min={5} max={120} value={settings.maxTotalSeconds} disabled={!!busy} onChange={(e) => setSettings({ maxTotalSeconds: Math.max(5, Math.min(120, Number(e.target.value) || 5)) })} className={`${selectClass} w-16`} />
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-zinc-400">
            <DollarSign className="h-3.5 w-3.5" />
            Gastado: <b className="tabular-nums text-slate-900 dark:text-white">${costs.spent.toFixed(2)}</b>
          </span>
          {storyboard && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                // Escenas renderizándose o clips pagados sin guardar se perderían: pedir un segundo clic
                if (costs.atRisk && !confirmReset) {
                  setConfirmReset(true);
                  return;
                }
                setConfirmReset(false);
                reset();
                setProjectName('');
              }}
              onBlur={() => setConfirmReset(false)}
              className={`flex items-center gap-1 text-[11px] disabled:opacity-40 ${
                confirmReset ? 'text-rose-500 font-medium' : 'text-slate-500 hover:text-rose-500'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />{' '}
              {confirmReset ? '¿Descartar? Hay escenas renderizándose o sin guardar' : 'Nuevo'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-600 dark:text-rose-300">
          <p className="flex-1">{error}</p>
          <button type="button" onClick={clearError} aria-label="Cerrar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-4 xl:col-span-3 h-[680px]">
          <BriefChat initialText={injectedBrief} />
        </div>
        <div className="lg:col-span-8 xl:col-span-6 h-[680px]">
          <StoryboardCanvas />
        </div>
        <div className="lg:col-span-12 xl:col-span-3">
          <AgentActivityPanel />
        </div>
      </div>

      {/* Ensamblado final */}
      {storyboard && (
        <div className="surface-card rounded-xl p-4 flex flex-wrap items-center gap-3">
          <Film className="h-4 w-4 text-indigo-500" />
          <div className="flex-1 min-w-48">
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Video final</p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-500">
              {costs.allRendered
                ? `Todas las escenas están listas (${costs.totalSeconds}s). Únelas en un MP4 y guárdalo en la biblioteca.`
                : 'Renderiza todas las escenas para unirlas.'}
              {costs.anyStale && ' Hay escenas desactualizadas: re-renderízalas para que los empalmes coincidan.'}
            </p>
          </div>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={savedName || storyboard.title}
            className={`${selectClass} py-1.5 w-56`}
          />
          <button
            type="button"
            disabled={!costs.allRendered || assembling}
            onClick={() => void assemble(projectName || savedName || storyboard.title)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-medium px-4 py-2 disabled:opacity-40"
          >
            {assembling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {finalVideoUrl ? 'Volver a unir' : 'Unir y guardar'}
          </button>
          {finalVideoUrl && (
            <div className="w-full flex flex-col sm:flex-row gap-4 items-start pt-2">
              <video src={finalVideoUrl} controls playsInline className="w-full sm:w-64 rounded-lg bg-black" />
              {savedProjectPath && (
                <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <FolderCheck className="h-4 w-4" /> Guardado en {savedProjectPath}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
          setProjectName(p.name);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Confirmación de gasto por escena */}
      {estimate && estimateScene && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0B0B0D] p-5 space-y-3 shadow-xl">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Renderizar escena {estimateScene.index}
            </p>
            <ul className="text-xs text-slate-600 dark:text-zinc-400 space-y-1">
              <li>Modelo: heygen/heygen-video-1 · {settings.resolution} · {settings.aspectRatio}</li>
              <li>
                Duración: {estimateScene.durationSeconds}s × ${estimate.ratePerSecondUSD}/s
                {estimate.discount > 0 && ` (precio actual, ${Math.round(estimate.discount * 100)}% de descuento)`}
              </li>
              {!estimate.livePricing && <li className="text-amber-600 dark:text-amber-400">OpenRouter no respondió: es un estimado con la tarifa de lista.</li>}
              <li>
                {estimate.continuityReference
                  ? `Continúa desde el último fotograma de la escena anterior, enviado como referencia junto a ${estimate.referenceCount - 1} imagen(es) del personaje y el producto, para que el empaque salga fiel.`
                  : estimate.usesFirstFrame
                  ? 'Arranca desde el último fotograma de la escena anterior (empalme continuo).'
                  : `Usa ${estimate.referenceCount} imagen(es) de referencia para mantener al personaje.`}
              </li>
            </ul>
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              ~${estimate.estimatedCostUSD.toFixed(2)} <span className="text-xs font-normal text-slate-500">USD</span>
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={dismissEstimate} className="flex-1 rounded-lg border border-slate-200 dark:border-white/10 text-xs py-2 text-slate-700 dark:text-zinc-300">
                Cancelar
              </button>
              <button type="button" onClick={() => void confirmRender()} className="flex-1 rounded-lg bg-indigo-600 text-white text-xs font-medium py-2">
                Confirmar gasto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
