'use client';

import React, { useState, useRef, useEffect } from 'react';
import { VideoPlayer } from '../ui/VideoPlayer';
import {
  Sparkles,
  Upload,
  Music,
  Mic,
  FileAudio,
  Play,
  RotateCcw,
  Smartphone,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Camera,
  Layers,
  Bot,
  Download,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { SaveProjectWidget } from '../storage/SaveProjectWidget';

const ELEVENLABS_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'Conversacional / Calma' },
  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', style: 'Publicitario / Enérgico' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', style: 'Narrativa / Juvenil' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'Comercial / Cercana' },
];

export function AvatarStudioView() {
  // Estado de imagen / foto de Talking Photo
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');

  // Estado del Guion (OpenRouter)
  const [scriptPrompt, setScriptPrompt] = useState(
    'Presenta un sérum facial con ácido hialurónico destacando resultados en 7 días'
  );
  const [scriptText, setScriptText] = useState(
    'Descubre el poder del ácido hialurónico puro. Con solo dos gotas al día, tu piel lucirá un 40% más hidratada y luminosa en menos de una semana. Pruébalo hoy con envío gratis.'
  );
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  // Estado del Audio Condicional: 'generar' (ElevenLabs) vs 'local' (Archivo MP3)
  const [audioMode, setAudioMode] = useState<'generar' | 'local'>('generar');
  const [selectedVoiceId, setSelectedVoiceId] = useState(ELEVENLABS_VOICES[0].id);
  const [localAudioFile, setLocalAudioFile] = useState<File | null>(null);

  // Estado de Renderizado & Polling HeyGen
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderPhase, setRenderPhase] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Escucha activa de inyección desde Asistente (Mia)
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (injectedData && (injectedData.targetTool === 'avatar-studio' || injectedData.targetTool === 'all')) {
      setScriptText(injectedData.content);
      clearInjectedData();
    }
  }, [injectedData, clearInjectedData]);

  // Manejo de carga de imagen para el Canvas
  const handlePhotoSelect = (file: File) => {
    setPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(objectUrl);
    setFinalVideoUrl(null);
    setErrorMsg(null);
  };

  // 1. Módulo de Texto: Generar Guion con OpenRouter
  const handleGenerateScriptWithAI = async () => {
    if (!scriptPrompt.trim()) return;
    setIsGeneratingScript(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/openrouter/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: scriptPrompt.slice(0, 30),
          productDescription: scriptPrompt,
          targetAudience: 'Compradores en redes sociales',
          keyBenefit: scriptPrompt,
          format: 'ugc_testimonial',
        }),
      });

      if (!res.ok) {
        throw new Error('Error al conectar con OpenRouter para redactar el guion.');
      }

      const data = await res.json();
      setScriptText(data.fullSpokenText || data.coreHook || scriptPrompt);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error generando guion con IA.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // 2. Módulo de Renderizado Completo (OpenRouter + ElevenLabs/Local + HeyGen Talking Photo)
  const handleStartTalkingPhotoRender = async () => {
    if (!photoFile) {
      setErrorMsg('Debes subir una foto (.jpg o .png) al lienzo para iniciar el Talking Photo.');
      return;
    }

    if (audioMode === 'local' && !localAudioFile) {
      setErrorMsg('En modo local debes seleccionar un archivo .mp3 desde tu disco.');
      return;
    }

    if (audioMode === 'generar' && !scriptText.trim()) {
      setErrorMsg('El guion de locución no puede estar vacío.');
      return;
    }

    setIsRendering(true);
    setRenderProgress(10);
    setElapsedSeconds(0);
    setErrorMsg(null);
    setFinalVideoUrl(null);
    setRenderPhase(
      audioMode === 'generar'
        ? 'Sintetizando voz neuronal con ElevenLabs...'
        : 'Procesando archivo de audio local...'
    );

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    try {
      // Preparar FormData para subir archivos binarios
      const formData = new FormData();
      formData.append('image', photoFile);
      formData.append('audioMode', audioMode);
      formData.append('scriptText', scriptText);
      formData.append('voiceId', selectedVoiceId);
      formData.append('aspectRatio', aspectRatio);

      if (audioMode === 'local' && localAudioFile) {
        formData.append('audioFile', localAudioFile);
      }

      setRenderProgress(25);
      setRenderPhase('Subiendo assets y registrando Talking Photo en HeyGen...');

      const response = await fetch('/api/heygen/talking-photo/generate', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Fallo al iniciar renderizado en HeyGen.');
      }

      const { video_id } = await response.json();
      setRenderProgress(40);
      setRenderPhase('Renderizando fotorrealismo y sincronización labial (Lip-Sync)...');

      // Polling asíncrono no bloqueante cada 4 segundos
      let completed = false;
      while (!completed) {
        await new Promise((r) => setTimeout(r, 4000));
        const statusRes = await fetch(`/api/heygen/status/${video_id}`);
        if (!statusRes.ok) break;

        const data = await statusRes.json();
        const currentStatus = (data.status || '').toLowerCase();

        if (currentStatus === 'completed') {
          completed = true;
          setRenderProgress(100);
          setRenderPhase('¡Video completado con éxito!');
          setFinalVideoUrl(data.video_url);
          setIsRendering(false);
          clearInterval(timer);
          return;
        }

        if (currentStatus === 'failed') {
          throw new Error(data.error?.message || 'El renderizado fue rechazado por HeyGen.');
        }

        setRenderProgress((prev) => Math.min(prev + 8, 92));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error en el proceso de renderizado.');
      setIsRendering(false);
      clearInterval(timer);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* =====================================================================
          COLUMNA IZQUIERDA: EL STUDIO CANVAS / STAGE VISUAL (Lienzo Cinemático)
          ===================================================================== */}
      <div className="lg:col-span-5 space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-medium text-zinc-200">
              Lienzo de Producción (Stage)
            </span>
          </div>

          {/* Selector de relación de aspecto del lienzo */}
          <div className="inline-flex p-0.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-xs">
            <button
              type="button"
              onClick={() => setAspectRatio('9:16')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                aspectRatio === '9:16'
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Smartphone className="h-3 w-3" />
              <span>9:16</span>
            </button>
            <button
              type="button"
              onClick={() => setAspectRatio('16:9')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                aspectRatio === '16:9'
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Monitor className="h-3 w-3" />
              <span>16:9</span>
            </button>
          </div>
        </div>

        {/* CONTENEDOR DEL CANVAS: Enmarca la foto o render final */}
        <div
          className={`relative w-full rounded-2xl border border-white/[0.08] bg-zinc-950/80 overflow-hidden flex items-center justify-center transition-all ${
            aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[580px]' : 'aspect-video'
          }`}
        >
          {/* Si ya hay video renderizado: Reproductor Final */}
          {finalVideoUrl ? (
            <div className="relative w-full h-full">
              <VideoPlayer
                videoUrl={finalVideoUrl}
                aspectRatio={aspectRatio}
                title="Talking Photo Final (HeyGen Lip-Sync)"
              />
              <div className="absolute top-3 right-3 z-20">
                <a
                  href={finalVideoUrl}
                  download="talking_photo.mp4"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 hover:bg-black border border-white/20 text-white text-xs font-medium backdrop-blur-md transition-all shadow-lg"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Descargar MP4</span>
                </a>
              </div>
            </div>
          ) : photoPreviewUrl ? (
            /* Si hay foto cargada: Vista previa en el lienzo con guías de encuadre */
            <div className="relative w-full h-full flex items-center justify-center bg-black/60">
              <img
                src={photoPreviewUrl}
                alt="Talking Photo Preview"
                className="w-full h-full object-cover"
              />

              {/* Guías visuales de encuadre facial (Lienzo interactivo) */}
              <div className="absolute inset-4 pointer-events-none border border-white/15 rounded-xl">
                <div className="absolute top-2 left-2 text-[10px] text-zinc-400 font-mono bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
                  Encuadre Lip-Sync ({aspectRatio})
                </div>
              </div>

              {/* Acciones flotantes sobre la foto */}
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-xs border border-white/10 backdrop-blur-md transition-all flex items-center gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Cambiar foto</span>
                </button>
              </div>

              {/* Overlay de procesamiento durante el renderizado */}
              {isRendering && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in">
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
                    <span className="absolute text-[11px] font-mono text-white">
                      {renderProgress}%
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-200">{renderPhase}</p>
                    <p className="text-[11px] text-zinc-500 font-mono">
                      Tiempo transcurrido: {elapsedSeconds}s
                    </p>
                  </div>
                  <div className="w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Estado vacío: Dropzone en el lienzo */
            <div
              onClick={() => fileInputRef.current?.click()}
              className="group cursor-pointer flex flex-col items-center justify-center p-8 text-center space-y-3 hover:bg-white/[0.02] transition-colors w-full h-full"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.08] text-zinc-400 group-hover:text-white group-hover:scale-105 transition-all">
                <Upload className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-200">
                  Arrastra tu foto de retrato aquí
                </p>
                <p className="text-[11px] text-zinc-500">
                  Formatos soportados: JPG o PNG con rostro iluminado
                </p>
              </div>
              <span className="text-[11px] text-indigo-400 font-medium pt-1">
                Explorar archivos en disco
              </span>
            </div>
          )}

          {/* Input oculto para archivo de imagen */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhotoSelect(file);
            }}
          />
        </div>
      </div>

      {/* =====================================================================
          COLUMNA DERECHA: EL INSPECTOR DE PRODUCCIÓN (Paso a Paso Modular)
          ===================================================================== */}
      <div className="lg:col-span-7 space-y-4">
        {/* Banner de error si ocurre fallo */}
        {errorMsg && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/60 p-5 space-y-5">
          {/* =================================================================
              MÓDULO 1: GUION & TEXTO (OpenRouter)
              ================================================================= */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-indigo-400" />
                <span>1. Guion de Locución (OpenRouter)</span>
              </label>

              <button
                type="button"
                disabled={isGeneratingScript || !scriptPrompt.trim()}
                onClick={handleGenerateScriptWithAI}
                className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" />
                <span>{isGeneratingScript ? 'Redactando...' : 'Generar con IA'}</span>
              </button>
            </div>

            {/* Prompt de entrada para redactar con IA */}
            <input
              type="text"
              value={scriptPrompt}
              onChange={(e) => setScriptPrompt(e.target.value)}
              placeholder="Idea o producto (ej: Serum antiedad de vitamina C)"
              className="w-full rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] focus:border-white/20 focus:ring-1 focus:ring-white/20 px-3.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-all"
            />

            {/* Textarea con el guion final que dirá el avatar */}
            <textarea
              rows={3}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Escribe o edita el texto exacto que el avatar dirá..."
              className="w-full rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] focus:border-white/20 focus:ring-1 focus:ring-white/20 p-3.5 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all resize-none leading-relaxed"
            />

            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>Aprox. ~{Math.round(scriptText.split(/\s+/).filter(Boolean).length / 2.5)}s de locución</span>
              <span>{scriptText.length} caracteres</span>
            </div>
          </div>

          {/* =================================================================
              MÓDULO 2: AUDIO CONDICIONAL (ElevenLabs vs Local MP3)
              ================================================================= */}
          <div className="space-y-3 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Music className="h-3.5 w-3.5 text-indigo-400" />
                <span>2. Fuente de Audio (Condicional)</span>
              </label>

              {/* Selector segmentado: Generar vs Local */}
              <div className="inline-flex p-0.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-xs">
                <button
                  type="button"
                  onClick={() => setAudioMode('generar')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    audioMode === 'generar'
                      ? 'bg-white/10 text-white font-medium shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Mic className="h-3 w-3" />
                  <span>ElevenLabs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode('local')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    audioMode === 'local'
                      ? 'bg-white/10 text-white font-medium shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <FileAudio className="h-3 w-3" />
                  <span>Audio Local</span>
                </button>
              </div>
            </div>

            {/* CASO A: SÍNTESIS CON ELEVENLABS */}
            {audioMode === 'generar' ? (
              <div className="space-y-2">
                <span className="text-[11px] text-zinc-500 block">
                  Selecciona la voz neuronal de ElevenLabs:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {ELEVENLABS_VOICES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoiceId(v.id)}
                      className={`text-left p-2.5 rounded-xl border text-xs transition-all ${
                        selectedVoiceId === v.id
                          ? 'border-white/30 bg-white/[0.06] text-white shadow-sm'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                      }`}
                    >
                      <div className="font-medium text-zinc-200">{v.name}</div>
                      <div className="text-[10px] text-zinc-500">{v.style}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* CASO B: ARCHIVO MP3 LOCAL */
              <div className="space-y-2">
                <span className="text-[11px] text-zinc-500 block">
                  Carga un archivo de audio MP3 desde tu computadora:
                </span>

                <div
                  onClick={() => audioInputRef.current?.click()}
                  className="cursor-pointer flex items-center justify-between p-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-center gap-2.5 text-xs text-zinc-300">
                    <FileAudio className="h-4 w-4 text-indigo-400" />
                    <span>
                      {localAudioFile
                        ? localAudioFile.name
                        : 'Seleccionar archivo .mp3 del disco'}
                    </span>
                  </div>

                  {localAudioFile && (
                    <span className="text-[11px] text-emerald-400 font-mono">
                      {(localAudioFile.size / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  )}
                </div>

                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/mp3,audio/mpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setLocalAudioFile(file);
                  }}
                />
              </div>
            )}
          </div>

          {/* =================================================================
              MÓDULO 3: BOTÓN DE ACCIÓN PRINCIPAL (HeyGen Talking Photo)
              ================================================================= */}
          <div className="pt-2">
            <button
              type="button"
              disabled={isRendering || !photoFile}
              onClick={handleStartTalkingPhotoRender}
              className="w-full relative group overflow-hidden rounded-xl bg-gradient-to-r from-zinc-100 via-white to-zinc-200 text-zinc-950 font-medium text-xs sm:text-sm py-3.5 px-4 shadow-[0_0_25px_rgba(255,255,255,0.12)] hover:shadow-[0_0_35px_rgba(255,255,255,0.25)] hover:bg-zinc-100 disabled:opacity-40 transition-all duration-200 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-zinc-900 transition-transform group-hover:scale-110" />
                <span>
                  {isRendering
                    ? 'Procesando Talking Photo en HeyGen...'
                    : 'Renderizar Talking Photo con Lip-Sync'}
                </span>
              </div>

              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-zinc-900 text-white shadow-sm">
                HeyGen v2 API
              </span>
            </button>
          </div>
        </div>

        {/* Guardado en disco local */}
        <SaveProjectWidget
          category="HeyGen"
          projectData={{
            title: `TalkingPhoto_${new Date().toISOString().slice(0, 10)}`,
            script: scriptText,
            videoUrl: finalVideoUrl || undefined,
            avatarName: photoFile ? photoFile.name : 'Personal Photo',
            ratio: aspectRatio,
            status: finalVideoUrl ? 'rendered' : 'draft',
          }}
        />
      </div>
    </div>
  );
}

export default AvatarStudioView;
