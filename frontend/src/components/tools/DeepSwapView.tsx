'use client';

import React, { useState } from 'react';
import { StepIndicator } from '../ui/StepIndicator';
import { UploadZone } from '../ui/UploadZone';
import { ShimmerLoader } from '../ui/ShimmerLoader';
import { VideoPlayer } from '../ui/VideoPlayer';
import { Sparkles, Sliders, ShieldCheck, AlertCircle } from 'lucide-react';

export function DeepSwapView() {
  const [step, setStep] = useState(1);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [enhanceFace, setEnhanceFace] = useState(true);
  const [keepAudio, setKeepAudio] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);

  const steps = [
    { id: 1, label: 'Video Base', description: 'Clip fuente a transformar' },
    { id: 2, label: 'Rostro Objetivo', description: 'Foto del nuevo sujeto' },
    { id: 3, label: 'Procesamiento', description: 'Genjutsu neuronal' },
  ];

  const handleStartSwap = async () => {
    setIsProcessing(true);
    setProgress(15);

    // Simulación del ciclo de reemplazo facial con motor Genjutsu
    const phases = [
      { p: 30, text: 'Detectando puntos clave faciales en video base...' },
      { p: 55, text: 'Alineando malla 3D y ángulo de iluminación...' },
      { p: 80, text: 'Aplicando blending sin costuras y restauración HD...' },
      { p: 100, text: 'Ensamblaje final de audio y video completado.' },
    ];

    for (const phase of phases) {
      await new Promise((r) => setTimeout(r, 1800));
      setProgress(phase.p);
    }

    setIsProcessing(false);
    setResultVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4');
    setStep(3);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Panel */}
      <div className="lg:col-span-6 space-y-4">
        {/* Demo Notice Banner */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-zinc-400 leading-relaxed">
            <span className="font-semibold text-amber-300 font-mono uppercase tracking-wider block">
              Módulo Genjutsu en Modo Demostración
            </span>
            Esta función está en fase de diseño y no consume créditos reales. Puedes probar el flujo de carga y la simulación del reemplazo neuronal.
          </div>
        </div>

        <div className="surface-card rounded-xl p-5 sm:p-6 space-y-5">
          <StepIndicator steps={steps} currentStep={step} onStepClick={setStep} />

          <div className="space-y-4">
            {/* Step 1: Base Video */}
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-2">
                1. Video Base (Sujeto Original)
              </label>
              <UploadZone
                label="Cargar video base en MP4 o MOV"
                sublabel="Clip de hasta 60 segundos donde el rostro sea visible"
                accept="video/mp4,video/quicktime,video/webm"
                onFileSelect={setVideoFile}
                selectedFile={videoFile}
              />
            </div>

            {/* Step 2: Target Face */}
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-2">
                2. Rostro Objetivo (Target Face)
              </label>
              <UploadZone
                label="Cargar foto del nuevo rostro a insertar"
                sublabel="Retrato frontal nítido y bien iluminado (JPG o PNG)"
                accept="image/*"
                onFileSelect={setFaceFile}
                selectedFile={faceFile}
              />
            </div>

            {/* Step 3: Settings */}
            <div className="pt-1 space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                Ajustes del Motor Genjutsu
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-zinc-950 cursor-pointer hover:border-slate-300 dark:hover:border-white/15 transition-colors">
                  <input
                    type="checkbox"
                    checked={enhanceFace}
                    onChange={(e) => setEnhanceFace(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white focus:ring-0"
                  />
                  <span className="text-xs text-slate-700 dark:text-zinc-300">Restauración HD (GFPGAN)</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-zinc-950 cursor-pointer hover:border-slate-300 dark:hover:border-white/15 transition-colors">
                  <input
                    type="checkbox"
                    checked={keepAudio}
                    onChange={(e) => setKeepAudio(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white focus:ring-0"
                  />
                  <span className="text-xs text-slate-700 dark:text-zinc-300">Preservar Audio Original</span>
                </label>
              </div>
            </div>

            {/* CTA Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isProcessing || !videoFile || !faceFile}
                onClick={handleStartSwap}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-slate-900 py-2.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 disabled:opacity-40 transition-colors shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {isProcessing ? 'Procesando Genjutsu...' : 'Ejecutar Genjutsu (Simulación Demo)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Canvas */}
      <div className="lg:col-span-6 h-[540px]">
        {isProcessing ? (
          <ShimmerLoader
            progress={progress}
            currentPhase="Interpolando fotogramas y texturas faciales..."
            subtext="Motor Genjutsu (Deep Swap) — Proceso de simulación demo."
          />
        ) : (
          <VideoPlayer
            videoUrl={resultVideoUrl || undefined}
            title="Previsualización Genjutsu"
          />
        )}
      </div>
    </div>
  );
}
