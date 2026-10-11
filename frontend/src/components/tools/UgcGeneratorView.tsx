'use client';

import React, { useState, useEffect } from 'react';
import { useUgcPipeline } from '@/hooks/useUgcPipeline';
import { StepIndicator } from '../ui/StepIndicator';
import { ShimmerLoader } from '../ui/ShimmerLoader';
import { VideoPlayer } from '../ui/VideoPlayer';
import { Sparkles, Bot, Terminal, Key, X, Check, DollarSign } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { SaveProjectWidget } from '../storage/SaveProjectWidget';
import { UgcModelSelector } from './UgcModelSelector';
import { AIModelConfig, UGC_MODELS_CATALOG, DEFAULT_UGC_MODEL } from '@/config/ugc-models.config';

export function UgcGeneratorView() {
  const { state, runPipeline, cancelPipeline, isLoading } = useUgcPipeline();

  const [productName, setProductName] = useState('Lulo Energy Tropical');
  const [productDescription, setProductDescription] = useState(
    'Bebida energética natural a base de pulpa de lulo y guaraná con cero azúcar añadido.'
  );
  const [targetAudience, setTargetAudience] = useState(
    'Jóvenes profesionales y creadores de contenido que necesitan enfoque mental continuo.'
  );
  const [keyBenefit, setKeyBenefit] = useState(
    'Energía sostenida sin el choque de cafeína de las bebidas tradicionales.'
  );
  const [format, setFormat] = useState<'ugc_testimonial' | 'founder_story' | 'problem_solution'>('ugc_testimonial');
  const [injectedNotice, setInjectedNotice] = useState(false);

  // Model & Duration state
  const [selectedModel, setSelectedModel] = useState<AIModelConfig>(DEFAULT_UGC_MODEL);
  const [durationSeconds, setDurationSeconds] = useState<number>(30);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [apiMartKey, setApiMartKey] = useState<string>('');

  // Cargar ApiMart Key de localStorage si existe
  useEffect(() => {
    const saved = localStorage.getItem('apimart_api_key');
    if (saved) setApiMartKey(saved);
  }, []);

  const handleSaveApiMartKey = () => {
    localStorage.setItem('apimart_api_key', apiMartKey.trim());
    setShowKeyModal(false);
  };

  // Escucha activa de inyección desde el Asistente
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);

  useEffect(() => {
    if (injectedData && injectedData.targetTool === 'ugc-generator') {
      setKeyBenefit(injectedData.content);
      setInjectedNotice(true);
      clearInjectedData();
      const timer = setTimeout(() => setInjectedNotice(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [injectedData, clearInjectedData]);

  const steps = [
    { id: 1, label: 'Briefing', description: 'Producto & Audiencia' },
    {
      id: 2,
      label: 'Motor de Video',
      description: `${selectedModel.name} (${selectedModel.provider.toUpperCase()})`,
    },
    { id: 3, label: 'Producción UGC', description: 'Renderizado Final' },
  ];

  const currentStep =
    state.step === 'idle'
      ? 1
      : state.step === 'generating_script' || state.step === 'script_ready'
      ? 2
      : 3;

  const estimatedTotalCost = (selectedModel.costPerSecondUSD * durationSeconds).toFixed(3);

  const handleStart = () => {
    runPipeline({
      productName,
      productDescription,
      targetAudience,
      keyBenefit,
      format,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Panel: Inputs & Pipeline Control */}
      <div className="lg:col-span-5 space-y-4">
        {/* Injected Notification from Asistente */}
        {injectedNotice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300 tabular-nums animate-in fade-in">
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <span>✓ Datos inyectados automáticamente desde el Asistente.</span>
          </div>
        )}

        <div className="surface-card p-5 sm:p-6 space-y-5">
          <StepIndicator steps={steps} currentStep={currentStep} />

          {/* Form Inputs */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">
                Nombre del producto o marca
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="ej: Lumina Skincare Serum"
                className="w-full rounded-xl bg-surface-2 hover:bg-surface-2 border border-line focus:border-accent focus:ring-1 focus:ring-accent/20 px-3.5 py-2.5 text-xs text-fg placeholder:text-fg-subtle transition-all outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">
                Beneficio clave o gancho publicitario
              </label>
              <input
                type="text"
                value={keyBenefit}
                onChange={(e) => setKeyBenefit(e.target.value)}
                placeholder="ej: Piel hidratada y luminosa en solo 7 días"
                className="w-full rounded-xl bg-surface-2 hover:bg-surface-2 border border-line focus:border-accent focus:ring-1 focus:ring-accent/20 px-3.5 py-2.5 text-xs text-fg placeholder:text-fg-subtle transition-all outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">
                Público objetivo
              </label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="ej: Mujeres de 25-40 años interesadas en cosmética limpia"
                className="w-full rounded-xl bg-surface-2 hover:bg-surface-2 border border-line focus:border-accent focus:ring-1 focus:ring-accent/20 px-3.5 py-2.5 text-xs text-fg placeholder:text-fg-subtle transition-all outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">
                Formato de anuncio
              </label>
              <div className="inline-flex w-full p-1 rounded-xl bg-surface-2 border border-line gap-1">
                {[
                  { id: 'ugc_testimonial', label: 'Testimonial Directo' },
                  { id: 'problem_solution', label: 'Problema / Solución' },
                  { id: 'founder_story', label: 'Historia Creador' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id as any)}
                    className={`flex-1 py-2 text-xs rounded-lg font-medium transition-all ${
                      format === f.id
                        ? 'bg-surface text-fg shadow-sm border border-line'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Selector Dinámico de Modelos de Video (ApiMart & OpenRouter) con Precios en Tiempo Real */}
            <UgcModelSelector
              selectedModelId={selectedModel.id}
              onSelectModel={(model) => setSelectedModel(model)}
              durationSeconds={durationSeconds}
              onChangeDuration={(sec) => setDurationSeconds(sec)}
              hasApiMartKey={Boolean(apiMartKey)}
              onOpenKeyModal={() => setShowKeyModal(true)}
            />

            {/* Script preview card if generated */}
            {state.script && (
              <div className="rounded-xl border border-line bg-surface-2 p-4 space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-fg-subtle" />
                    Guion Diseñado con IA
                  </span>
                  <span className="text-[11px] text-fg-subtle font-medium">4 Escenas</span>
                </div>
                <p className="text-xs text-fg-muted italic line-clamp-3 leading-relaxed">
                  &ldquo;{state.script.coreHook}&rdquo;
                </p>
                <div className="text-[11px] text-fg-subtle border-t border-line pt-2 flex justify-between font-sans">
                  <span className="truncate max-w-[240px]">CTA: {state.script.callToAction}</span>
                  <span className="text-fg-muted font-medium">~{state.script.recommendedDurationSeconds}s</span>
                </div>
              </div>
            )}

            {/* Action Buttons with Live Estimated Cost & Budget State */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isLoading || !productName.trim() || !keyBenefit.trim()}
                onClick={handleStart}
                className="btn-primary w-full h-11 px-4 text-sm !justify-between"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-white transition-transform group-hover:scale-110" />
                  <span>
                    {isLoading
                      ? 'Ejecutando pipeline automatizado...'
                      : `Generar con ${selectedModel.name}`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      Number(estimatedTotalCost) > 2.0
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-900 border border-amber-500/25'
                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-900 border border-emerald-500/25'
                    }`}
                  >
                    {Number(estimatedTotalCost) > 2.0 ? '⚠️ Supera $2.00' : '✓ En presupuesto'}
                  </span>

                  <span className="text-[13px] font-medium opacity-80 tabular-nums">
                    ~${estimatedTotalCost} USD <span className="text-fg-subtle font-normal">({durationSeconds}s)</span>
                  </span>
                </div>
              </button>

              {isLoading && (
                <button
                  type="button"
                  onClick={cancelPipeline}
                  className="mt-2 w-full text-center text-xs text-rose-400/80 hover:text-rose-300 transition-colors"
                >
                  Cancelar proceso
                </button>
              )}

              {state.error && (
                <p className="mt-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl">
                  {state.error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Canvas & Preview */}
      <div className="lg:col-span-7 lg:sticky lg:top-6 h-[min(720px,calc(100dvh-7rem))] min-h-[480px]">
        {isLoading ? (
          <ShimmerLoader
            progress={state.progressPercent}
            currentPhase={
              state.step === 'generating_script'
                ? 'Estructurando guion de alta conversión con Gemini / Claude...'
                : `Sintetizando video en formato 9:16 usando ${selectedModel.name} (${selectedModel.provider === 'apimart' ? 'APIMart' : 'OpenRouter'})...`
            }
            subtext="Pipeline Multi-API: El guion fluye automáticamente hacia la renderización de video."
          />
        ) : (
          <VideoPlayer
            videoUrl={state.finalVideoUrl}
            aspectRatio="9:16"
            title={state.script ? state.script.campaignTitle : 'Previsualización Anuncio UGC'}
          />
        )}
      </div>

      {/* Save UGC Project to Local Disk Widget */}
      <div className="lg:col-span-12 pt-2">
        <SaveProjectWidget
          category="UGC"
          projectData={{
            title: state.script?.campaignTitle || productName,
            script: state.script?.fullSpokenText || keyBenefit,
            videoUrl: state.finalVideoUrl || undefined,
            ugcFramework: state.script
              ? {
                  hook: state.script.coreHook,
                  cta: state.script.callToAction,
                  duration: durationSeconds,
                  modelUsed: selectedModel.name,
                  modelProvider: selectedModel.provider === 'apimart' ? 'APIMart' : 'OpenRouter',
                  estimatedCostUsd: Number(estimatedTotalCost),
                }
              : undefined,
            ratio: '9:16',
            status: state.finalVideoUrl ? 'rendered' : 'draft',
          }}
        />
      </div>

      {/* Modal para configurar ApiMart API Key */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <Key className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-fg tabular-nums">
                    Configurar ApiMart API Key
                  </h4>
                  <p className="text-[10px] text-fg-subtle font-sans">
                    Para Hailuo 2.3, Kling v3 Omni y Seedance 2.0
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="text-fg-subtle hover:text-fg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] tabular-nums text-fg-muted">
                Tu clave de ApiMart:
              </label>
              <input
                type="password"
                value={apiMartKey}
                onChange={(e) => setApiMartKey(e.target.value)}
                placeholder="am_live_... o pega tu clave de ApiMart"
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 tabular-nums text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              />
              <p className="text-[10px] text-fg-subtle leading-relaxed font-sans">
                Obtén tu clave en{' '}
                <a
                  href="https://apimart.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 dark:text-emerald-400 underline"
                >
                  apimart.ai
                </a>
                . La clave se guarda de forma segura en tu disco/navegador local.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-fg-subtle hover:text-fg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveApiMartKey}
                className="rounded-lg bg-fg px-4 py-1.5 text-xs font-semibold text-bg hover:bg-fg/85 shadow-sm"
              >
                Guardar Clave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
