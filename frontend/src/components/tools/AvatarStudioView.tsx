'use client';

import React, { useState } from 'react';
import { StepIndicator } from '../ui/StepIndicator';
import { UploadZone } from '../ui/UploadZone';
import { ShimmerLoader } from '../ui/ShimmerLoader';
import { VideoPlayer } from '../ui/VideoPlayer';
import { Sparkles, Check, Smartphone, Monitor, Terminal } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { SaveProjectWidget } from '../storage/SaveProjectWidget';

const PRESET_AVATARS = [
  { id: 'Daisy-inskirt-20220818', name: 'Daisy', role: 'Corporativo / Formal' },
  { id: 'Wayne_20240711', name: 'Wayne', role: 'Direct-to-Consumer / Tech' },
  { id: 'Angela-inblackskirt-20220820', name: 'Angela', role: 'Studio Commercial' },
];

export function AvatarStudioView() {
  const [step, setStep] = useState(1);
  const [selectedAvatarId, setSelectedAvatarId] = useState(PRESET_AVATARS[0].id);
  const [uploadedPhoto, setUploadedPhoto] = useState<File | null>(null);
  const [scriptText, setScriptText] = useState(
    'Si buscas escalar las conversiones de tus campañas de video, este sistema automatiza la producción de creativos de alto impacto en menos de dos minutos.'
  );
  const [voiceId, setVoiceId] = useState('2d5b0e6cf36f460aa7fc47e3eee4ba54');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderPhase, setRenderPhase] = useState('');
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [injectedNotice, setInjectedNotice] = useState(false);

  // Escucha activa de inyección desde Mia
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);

  React.useEffect(() => {
    if (injectedData && injectedData.targetTool === 'avatar-studio') {
      setScriptText(injectedData.content);
      setStep(2); // Avanzar a Guion y Audio
      setInjectedNotice(true);
      clearInjectedData();
      const timer = setTimeout(() => setInjectedNotice(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [injectedData, clearInjectedData]);

  const steps = [
    { id: 1, label: 'Sujeto', description: 'Avatar o retrato' },
    { id: 2, label: 'Guion & Audio', description: 'Mensaje y voz' },
    { id: 3, label: 'Producción', description: 'Render HeyGen' },
  ];

  const handleGenerate = async () => {
    setIsRendering(true);
    setRenderProgress(10);
    setRenderPhase('Despachando payload hacia HeyGen API v2...');
    setErrorMsg(null);
    setResultVideoUrl(null);

    try {
      const response = await fetch('/api/heygen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Avatar_${Date.now()}`,
          video_inputs: [
            {
              character: {
                type: 'avatar',
                avatar_id: selectedAvatarId,
                avatar_style: 'normal',
              },
              voice: {
                type: 'text',
                input_text: scriptText,
                voice_id: voiceId,
              },
              background: {
                type: 'color',
                value: '#000000',
              },
            },
          ],
          dimension: aspectRatio === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
          aspect_ratio: aspectRatio,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Error al conectar con HeyGen');
      }

      const { video_id } = await response.json();
      setRenderProgress(35);
      setRenderPhase('Sintetizando fonemas y movimiento labial...');

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 4000));
        const statusRes = await fetch(`/api/heygen/status/${video_id}`);
        if (!statusRes.ok) break;

        const data = await statusRes.json();
        if (data.status === 'completed') {
          finished = true;
          setRenderProgress(100);
          setResultVideoUrl(data.video_url);
          setIsRendering(false);
          setStep(3);
        } else if (data.status === 'failed') {
          throw new Error(data.error?.message || 'El renderizado falló en HeyGen');
        } else {
          setRenderProgress((prev) => Math.min(prev + 12, 92));
          setRenderPhase('Renderizando fotogramas finales...');
        }
      }
    } catch (err: any) {
      setIsRendering(false);
      setErrorMsg(err.message || 'Error inesperado.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Panel: Controls */}
      <div className="lg:col-span-6 space-y-4">
        {/* Injected Notification from Mia */}
        {injectedNotice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300 font-mono animate-in fade-in">
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <span>✓ Guion inyectado automáticamente desde el Asistente.</span>
          </div>
        )}

        <div className="surface-card rounded-xl p-5 sm:p-6 space-y-5">
          <StepIndicator steps={steps} currentStep={step} onStepClick={setStep} />

          {/* STEP 1: Avatar Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-2">
                  Catálogo de Avatares Sintéticos
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {PRESET_AVATARS.map((av) => (
                    <div
                      key={av.id}
                      onClick={() => setSelectedAvatarId(av.id)}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                        selectedAvatarId === av.id
                          ? 'border-white/40 bg-zinc-900 text-white'
                          : 'border-white/[0.06] bg-zinc-950/60 text-zinc-400 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-zinc-100">{av.name}</span>
                        {selectedAvatarId === av.id && <Check className="h-3 w-3 text-zinc-200" />}
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{av.role}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-2">
                  O Retrato Estático Personalizado (Talking Photo)
                </label>
                <UploadZone
                  label="Subir foto frontal"
                  sublabel="PNG o JPG de alta resolución con rostro centrado"
                  onFileSelect={setUploadedPhoto}
                  selectedFile={uploadedPhoto}
                />
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full rounded-md border border-white/[0.1] bg-zinc-900 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  Continuar al Guion →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Script & Voice */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    Guion de Locución
                  </label>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {scriptText.length} caracteres
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="Escribe el texto que el avatar pronunciará..."
                  className="w-full rounded-lg input-clean p-3 text-xs leading-relaxed resize-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-1.5">
                  Voz Sintética
                </label>
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  className="w-full rounded-lg input-clean px-3 py-2 text-xs"
                >
                  <option value="2d5b0e6cf36f460aa7fc47e3eee4ba54">Español - Neutro Profesional (F)</option>
                  <option value="c2727ef672584e03b2241cf131e5f8f5">Español - Dinámico Comercial (M)</option>
                  <option value="e06f9d261e414c2299dfbf9d4f2bc183">Inglés - Studio Natural (F)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-1.5">
                  Formato de Salida
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAspectRatio('9:16')}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-mono transition-colors ${
                      aspectRatio === '9:16'
                        ? 'border-white/30 bg-zinc-900 text-white'
                        : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Smartphone className="h-3 w-3" />
                    9:16 Vertical
                  </button>
                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-mono transition-colors ${
                      aspectRatio === '16:9'
                        ? 'border-white/30 bg-zinc-900 text-white'
                        : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Monitor className="h-3 w-3" />
                    16:9 Horizontal
                  </button>
                </div>
              </div>

              {/* Primary Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={isRendering || !scriptText.trim()}
                  onClick={handleGenerate}
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-white py-2.5 text-xs font-medium text-black hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Generar Video en HeyGen</span>
                </button>
              </div>

              {errorMsg && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-md">
                  {errorMsg}
                </p>
              )}
            </div>
          )}

          {/* STEP 3: Finished status */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-400 font-mono">
                Renderizado completado con éxito en HeyGen.
              </div>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full rounded-md border border-white/[0.08] bg-zinc-900 py-2 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
              >
                ← Nuevo Guion
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Clean Viewport */}
      <div className="lg:col-span-6 h-[540px]">
        {isRendering ? (
          <ShimmerLoader
            progress={renderProgress}
            currentPhase={renderPhase}
            subtext="Generación neuronal de alta fidelidad vía HeyGen."
          />
        ) : (
          <VideoPlayer
            videoUrl={resultVideoUrl || undefined}
            aspectRatio={aspectRatio}
            title="Previsualización Avatar Studio"
          />
        )}
      </div>

      {/* Save Project to Local Disk Widget */}
      <div className="lg:col-span-12 pt-2">
        <SaveProjectWidget
          category="HeyGen"
          projectData={{
            title: 'Avatar-Video-' + (PRESET_AVATARS.find((a) => a.id === selectedAvatarId)?.name || 'Daisy'),
            script: scriptText,
            avatarId: selectedAvatarId,
            avatarName: PRESET_AVATARS.find((a) => a.id === selectedAvatarId)?.name || 'Daisy',
            voiceId,
            ratio: aspectRatio,
            videoUrl: resultVideoUrl || undefined,
            status: resultVideoUrl ? 'rendered' : 'draft',
          }}
        />
      </div>
    </div>
  );
}
