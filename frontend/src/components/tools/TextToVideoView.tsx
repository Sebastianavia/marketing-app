'use client';

import React, { useState } from 'react';
import { StepIndicator } from '../ui/StepIndicator';
import { ShimmerLoader } from '../ui/ShimmerLoader';
import { VideoPlayer } from '../ui/VideoPlayer';
import { Sparkles, Sliders, Film, Terminal } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';

export function TextToVideoView() {
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState(
    'Toma cinematográfica en cámara lenta de una lata de bebida energética refrescante emergiendo entre cubos de hielo con gotas de condensación e iluminación de neón púrpura y azul.'
  );
  const [stylePreset, setStylePreset] = useState('commercial_cinematic');
  const [durationSec, setDurationSec] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [injectedNotice, setInjectedNotice] = useState(false);

  // Escucha activa de inyección desde Mia
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);

  React.useEffect(() => {
    if (injectedData && injectedData.targetTool === 'text-to-video') {
      setPrompt(injectedData.content);
      setStep(1);
      setInjectedNotice(true);
      clearInjectedData();
      const timer = setTimeout(() => setInjectedNotice(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [injectedData, clearInjectedData]);

  const steps = [
    { id: 1, label: 'Prompt & Estilo', description: 'Dirección visual' },
    { id: 2, label: 'Motor de Video', description: 'Sora / VEO3 / HeyGen' },
    { id: 3, label: 'Exportación', description: 'Render final HD' },
  ];

  const handleGenerate = async () => {
    setIsGenerating(true);
    setProgress(10);

    const phases = [
      { p: 35, text: 'Optimizando prompt y storyboard con LLM...' },
      { p: 65, text: 'Generando coherencia espacial y física de movimiento...' },
      { p: 88, text: 'Escalando resolución a 4K y aplicando gradación de color...' },
      { p: 100, text: 'Video renderizado con éxito.' },
    ];

    for (const phase of phases) {
      await new Promise((r) => setTimeout(r, 2000));
      setProgress(phase.p);
    }

    setIsGenerating(false);
    setVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
    setStep(3);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Panel */}
      <div className="lg:col-span-6 space-y-4">
        {/* Injected Notification from Mia */}
        {injectedNotice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300 font-mono animate-in fade-in">
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <span>✓ Prompt inyectado automáticamente desde el Asistente.</span>
          </div>
        )}

        <div className="surface-card rounded-xl p-5 sm:p-6 space-y-5">
          <StepIndicator steps={steps} currentStep={step} onStepClick={setStep} />

          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                  Prompt / Guion Visual de Marketing
                </label>
                <span className="font-mono text-[10px] text-zinc-600">{prompt.length} chars</span>
              </div>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe la escena, iluminación, producto y movimientos de cámara..."
                className="w-full rounded-lg input-clean p-3 text-xs leading-relaxed resize-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-1.5">
                Estilo Audiovisual
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'commercial_cinematic', label: 'Comercial Cine' },
                  { id: 'tiktok_viral', label: 'Dinámico TikTok' },
                  { id: 'minimal_product', label: 'Producto Minimal' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStylePreset(s.id)}
                    className={`py-2 rounded-lg border text-xs font-mono transition-colors ${
                      stylePreset === s.id
                        ? 'border-white/30 bg-zinc-900 text-white'
                        : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <Sliders className="h-3 w-3 text-zinc-400" />
                  Duración de la Toma
                </span>
                <span className="font-mono text-zinc-300 text-xs">{durationSec}s</span>
              </div>
              <input
                type="range"
                min="5"
                max="30"
                step="5"
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                className="w-full accent-white bg-zinc-800 rounded-lg cursor-pointer h-1.5"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={isGenerating || !prompt.trim()}
                onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-white py-2.5 text-xs font-medium text-black hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isGenerating ? 'Sintetizando Video...' : 'Transformar Guion a Video HD'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Canvas */}
      <div className="lg:col-span-6 h-[540px]">
        {isGenerating ? (
          <ShimmerLoader
            progress={progress}
            currentPhase="Modelando física lumínica y movimiento continuo..."
            subtext="Generación Text-to-Video de alta fidelidad vía Google VEO / Sora."
          />
        ) : (
          <VideoPlayer
            videoUrl={videoUrl || undefined}
            aspectRatio="16:9"
            title="Previsualización Text-to-Video"
          />
        )}
      </div>
    </div>
  );
}
