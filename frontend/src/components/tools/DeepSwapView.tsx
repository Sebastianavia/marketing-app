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
    { id: 1, label: 'Video base', description: 'Clip fuente a transformar' },
    { id: 2, label: 'Rostro nuevo', description: 'Foto del nuevo sujeto' },
    { id: 3, label: 'Resultado', description: 'Video final' },
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
      <div className="lg:col-span-5 space-y-4">
        {/* Demo Notice Banner */}
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
          <p className="text-[13px] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">Vista previa.</span> El flujo es una simulación: no se procesa el video ni se consumen créditos.
          </p>
        </div>

        <div className="surface-card p-5 sm:p-6 space-y-6">
          <StepIndicator steps={steps} currentStep={step} onStepClick={setStep} />

          <div className="space-y-4">
            {/* Step 1: Base Video */}
            <div>
              <label className="field-label mb-2">
                Video base
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
              <label className="field-label mb-2">
                Rostro nuevo
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
              <label className="field-label">
                Ajustes
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-line bg-surface-2 cursor-pointer hover:border-line-strong transition-colors">
                  <input
                    type="checkbox"
                    checked={enhanceFace}
                    onChange={(e) => setEnhanceFace(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-line-strong bg-surface text-fg focus:ring-0"
                  />
                  <span className="text-xs text-fg-muted">Restauración HD (GFPGAN)</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-line bg-surface-2 cursor-pointer hover:border-line-strong transition-colors">
                  <input
                    type="checkbox"
                    checked={keepAudio}
                    onChange={(e) => setKeepAudio(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-line-strong bg-surface text-fg focus:ring-0"
                  />
                  <span className="text-xs text-fg-muted">Preservar Audio Original</span>
                </label>
              </div>
            </div>

            {/* CTA Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isProcessing || !videoFile || !faceFile}
                onClick={handleStartSwap}
                className="btn-primary w-full h-11 text-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {isProcessing ? 'Procesando…' : 'Generar video'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Canvas */}
      <div className="lg:col-span-7 lg:sticky lg:top-6 h-[min(720px,calc(100dvh-7rem))] min-h-[480px]">
        {isProcessing ? (
          <ShimmerLoader
            progress={progress}
            currentPhase="Reemplazando el rostro…"
            subtext="Simulación de vista previa."
          />
        ) : (
          <VideoPlayer
            videoUrl={resultVideoUrl || undefined}
            title="Resultado"
          />
        )}
      </div>
    </div>
  );
}
