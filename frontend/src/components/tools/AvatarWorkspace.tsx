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
  Cloud,
  FolderOpen,
  Receipt,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { useProjectHydration } from '@/store/useProjectHydrationStore';
import { SaveProjectWidget } from '../storage/SaveProjectWidget';
import { usePricingStore } from '@/store/usePricingStore';
import { extractVideoDurationSeconds } from '@/lib/video/video-metadata';

const ELEVENLABS_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'Conversacional / Calma' },
  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', style: 'Publicitario / Enérgico' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', style: 'Narrativa / Juvenil' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'Comercial / Cercana' },
];

// Error específico de subida a Cloudinary (permite mostrar el toast correcto en la UI)
class CloudinaryUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudinaryUploadError';
  }
}

export function AvatarWorkspace() {
  // Integración de Hidratación de Proyectos Guardados en Disco
  const {
    activeProject,
    mediaWarnings,
    clearActiveProject,
    clearWarnings,
    setActiveProject,
  } = useProjectHydration();

  // Estado de imagen / foto de Retrato
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');

  // Estado del Guion (Google Gemini - Cero Costos)
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
  const [loadedAudioName, setLoadedAudioName] = useState<string | null>(null);

  // Estado de Renderizado: Cloudinary Upload + OpenRouter Render
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderPhase, setRenderPhase] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Facturación y Recibo de Consumo Final
  const [finalCostUSD, setFinalCostUSD] = useState<number | null>(null);
  const [videoDurationReal, setVideoDurationReal] = useState<number | null>(null);

  // Sincronización dinámica de precios al montar el componente
  useEffect(() => {
    usePricingStore.getState().syncPrices();
  }, []);

  // Estimación de costo basada en longitud del guion y tarifa verificada
  const wordCount = scriptText.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.max(5, Math.ceil(wordCount / 2.3));
  const currentRate = usePricingStore((s) => s.getRatePerSecond('heygen/avatar-iv'));
  const estimatedCostUSD = Number((estimatedSeconds * currentRate).toFixed(2));

  // URLs públicas de activos en Cloudinary
  const [cloudinaryImageInfo, setCloudinaryImageInfo] = useState<{ url: string; id: string } | null>(null);
  const [cloudinaryAudioInfo, setCloudinaryAudioInfo] = useState<{ url: string; id: string } | null>(null);

  // Escucha activa de inyección desde Asistente (Mia)
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Efecto de Hidratación al Cargar Proyecto desde la Biblioteca
  useEffect(() => {
    if (!activeProject) return;

    // 1. Inyectar Guion exacto guardado en disco
    if (typeof activeProject.script === 'string') {
      setScriptText(activeProject.script);
    }
    if (activeProject.prompt) {
      setScriptPrompt(activeProject.prompt);
    }

    // 2. Restaurar relación de aspecto
    if (activeProject.ratio === '16:9' || activeProject.ratio === '9:16') {
      setAspectRatio(activeProject.ratio as '9:16' | '16:9');
    }

    // 3. Restaurar Foto de Retrato
    if (activeProject.imageUrl) {
      setPhotoPreviewUrl(activeProject.imageUrl);
      setCloudinaryImageInfo({ url: activeProject.imageUrl, id: '' });
      setPhotoFile(null);
    } else if (activeProject.imagePath) {
      const localMediaUrl = `/api/projects/media?path=${encodeURIComponent(activeProject.imagePath)}`;
      setPhotoPreviewUrl(localMediaUrl);
      setPhotoFile(null);
    }

    // 4. Restaurar Configuración de Audio
    if (activeProject.audioMode === 'local' || activeProject.audioMode === 'generar') {
      setAudioMode(activeProject.audioMode);
    }
    if (activeProject.voiceId) {
      setSelectedVoiceId(activeProject.voiceId);
    }
    if (activeProject.audioUrl) {
      setCloudinaryAudioInfo({ url: activeProject.audioUrl, id: '' });
    }
    if (activeProject.audioName) {
      setLoadedAudioName(activeProject.audioName);
    }

    // 5. Restaurar Video si ya existía render
    if (activeProject.videoUrl) {
      setFinalVideoUrl(activeProject.videoUrl);
    } else if (activeProject.videoPath) {
      setFinalVideoUrl(`/api/projects/media?path=${encodeURIComponent(activeProject.videoPath)}`);
    }

    // 6. Restaurar Recibo de Costo si existía
    if (activeProject.finalCostUSD !== undefined) {
      setFinalCostUSD(activeProject.finalCostUSD);
    }
    if (activeProject.videoDurationReal !== undefined) {
      setVideoDurationReal(activeProject.videoDurationReal);
    }
  }, [activeProject]);

  useEffect(() => {
    if (injectedData && (injectedData.targetTool === 'avatar-studio' || injectedData.targetTool === 'all')) {
      setScriptText(injectedData.content);
      clearInjectedData();
    }
  }, [injectedData, clearInjectedData]);

  const handleOpenProjectFolder = async () => {
    if (!activeProject?.path) return;
    try {
      await fetch('/api/projects/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeProject.path }),
      });
    } catch (err) {
      console.error('Error abriendo carpeta:', err);
    }
  };

  // Manejo de carga de imagen para el Canvas
  const handlePhotoSelect = (file: File) => {
    setPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(objectUrl);
    setFinalVideoUrl(null);
    setErrorMsg(null);
    setCloudinaryImageInfo(null);
  };

  // 1. Módulo de Texto: Generar Guion con Google Gemini (Cero Costos / Pool de Keys)
  const handleGenerateScriptWithAI = async () => {
    if (!scriptPrompt.trim()) return;
    setIsGeneratingScript(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: scriptPrompt }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al conectar con Google Gemini para redactar el guion.');
      }

      const data = await res.json();
      setScriptText(data.script || scriptPrompt);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error generando guion con Gemini.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // ===========================================================================
  // FLUJO DE RENDERIZADO: CLOUDINARY STORAGE + OPENROUTER (heygen/avatar-iv)
  // ===========================================================================
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  };

  const handleRender = async () => {
    // Resolver foto activa (archivo seleccionado o hidratado desde preview / disco / nube)
    let activeImageFile = photoFile;
    if (!activeImageFile && photoPreviewUrl && !cloudinaryImageInfo?.url) {
      try {
        const fetchRes = await fetch(photoPreviewUrl);
        const blob = await fetchRes.blob();
        activeImageFile = new File([blob], activeProject?.avatarName || 'portrait.png', {
          type: blob.type || 'image/png',
        });
      } catch (e) {
        console.warn('No se pudo convertir preview a archivo:', e);
      }
    }

    if (!activeImageFile && !cloudinaryImageInfo?.url) {
      setErrorMsg('Debes tener una foto de retrato en el lienzo para iniciar el render.');
      return;
    }

    // Resolver audio activo para modo local
    let activeLocalAudio = localAudioFile;
    if (audioMode === 'local' && !activeLocalAudio && activeProject?.audioPath && !cloudinaryAudioInfo?.url) {
      try {
        const fetchRes = await fetch(`/api/projects/media?path=${encodeURIComponent(activeProject.audioPath)}`);
        const blob = await fetchRes.blob();
        activeLocalAudio = new File([blob], activeProject.audioName || 'speech.mp3', {
          type: blob.type || 'audio/mpeg',
        });
      } catch (e) {
        console.warn('No se pudo convertir audio de disco a archivo:', e);
      }
    }

    if (audioMode === 'local' && !activeLocalAudio && !cloudinaryAudioInfo?.url) {
      setErrorMsg('En modo local debes seleccionar un archivo .mp3 desde tu disco duro.');
      return;
    }

    if (audioMode === 'generar' && !scriptText.trim()) {
      setErrorMsg('El guion de locución no puede estar vacío.');
      return;
    }

    setIsRendering(true);
    setRenderProgress(5);
    setElapsedSeconds(0);
    setErrorMsg(null);
    setFinalVideoUrl(null);

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    try {
      // -----------------------------------------------------------------------
      // PASO 1 & 2: SUBIR ACTIVOS A CLOUDINARY (await secuencial + validación)
      // -----------------------------------------------------------------------
      setRenderPhase('Subiendo activos a Cloudinary...');
      setRenderProgress(15);

      // Sube un Blob a Cloudinary y garantiza devolver una URL https (secure_url)
      const uploadToCloudinary = async (
        blob: Blob,
        type: 'image' | 'audio',
        filename: string
      ): Promise<{ url: string; id: string }> => {
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('type', type);

        const res = await fetch('/api/storage/cloudinary', { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));

        const url = typeof data?.publicUrl === 'string' ? data.publicUrl.trim() : '';
        if (!res.ok || !/^https?:\/\//i.test(url)) {
          throw new CloudinaryUploadError(data?.error || `Cloudinary no devolvió una secure_url válida para ${type}.`);
        }
        return { url, id: data.publicId || '' };
      };

      // 2a. Retrato (reutiliza la URL ya subida si existe)
      let publicImageUrl: string = cloudinaryImageInfo?.url || '';
      if (!publicImageUrl) {
        if (!activeImageFile) throw new CloudinaryUploadError('No hay imagen para subir.');
        setRenderPhase('Subiendo foto de retrato a Cloudinary...');
        setRenderProgress(25);
        const img = await uploadToCloudinary(activeImageFile, 'image', activeImageFile.name || 'portrait.png');
        publicImageUrl = img.url;
        setCloudinaryImageInfo(img);
      }

      // 2b. Audio (ElevenLabs o MP3 local); se espera a que termine antes de continuar
      let publicAudioUrl: string = cloudinaryAudioInfo?.url || '';
      if (!publicAudioUrl) {
        let audioBlobToUpload: Blob;
        if (audioMode === 'generar') {
          setRenderPhase('Sintetizando voz neuronal con ElevenLabs...');
          const ttsRes = await fetch('/api/elevenlabs/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: scriptText.trim(),
              voiceId: selectedVoiceId,
              language: 'es',
            }),
          });

          if (!ttsRes.ok) {
            const errData = await ttsRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Fallo durante la síntesis de audio en ElevenLabs.');
          }

          audioBlobToUpload = await ttsRes.blob();
        } else {
          if (!activeLocalAudio) throw new CloudinaryUploadError('No hay audio para subir.');
          audioBlobToUpload = activeLocalAudio;
        }

        setRenderPhase('Subiendo audio a Cloudinary...');
        setRenderProgress(45);
        const aud = await uploadToCloudinary(audioBlobToUpload, 'audio', 'speech.mp3');
        publicAudioUrl = aud.url;
        setCloudinaryAudioInfo(aud);
      }

      // Guardia final: jamás enviar el payload a OpenRouter con valores vacíos/undefined
      if (!publicImageUrl || !publicAudioUrl) {
        throw new CloudinaryUploadError('Faltan URLs públicas de imagen o audio.');
      }

      // -----------------------------------------------------------------------
      // PASO 3: CAMBIAR ESTADO A "Enviando a OpenRouter..."
      // -----------------------------------------------------------------------
      setRenderPhase('Enviando a OpenRouter...');
      setRenderProgress(60);

      // -----------------------------------------------------------------------
      // PASO 4: LLAMAR A OPENROUTER (/v1/videos) CON MODELO heygen/avatar-iv
      //         PASÁNDOLE ESTRICTAMENTE LAS URLs DE CLOUDINARY EN input_references
      // -----------------------------------------------------------------------
      const generateResponse = await fetch('/api/openrouter/videos/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'heygen/avatar-iv',
          imageUrl: publicImageUrl,
          audioUrl: publicAudioUrl,
          aspectRatio,
        }),
      });

      if (!generateResponse.ok) {
        const errData = await generateResponse.json().catch(() => ({}));
        throw new Error(errData.error || 'Fallo al despachar la tarea en OpenRouter.');
      }

      const { taskId } = await generateResponse.json();

      // -----------------------------------------------------------------------
      // PASO 5: INICIAR POLLING HASTA QUE OPENROUTER DEVUELVA EL MP4
      // -----------------------------------------------------------------------
      setRenderPhase('Renderizando fotorrealismo y lip-sync en OpenRouter...');
      setRenderProgress(70);

      let completed = false;
      const startTime = Date.now();
      const TIMEOUT_MS = 360000; // 6 minutos

      while (!completed) {
        await new Promise((resolve) => setTimeout(resolve, 3500));

        if (Date.now() - startTime > TIMEOUT_MS) {
          throw new Error('Tiempo de espera superado esperando la respuesta de OpenRouter.');
        }

        const pollRes = await fetch(`/api/openrouter/videos/status/${taskId}`);
        if (!pollRes.ok) {
          console.warn('[Polling] Advertencia temporal de red consultando OpenRouter.');
          continue;
        }

        const pollData = await pollRes.json();
        console.log('[Polling check]:', JSON.stringify(pollData, null, 2));

        const status = (pollData.status || pollData.state || '').toLowerCase();
        const videoUrl =
          pollData.videoUrl ||
          pollData.video_url ||
          pollData.url ||
          pollData.output ||
          pollData.result?.url ||
          pollData.output?.video_url;

        const isFinished =
          ['completed', 'succeeded', 'success', 'done'].includes(status) || Boolean(videoUrl);

        // Resolución Inmediata
        if (isFinished && videoUrl) {
          completed = true;
          clearInterval(timer);

          setRenderPhase('Extrayendo duración real y procesando recibo...');
          setRenderProgress(98);

          // 2. Extracción de Duración Real del MP4 vía metadatos
          const realDuration = await extractVideoDurationSeconds(videoUrl);
          const verifiedRate = usePricingStore.getState().getRatePerSecond('heygen/avatar-iv');
          const finalCost = Number((realDuration * verifiedRate).toFixed(2));

          setFinalCostUSD(finalCost);
          setVideoDurationReal(realDuration);
          setFinalVideoUrl(videoUrl);
          setRenderProgress(100);
          setRenderPhase('¡Video completado con éxito!');
          setIsRendering(false);
          return;
        }

        // Manejo de Errores del Proveedor (failed, error, canceled)
        if (['failed', 'error', 'canceled'].includes(status)) {
          clearInterval(timer);
          setIsRendering(false);
          throw new Error(pollData.error || `El renderizado fue rechazado por el proveedor (${status}).`);
        }

        // Incrementar barra suavemente entre 70% y 95%
        setRenderProgress((prev) => Math.min(prev + 4, 95));
      }
    } catch (err: any) {
      console.error('[Render Error]:', err);
      if (err instanceof CloudinaryUploadError) {
        showToast('Error al subir archivos multimedia');
        setErrorMsg(`Error al subir archivos multimedia: ${err.message}`);
      } else {
        setErrorMsg(err.message || 'Error durante el proceso de renderizado.');
      }
      setIsRendering(false);
      clearInterval(timer);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast de error de subida multimedia */}
      {toast && (
        <div
          role="alert"
          className="fixed top-5 right-5 z-[100] flex items-center gap-2 rounded-xl border border-rose-500/30 bg-zinc-950/95 px-4 py-3 text-xs font-medium text-rose-300 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-2 text-zinc-500 hover:text-white">✕</button>
        </div>
      )}
      {/* 1. Banner de Proyecto Hidratado desde Disco */}
      {activeProject && (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-zinc-950 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">
              Proyecto Activo en Disco:
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
              {activeProject.title || activeProject.name}
            </span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-500 bg-slate-200/60 dark:bg-zinc-900 border border-slate-300/80 dark:border-white/[0.06] px-2 py-0.5 rounded">
              /{activeProject.category}/{activeProject.name}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenProjectFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white text-xs font-mono transition-colors shadow-2xs"
              title="Abrir carpeta exacta en Explorador de Windows"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Ver en Windows</span>
            </button>

            <button
              type="button"
              onClick={() => {
                clearActiveProject();
                setFinalVideoUrl(null);
                setFinalCostUSD(null);
                setVideoDurationReal(null);
                setPhotoPreviewUrl(null);
                setPhotoFile(null);
                setLocalAudioFile(null);
                setLoadedAudioName(null);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 hover:text-rose-500 text-xs font-mono transition-colors shadow-2xs"
              title="Desvincular este proyecto y empezar uno nuevo"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Desvincular</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Banner de Advertencias Multimedia (Manejo no destructivo: preserva el guion) */}
      {mediaWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 flex items-start justify-between gap-3 text-amber-700 dark:text-amber-300">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Aviso de Archivos Multimedia en Disco
              </p>
              {mediaWarnings.map((warning, idx) => (
                <p key={idx} className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed font-sans">
                  {warning}
                </p>
              ))}
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 font-mono pt-0.5">
                ✓ El texto de tu guion y la configuración se han mantenido intactos en el editor.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearWarnings}
            className="text-slate-700 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white text-xs px-2.5 py-1 rounded bg-slate-200/80 dark:bg-black/40 hover:bg-slate-300 dark:hover:bg-black/60 shrink-0 transition-colors"
          >
            Entendido
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* =====================================================================
            COLUMNA IZQUIERDA: EL STUDIO CANVAS / STAGE VISUAL (Lienzo Cinemático)
            ===================================================================== */}
        <div className="lg:col-span-5 space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <span className="text-xs font-medium text-slate-800 dark:text-zinc-200">
              Lienzo de Producción (Stage)
            </span>
          </div>

          {/* Selector de relación de aspecto del lienzo */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.08] text-xs">
            <button
              type="button"
              onClick={() => setAspectRatio('9:16')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                aspectRatio === '9:16'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-white/10 dark:text-white font-medium'
                  : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
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
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-white/10 dark:text-white font-medium'
                  : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
              }`}
            >
              <Monitor className="h-3 w-3" />
              <span>16:9</span>
            </button>
          </div>
        </div>

        {/* CONTENEDOR PRINCIPAL DEL CANVAS */}
        <div
          className={`relative mx-auto rounded-2xl border border-slate-200/80 dark:border-white/[0.1] bg-slate-100 dark:bg-zinc-950 overflow-hidden shadow-xl transition-all duration-300 flex items-center justify-center ${
            aspectRatio === '9:16'
              ? 'w-full max-w-[340px] aspect-[9/16]'
              : 'w-full aspect-[16/9]'
          }`}
        >
          {/* CASO A: VIDEO RENDERIZADO FINAL */}
          {finalVideoUrl ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
              <video
                src={finalVideoUrl}
                controls
                autoPlay
                loop
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 right-3 flex items-center gap-2">
                {finalCostUSD !== null && (
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md border text-[11px] font-mono shadow-lg ${
                      estimatedCostUSD !== undefined && finalCostUSD > estimatedCostUSD
                        ? 'bg-amber-950/80 border-amber-500/40 text-amber-300'
                        : 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                    }`}
                  >
                    <Receipt className="h-3 w-3" />
                    <span>${finalCostUSD.toFixed(2)} USD ({videoDurationReal}s)</span>
                  </div>
                )}
                <a
                  href={finalVideoUrl}
                  download="avatar_render_final.mp4"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-white text-xs font-medium border border-white/10 shadow-lg backdrop-blur-md transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>MP4</span>
                </a>
              </div>
            </div>
          ) : photoPreviewUrl ? (
            /* CASO B: VISTA PREVIA DEL RETRATO */
            <div className="relative w-full h-full group">
              <img
                src={photoPreviewUrl}
                alt="Retrato de avatar"
                className="w-full h-full object-cover"
              />

              {/* Guía de encuadre facial (Regla de Tercios) */}
              <div className="absolute inset-0 pointer-events-none opacity-25 grid grid-cols-3 grid-rows-3 border border-white/20">
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20 flex items-center justify-center">
                  <div className="h-10 w-10 rounded-full border border-dashed border-emerald-400/60" />
                </div>
                <div className="border-b border-white/20" />
                <div className="border-r border-white/20" />
                <div className="border-r border-white/20" />
                <div />
              </div>

              {/* Overlay de procesamiento activo (Cloudinary + OpenRouter) */}
              {isRendering && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                  <div className="relative mb-4">
                    <Loader2 className="h-10 w-10 text-emerald-400 animate-spin" />
                    <Cloud className="h-4 w-4 text-emerald-300 absolute inset-0 m-auto animate-pulse" />
                  </div>

                  <p className="text-xs font-semibold text-white tracking-wide mb-1">
                    {renderPhase}
                  </p>
                  <p className="text-[11px] font-mono text-zinc-400 mb-4">
                    Tiempo transcurrido: {elapsedSeconds}s · Progreso: {renderProgress}%
                  </p>

                  <div className="w-full max-w-[200px] bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-indigo-500 h-full transition-all duration-500"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Botón flotante para cambiar imagen */}
              {!isRendering && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white text-[11px] border border-white/10 backdrop-blur-md transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Cambiar Foto</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* CASO C: DROPZONE INICIAL PARA CARGAR LA FOTO */
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handlePhotoSelect(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center p-8 text-center cursor-pointer group w-full h-full hover:bg-slate-200/50 dark:hover:bg-zinc-900/30 transition-colors"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-2xs dark:bg-white/[0.04] group-hover:bg-slate-50 dark:group-hover:bg-white/[0.08] text-slate-500 dark:text-zinc-400 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-all mb-3 border border-slate-200 dark:border-white/[0.08]">
                <Camera className="h-6 w-6" />
              </div>
              <p className="text-xs font-medium text-slate-800 dark:text-zinc-200 mb-1">
                Arrastra tu foto de avatar aquí
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 max-w-[200px]">
                Retrato nítido frontal (.jpg, .png). Rostro iluminado y mirando a cámara.
              </p>
            </div>
          )}

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

        <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950/60 p-5 space-y-5 shadow-xs">
          {/* =================================================================
              MÓDULO 1: GUION & TEXTO (Google Gemini - Cero Costos / Pool Activo)
              ================================================================= */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                <span>1. Guion de Locución (Gemini 2.5 Flash • Cero Costos)</span>
              </label>

              <button
                type="button"
                disabled={isGeneratingScript || !scriptPrompt.trim()}
                onClick={handleGenerateScriptWithAI}
                className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-300 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                <span>{isGeneratingScript ? 'Redactando con Gemini...' : 'Generar con Gemini'}</span>
              </button>
            </div>

            {/* Prompt de entrada para redactar con IA */}
            <input
              type="text"
              value={scriptPrompt}
              onChange={(e) => setScriptPrompt(e.target.value)}
              placeholder="Idea o producto (ej: Serum antiedad de vitamina C)"
              className="w-full rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/60 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 px-3.5 py-2 text-xs text-slate-900 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all"
            />

            {/* Textarea con el guion final que dirá el avatar */}
            <textarea
              rows={3}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Escribe o edita el texto exacto que el avatar dirá..."
              className="w-full rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/60 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 p-3.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all resize-none leading-relaxed"
            />

            <div className="flex justify-between text-[11px] text-slate-500 dark:text-zinc-500 font-mono">
              <span>Aprox. ~{Math.round(scriptText.split(/\s+/).filter(Boolean).length / 2.5)}s de locución</span>
              <span>{scriptText.length} caracteres</span>
            </div>
          </div>

          {/* =================================================================
              MÓDULO 2: AUDIO CONDICIONAL (ElevenLabs vs Local MP3)
              ================================================================= */}
          <div className="space-y-3 pt-3 border-t border-slate-200/80 dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                <Music className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>2. Fuente de Audio (Locución o Archivo Local)</span>
              </label>

              {/* Segmented Switch: generar vs local */}
              <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.08] text-xs">
                <button
                  type="button"
                  onClick={() => setAudioMode('generar')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                    audioMode === 'generar'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white font-medium'
                      : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                >
                  <Mic className="h-3 w-3" />
                  <span>ElevenLabs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode('local')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                    audioMode === 'local'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-white font-medium'
                      : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                >
                  <FileAudio className="h-3 w-3" />
                  <span>Audio Local MP3</span>
                </button>
              </div>
            </div>

            {/* Sub-vista Condicional: MODO GENERAR (ElevenLabs) */}
            {audioMode === 'generar' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ELEVENLABS_VOICES.map((voice) => {
                  const isSelected = selectedVoiceId === voice.id;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setSelectedVoiceId(voice.id)}
                      className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-white/[0.08] dark:border-white/30 dark:text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:bg-white/[0.02] dark:border-white/[0.06] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="text-xs font-semibold truncate w-full">{voice.name}</span>
                      <span className="text-[10px] text-slate-500 dark:text-zinc-500 truncate w-full mt-0.5">
                        {voice.style}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Sub-vista Condicional: MODO LOCAL (Subir MP3 de disco) */
              <div>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setLocalAudioFile(file);
                  }}
                />

                {localAudioFile ? (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.08]">
                    <div className="flex items-center gap-2.5 truncate">
                      <FileAudio className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 truncate">
                        {localAudioFile.name}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-500 shrink-0">
                        ({(localAudioFile.size / (1024 * 1024)).toFixed(2)} MB)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setLocalAudioFile(null)}
                      className="text-slate-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : loadedAudioName || activeProject?.audioName ? (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-emerald-500/20">
                    <div className="flex items-center gap-2.5 truncate">
                      <FileAudio className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 truncate">
                        {loadedAudioName || activeProject?.audioName}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                        Restaurado de Disco
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => audioInputRef.current?.click()}
                        className="text-[11px] text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/[0.08] transition-colors shadow-2xs"
                        title="Cambiar archivo por otro"
                      >
                        Cambiar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLoadedAudioName(null);
                          setLocalAudioFile(null);
                        }}
                        className="text-slate-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => audioInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 p-3.5 rounded-xl border border-dashed border-slate-300 dark:border-white/[0.12] hover:border-slate-400 dark:hover:border-white/30 bg-slate-50/70 hover:bg-slate-100/60 dark:bg-white/[0.01] dark:hover:bg-white/[0.03] cursor-pointer text-xs text-slate-600 dark:text-zinc-400 transition-colors"
                  >
                    <Upload className="h-4 w-4 text-slate-400 dark:text-zinc-400" />
                    <span>Seleccionar archivo .mp3 desde tu disco duro</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* =================================================================
              MÓDULO 3: BOTÓN PRINCIPAL DE RENDERIZADO (Cloudinary -> OpenRouter)
              ================================================================= */}
          <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.06]">
            <button
              type="button"
              disabled={isRendering || (!photoFile && !photoPreviewUrl)}
              onClick={handleRender}
              className="w-full relative overflow-hidden group flex items-center justify-between py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black disabled:opacity-40 font-semibold text-xs tracking-wide transition-all shadow-md shadow-slate-900/10 dark:shadow-white/5 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {isRendering ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white dark:text-black" />
                ) : (
                  <Cloud className="h-4 w-4 text-white dark:text-black" />
                )}
                <span>
                  {isRendering
                    ? renderPhase
                    : 'Renderizar con Cloudinary & OpenRouter'}
                </span>
              </div>

              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 text-white dark:bg-zinc-900 dark:text-white shadow-sm font-mono">
                heygen/avatar-iv
              </span>
            </button>
          </div>
        </div>

        {/* Guardado en disco local con metadatos estructurados completos y Recibo de Facturación */}
        <SaveProjectWidget
          category="HeyGen"
          projectData={{
            id: activeProject?.id,
            title: activeProject?.title || activeProject?.name || `TalkingPhoto_${new Date().toISOString().slice(0, 10)}`,
            script: scriptText,
            prompt: scriptPrompt,
            imageFile: photoFile,
            imageUrl: cloudinaryImageInfo?.url || (photoPreviewUrl?.startsWith('http') ? photoPreviewUrl : undefined),
            imagePath: activeProject?.imagePath,
            avatarName: photoFile ? photoFile.name : (activeProject?.avatarName || 'Retrato Personal'),
            audioMode,
            voiceId: selectedVoiceId,
            audioFile: localAudioFile,
            audioUrl: cloudinaryAudioInfo?.url || (activeProject?.audioUrl || undefined),
            audioPath: activeProject?.audioPath,
            audioName: localAudioFile ? localAudioFile.name : (loadedAudioName || activeProject?.audioName || undefined),
            ratio: aspectRatio,
            videoUrl: finalVideoUrl || undefined,
            status: finalVideoUrl ? 'rendered' : 'draft',
            finalCostUSD: finalCostUSD ?? undefined,
            videoDurationReal: videoDurationReal ?? undefined,
            estimatedCostUSD: estimatedCostUSD,
            modelUsed: 'heygen/avatar-iv',
            costPerSecondVerified: usePricingStore.getState().getRatePerSecond('heygen/avatar-iv'),
          }}
          onSaved={(savedProj) => {
            setActiveProject(savedProj);
          }}
        />
      </div>
    </div>
  </div>
  );
}
