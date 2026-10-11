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
          <h3 className="text-xs font-medium text-fg">
            Motor de síntesis de video
          </h3>
          <p className="text-[11px] text-fg-subtle">
            Modelos de IA generativa calibrados para UGC
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented Provider Tabs */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-line">
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
                    ? 'bg-surface text-fg shadow-sm border border-line dark:border-transparent'
                    : 'text-fg-subtle hover:text-fg'
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
                  : 'border-line bg-surface-2 text-fg-subtle hover:text-fg'
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
                  ? 'border border-accent/50 bg-accent/40 shadow-sm ring-1 ring-accent/20'
                  : 'border border-line bg-surface-2/70 hover:bg-surface-2/80 hover:border-line-strong'
              }`}
            >
              {/* Encabezado sutil: Tag & Proveedor */}
              <div className="flex items-center justify-between gap-1 mb-2">
                <span className="text-[10px] font-medium text-fg-subtle tracking-wide">
                  {model.tag}
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-fg-subtle font-medium">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isApimart ? 'bg-amber-500' : 'bg-sky-500'
                      }`}
                    />
                    {isApimart ? 'APIMart' : 'OpenRouter'}
                  </span>

                  {isSelected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(99,102,241,0.6)] dark:shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                  )}
                </div>
              </div>

              {/* Nombre comercial */}
              <h4 className="text-xs font-medium text-fg group-hover:text-fg transition-colors truncate">
                {model.name}
              </h4>

              {/* Tarifa base por segundo y límite oficial */}
              <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-xs">
                <span className="text-fg font-medium">
                  ${model.costPerSecondUSD.toFixed(4)}
                  <span className="text-fg-subtle font-normal text-[10px]">/s</span>
                </span>

                <span className="text-[10px] text-fg-subtle font-normal">
                  Máx {model.apiMaxClipDurationSeconds}s/clip
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Popover Flotante Refinado en Hover */}
      {hoveredModel && (
        <div className="pointer-events-none rounded-xl border border-line bg-surface/95 p-3.5 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg flex items-center gap-1.5">
              <Info className="h-3 w-3 text-fg-subtle" />
              {hoveredModel.name}
            </span>
            <span className="text-fg-muted text-[11px] font-medium">
              ${hoveredModel.costPerSecondUSD.toFixed(4)}/seg
            </span>
          </div>

          <p className="text-[11px] text-fg-muted leading-relaxed">
            {hoveredModel.description}
          </p>

          <p className="text-[10px] text-fg-subtle pt-1 border-t border-line">
            <span className="text-fg font-medium">Rendimiento: </span>
            {hoveredModel.recommendedPerformance}
          </p>
        </div>
      )}

      {/* =====================================================================
          3. CONTROL DE DURACIÓN CONSOLIDADO Y MINIMALISTA
          ===================================================================== */}
      <div className="rounded-xl border border-line bg-surface-2/80 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-fg">
            Duración del video
          </span>

          {/* Presets segmentados sin marcos duros */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2/60 border border-line">
            {DURATION_PRESETS.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => handleDurationChange(sec)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                  activeDuration === sec
                    ? 'bg-surface text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg'
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

          <div className="flex items-center justify-between text-[11px] text-fg-subtle">
            <span>{activeDuration} segundos seleccionados</span>
            <span className="text-fg-muted font-medium">
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
