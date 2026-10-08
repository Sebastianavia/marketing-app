'use client';

import React, { useState, useMemo } from 'react';
import {
  AIModelConfig,
  UGC_MODELS_CATALOG,
  DEFAULT_UGC_MODEL,
  getClipBreakdown,
} from '@/config/ugc-models.config';
import { useCostEstimator } from '@/hooks/useCostEstimator';
import { Sparkles, Key, Info } from 'lucide-react';

export interface UGCModelSelectorProps {
  selectedModelId?: string;
  onSelectModel?: (model: AIModelConfig) => void;
  durationSeconds?: number;
  onChangeDuration?: (seconds: number) => void;
  hasApiMartKey?: boolean;
  onOpenKeyModal?: () => void;
  className?: string;
}

type ProviderFilter = 'all' | 'apimart' | 'openrouter';

export function UGCModelSelector({
  selectedModelId: externalModelId,
  onSelectModel,
  durationSeconds: externalDuration,
  onChangeDuration,
  hasApiMartKey,
  onOpenKeyModal,
  className = '',
}: UGCModelSelectorProps) {
  const estimator = useCostEstimator({
    initialModelId: externalModelId || DEFAULT_UGC_MODEL.id,
    initialDurationSeconds: externalDuration || 15,
  });

  const activeModelId = externalModelId || estimator.selectedModelId;
  const activeDuration = externalDuration ?? estimator.durationSeconds;

  const activeModel = useMemo(() => {
    return (
      UGC_MODELS_CATALOG.find((m) => m.id === activeModelId) || DEFAULT_UGC_MODEL
    );
  }, [activeModelId]);

  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [hoveredModel, setHoveredModel] = useState<AIModelConfig | null>(null);

  const filteredModels = useMemo(() => {
    return UGC_MODELS_CATALOG.filter((model) => {
      if (providerFilter === 'all') return true;
      return model.provider === providerFilter;
    });
  }, [providerFilter]);

  const handleSelect = (model: AIModelConfig) => {
    estimator.setSelectedModelId(model.id);
    onSelectModel?.(model);
  };

  const handleDurationChange = (sec: number) => {
    estimator.setDurationSeconds(sec);
    onChangeDuration?.(sec);
  };

  const breakdown = useMemo(() => {
    return getClipBreakdown(activeDuration, activeModel);
  }, [activeDuration, activeModel]);

  const DURATION_PRESETS = [15, 30, 60, 120];

  return (
    <div className={`space-y-4 pt-1 ${className}`}>
      {/* =====================================================================
          1. HEADER Y FILTRADO ULTRA-MINIMALISTA (ESTILO LINEAR / VERCEL)
          ===================================================================== */}
      <div className="flex items-center justify-between pb-1">
        <div>
          <h3 className="text-xs font-medium text-slate-800 dark:text-zinc-300">
            Motor de síntesis de video
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-zinc-500">
            Modelos de IA generativa calibrados para UGC
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented Provider Tabs */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06]">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'apimart', label: 'APIMart' },
                { id: 'openrouter', label: 'OpenRouter' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setProviderFilter(tab.id)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all ${
                  providerFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200 dark:bg-white/[0.08] dark:text-white dark:border-transparent'
                    : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {onOpenKeyModal && (
            <button
              type="button"
              onClick={onOpenKeyModal}
              className={`p-1.5 rounded-lg border transition-all ${
                hasApiMartKey
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : 'border-slate-200 dark:border-white/[0.08] bg-slate-100 dark:bg-white/[0.02] text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
              title={hasApiMartKey ? 'API Key configurada' : 'Configurar API Key'}
            >
              <Key className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          2. GRID DE TARJETAS LIMPIAS CON ESPACIO EN BLANCO AGRESIVO
          ===================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {filteredModels.map((model) => {
          const isSelected = model.id === activeModelId;
          const isApimart = model.provider === 'apimart';

          return (
            <div
              key={model.id}
              onClick={() => handleSelect(model)}
              onMouseEnter={() => setHoveredModel(model)}
              onMouseLeave={() => setHoveredModel(null)}
              className={`group relative cursor-pointer rounded-xl p-3.5 transition-all duration-150 ${
                isSelected
                  ? 'border border-indigo-500/50 bg-indigo-50/40 dark:border-white/30 dark:bg-white/[0.04] shadow-sm ring-1 ring-indigo-500/20 dark:ring-white/10'
                  : 'border border-slate-200 dark:border-white/[0.06] bg-slate-50/70 hover:bg-slate-100/80 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/60 hover:border-slate-300 dark:hover:border-white/[0.12]'
              }`}
            >
              {/* Encabezado sutil: Tag & Proveedor */}
              <div className="flex items-center justify-between gap-1 mb-2">
                <span className="text-[10px] font-medium text-slate-500 dark:text-zinc-400 tracking-wide">
                  {model.tag}
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-zinc-500 font-medium">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isApimart ? 'bg-amber-500' : 'bg-sky-500'
                      }`}
                    />
                    {isApimart ? 'APIMart' : 'OpenRouter'}
                  </span>

                  {isSelected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-white shadow-[0_0_8px_rgba(99,102,241,0.6)] dark:shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                  )}
                </div>
              </div>

              {/* Nombre comercial */}
              <h4 className="text-xs font-medium text-slate-800 group-hover:text-slate-950 dark:text-zinc-200 dark:group-hover:text-white transition-colors truncate">
                {model.name}
              </h4>

              {/* Tarifa base por segundo y límite oficial */}
              <div className="mt-3 flex items-center justify-between border-t border-slate-200/80 dark:border-white/[0.04] pt-2 text-xs">
                <span className="text-slate-800 dark:text-zinc-300 font-medium">
                  ${model.costPerSecondUSD.toFixed(4)}
                  <span className="text-slate-400 dark:text-zinc-500 font-normal text-[10px]">/s</span>
                </span>

                <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-normal">
                  Máx {model.apiMaxClipDurationSeconds}s/clip
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Popover Flotante Refinado en Hover */}
      {hoveredModel && (
        <div className="pointer-events-none rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 p-3.5 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Info className="h-3 w-3 text-slate-500 dark:text-zinc-400" />
              {hoveredModel.name}
            </span>
            <span className="text-slate-600 dark:text-zinc-400 text-[11px] font-medium">
              ${hoveredModel.costPerSecondUSD.toFixed(4)}/seg
            </span>
          </div>

          <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
            {hoveredModel.description}
          </p>

          <p className="text-[10px] text-slate-500 dark:text-zinc-500 pt-1 border-t border-slate-200 dark:border-white/[0.04]">
            <span className="text-slate-800 dark:text-zinc-300 font-medium">Rendimiento: </span>
            {hoveredModel.recommendedPerformance}
          </p>
        </div>
      )}

      {/* =====================================================================
          3. CONTROL DE DURACIÓN CONSOLIDADO Y MINIMALISTA
          ===================================================================== */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-slate-50/80 dark:bg-zinc-900/20 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-800 dark:text-zinc-300">
            Duración del video
          </span>

          {/* Presets segmentados sin marcos duros */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-200/60 dark:bg-zinc-900/80 border border-slate-200 dark:border-white/[0.06]">
            {DURATION_PRESETS.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => handleDurationChange(sec)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                  activeDuration === sec
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.09] dark:text-white'
                    : 'text-slate-600 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-300'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {/* Minimalist slider */}
        <div className="space-y-1.5">
          <input
            type="range"
            min={activeModel.apiMinDurationSeconds}
            max={120}
            step={activeDuration > 15 ? 5 : 1}
            value={activeDuration}
            onChange={(e) => handleDurationChange(Number(e.target.value))}
            className="slider-minimal w-full"
          />

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-500">
            <span>{activeDuration} segundos seleccionados</span>
            <span className="text-slate-700 dark:text-zinc-400 font-medium">
              {breakdown.summary}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { UGCModelSelector as UgcModelSelector };
export default UGCModelSelector;
