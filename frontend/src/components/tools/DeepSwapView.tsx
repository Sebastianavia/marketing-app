'use client';

import React, { useMemo, useState } from 'react';
import { UploadZone } from '../ui/UploadZone';
import { ShimmerLoader } from '../ui/ShimmerLoader';
import { VideoPlayer } from '../ui/VideoPlayer';
import {
  SEEDANCE_MODELS,
  SEEDANCE_PROMPT_TEMPLATE,
  SEEDANCE_SIZES,
  buildSeedanceMultimodalPrompt,
} from '@/services/faceswap.service';
import type {
  CloneReplaceProfile,
  SeedanceModelId,
  SeedanceResolution,
  SeedanceSize,
} from '@/types/faceswap.types';
import {
  AlertCircle,
  AudioLines,
  Box,
  CheckCircle2,
  Clock,
  DollarSign,
  Film,
  Layers,
  Link2,
  Sparkles,
  Upload,
  UserCheck,
  Wand2,
} from 'lucide-react';

type SlotInputMode = 'upload' | 'url';

interface UploadedCloudinaryAsset {
  url: string;
  publicId: string;
  resourceType: 'image' | 'video' | 'raw';
}

function getMediaDurationSeconds(file: File, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const duration = el.duration;
      URL.revokeObjectURL(url);
      if (Number.isFinite(duration) && duration > 0) {
        resolve(duration);
      } else {
        reject(new Error('No se pudo determinar la duración del archivo.'));
      }
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer los metadatos del archivo multimedia.'));
    };
    el.src = url;
  });
}

export function DeepSwapView() {
  // 1. Selección de perfil: Seedance (activo por defecto) vs Runway (preparado/maquetado)
  const [activeProfile, setActiveProfile] = useState<CloneReplaceProfile>('seedance');

  // 2. Slots multimodales para Seedance 2.0
  // Slot 1: Video original / guía de movimiento (video_urls)
  const [videoMode, setVideoMode] = useState<SlotInputMode>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [videoDurationSec, setVideoDurationSec] = useState<number | undefined>(undefined);
  const [videoDurationError, setVideoDurationError] = useState<string | null>(null);

  // Slot 2: Referencia de rostro / personaje (image_urls[0])
  const [faceMode, setFaceMode] = useState<SlotInputMode>('upload');
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [faceUrlInput, setFaceUrlInput] = useState('');

  // Slot 3: Referencia de objeto a cambiar/sostener (image_urls[1])
  const [objectMode, setObjectMode] = useState<SlotInputMode>('upload');
  const [objectFile, setObjectFile] = useState<File | null>(null);
  const [objectUrlInput, setObjectUrlInput] = useState('');

  // Slot 4: Pista de voz / audio nuevo de referencia (audio_urls[0])
  const [audioMode, setAudioMode] = useState<SlotInputMode>('upload');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrlInput, setAudioUrlInput] = useState('');
  const [audioDurationSec, setAudioDurationSec] = useState<number | undefined>(undefined);
  const [audioDurationError, setAudioDurationError] = useState<string | null>(null);

  // Slot 5: Prompt descriptivo + sugerencia automática
  const [userPrompt, setUserPrompt] = useState('');
  const [includeAutoTemplate, setIncludeAutoTemplate] = useState(true);

  // 3. Parámetros de Seedance 2.0 (valores por defecto según especificación)
  const [model, setModel] = useState<SeedanceModelId>('seedance-2.0');
  const [size, setSize] = useState<SeedanceSize>('16:9');
  const [resolution, setResolution] = useState<SeedanceResolution>('720p');
  const [duration, setDuration] = useState<number>(5);
  const [generateAudio, setGenerateAudio] = useState<boolean>(true);
  const [nsfwCheck, setNsfwCheck] = useState<boolean>(false);

  // 4. Estado de ejecución y polling asíncrono
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitted' | 'processing' | 'completed' | 'failed'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [lastTaskMeta, setLastTaskMeta] = useState<{
    taskId: string;
    costUSD: number;
    creditsCost?: number;
    actualTimeSec?: number;
  } | null>(null);

  const selectedModelSpec = useMemo(
    () => SEEDANCE_MODELS.find((m) => m.id === model) ?? SEEDANCE_MODELS[0],
    [model]
  );

  // Si se cambia a un modelo que no soporta 1080p/4k, ajustar automáticamente a 720p (durante el render)
  if (!selectedModelSpec.resolutions.includes(resolution)) {
    setResolution('720p');
  }

  // Validar duración del archivo de video local (regla Seedance: 1.8s a 15.2s)
  const handleSelectVideoFile = async (file: File | null) => {
    setVideoFile(file);
    setVideoDurationError(null);
    setVideoDurationSec(undefined);
    if (!file) return;

    try {
      const sec = await getMediaDurationSeconds(file, 'video');
      setVideoDurationSec(sec);
      if (sec < 1.8 || sec > 15.2) {
        setVideoDurationError(
          `El video dura ${sec.toFixed(1)}s. Seedance 2.0 exige una duración acumulada entre 1.8s y 15.2s.`
        );
      }
    } catch {
      // Si el navegador no logra leer metadatos de algún contenedor, el backend validará
    }
  };

  // Validar duración del archivo de audio local (regla Seedance: <= 15s)
  const handleSelectAudioFile = async (file: File | null) => {
    setAudioFile(file);
    setAudioDurationError(null);
    setAudioDurationSec(undefined);
    if (!file) return;

    try {
      const sec = await getMediaDurationSeconds(file, 'audio');
      setAudioDurationSec(sec);
      if (sec > 15) {
        setAudioDurationError(
          `El audio dura ${sec.toFixed(1)}s. Seedance 2.0 admite hasta 15.0s como máximo.`
        );
      }
    } catch {
      // Ignorar si no hay metadatos disponibles en local
    }
  };

  const hasVideoProvided = videoMode === 'upload' ? Boolean(videoFile) : Boolean(videoUrlInput.trim());
  const hasFaceProvided = faceMode === 'upload' ? Boolean(faceFile) : Boolean(faceUrlInput.trim());
  const hasObjectProvided = objectMode === 'upload' ? Boolean(objectFile) : Boolean(objectUrlInput.trim());
  const hasAudioProvided = audioMode === 'upload' ? Boolean(audioFile) : Boolean(audioUrlInput.trim());

  const previewFinalPrompt = useMemo(() => {
    if (includeAutoTemplate) {
      return buildSeedanceMultimodalPrompt({
        userPrompt,
        hasVideoRef: hasVideoProvided,
        hasFaceRef: hasFaceProvided,
        hasObjectRef: hasObjectProvided,
        hasAudioRef: hasAudioProvided,
      });
    }
    return userPrompt.trim() || SEEDANCE_PROMPT_TEMPLATE;
  }, [includeAutoTemplate, userPrompt, hasVideoProvided, hasFaceProvided, hasObjectProvided, hasAudioProvided]);

  const estimatedCostUSD = useMemo(
    () => Math.round(duration * selectedModelSpec.costPerSecondUSD * 10000) / 10000,
    [duration, selectedModelSpec]
  );

  // Sube un archivo local a Cloudinary mediante /api/storage/cloudinary para obtener una URL HTTPS pública
  const uploadSlotFile = async (
    file: File,
    type: 'video' | 'image' | 'audio'
  ): Promise<UploadedCloudinaryAsset> => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);

    const res = await fetch('/api/storage/cloudinary', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data?.url) {
      throw new Error(
        data?.error ||
          `No se pudo subir el archivo (${file.name}) a almacenamiento temporal. Puedes usar la opción "Pegar URL" con un enlace https:// o asset://.`
      );
    }
    return {
      url: data.url,
      publicId: data.publicId,
      resourceType: data.resourceType || (type === 'image' ? 'image' : 'video'),
    };
  };

  const handleStartSeedance = async () => {
    setErrorMsg(null);
    setLastTaskMeta(null);

    if (!hasVideoProvided && !hasFaceProvided) {
      setErrorMsg('Sube o indica al menos el video guía de movimiento y la referencia de rostro/personaje.');
      return;
    }
    if (videoMode === 'upload' && videoDurationError) {
      setErrorMsg(videoDurationError);
      return;
    }
    if (audioMode === 'upload' && audioDurationError) {
      setErrorMsg(audioDurationError);
      return;
    }

    setIsProcessing(true);
    setTaskStatus('submitted');
    setProgress(10);
    setStatusMessage('Preparando y validando referencias multimodales...');

    const uploadedTempAssets: Array<{ publicId: string; resourceType: 'image' | 'video' | 'raw' }> = [];

    try {
      // 1. Resolver URL de video base (video_urls)
      let finalVideoUrl: string | undefined;
      if (videoMode === 'upload' && videoFile) {
        setStatusMessage('Subiendo video guía de movimiento (video_urls)...');
        const up = await uploadSlotFile(videoFile, 'video');
        finalVideoUrl = up.url;
        uploadedTempAssets.push({ publicId: up.publicId, resourceType: up.resourceType });
      } else if (videoMode === 'url' && videoUrlInput.trim()) {
        finalVideoUrl = videoUrlInput.trim();
      }

      // 2. Resolver URL de rostro/personaje (image_urls[0])
      let finalFaceUrl: string | undefined;
      if (faceMode === 'upload' && faceFile) {
        setProgress(18);
        setStatusMessage('Subiendo imagen de rostro / personaje (image_urls[0])...');
        const up = await uploadSlotFile(faceFile, 'image');
        finalFaceUrl = up.url;
        uploadedTempAssets.push({ publicId: up.publicId, resourceType: up.resourceType });
      } else if (faceMode === 'url' && faceUrlInput.trim()) {
        finalFaceUrl = faceUrlInput.trim();
      }

      // 3. Resolver URL de objeto opcional (image_urls[1])
      let finalObjectUrl: string | undefined;
      if (objectMode === 'upload' && objectFile) {
        setProgress(24);
        setStatusMessage('Subiendo imagen de objeto a reemplazar/sostener (image_urls[1])...');
        const up = await uploadSlotFile(objectFile, 'image');
        finalObjectUrl = up.url;
        uploadedTempAssets.push({ publicId: up.publicId, resourceType: up.resourceType });
      } else if (objectMode === 'url' && objectUrlInput.trim()) {
        finalObjectUrl = objectUrlInput.trim();
      }

      // 4. Resolver URL de pista de voz/audio opcional (audio_urls[0])
      let finalAudioUrl: string | undefined;
      if (audioMode === 'upload' && audioFile) {
        setProgress(28);
        setStatusMessage('Subiendo pista de voz / audio de referencia (audio_urls[0])...');
        const up = await uploadSlotFile(audioFile, 'audio');
        finalAudioUrl = up.url;
        uploadedTempAssets.push({ publicId: up.publicId, resourceType: up.resourceType });
      } else if (audioMode === 'url' && audioUrlInput.trim()) {
        finalAudioUrl = audioUrlInput.trim();
      }

      // 5. Despachar creación de tarea a POST /api/deepswap/seedance
      setProgress(32);
      setStatusMessage(`Enviando tarea a Apimart (${selectedModelSpec.name})...`);

      const createRes = await fetch('/api/deepswap/seedance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: finalVideoUrl ? [finalVideoUrl] : undefined,
          faceRefUrl: finalFaceUrl,
          objectRefUrl: finalObjectUrl,
          audioUrl: finalAudioUrl ? [finalAudioUrl] : undefined,
          prompt: previewFinalPrompt,
          cloudinaryAssets: uploadedTempAssets,
          options: {
            model,
            size,
            resolution,
            duration,
            generateAudio,
            nsfwCheck,
            videoDurationSec: videoMode === 'upload' ? videoDurationSec : undefined,
            audioDurationSec: audioMode === 'upload' ? audioDurationSec : undefined,
            waitForCompletion: false,
          },
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData?.error || 'Error al crear la tarea en Seedance 2.0.');
      }

      const taskId: string = createData.taskId;
      if (!taskId) {
        throw new Error('Apimart no devolvió un task_id válido.');
      }

      // Si completó de inmediato
      if (createData.status === 'completed' && createData.videoUrl) {
        setTaskStatus('completed');
        setProgress(100);
        setResultVideoUrl(createData.videoUrl);
        setLastTaskMeta({
          taskId,
          costUSD: createData.costUSD ?? estimatedCostUSD,
          creditsCost: createData.creditsCost,
          actualTimeSec: createData.actualTimeSec,
        });
        setIsProcessing(false);
        return;
      }

      // 6. Ciclo de polling asíncrono cada 4 segundos hasta 300s (5 minutos)
      setTaskStatus('processing');
      const startTime = Date.now();
      const timeoutMs = 300_000;
      const pollIntervalMs = 4_000;

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        const params = new URLSearchParams({
          taskId,
          model,
          size,
          resolution,
          duration: String(duration),
          prompt: previewFinalPrompt.slice(0, 120),
        });

        const pollRes = await fetch(`/api/deepswap/seedance?${params.toString()}`, {
          cache: 'no-store',
        });
        const pollData = await pollRes.json();

        if (!pollRes.ok) {
          throw new Error(pollData?.error || 'Error al consultar el estado de la tarea en Apimart.');
        }

        if (pollData.status === 'failed') {
          setTaskStatus('failed');
          throw new Error(
            pollData.error || 'La generación en Seedance 2.0 falló durante el renderizado.'
          );
        }

        if (pollData.status === 'completed' && pollData.videoUrl) {
          setTaskStatus('completed');
          setProgress(100);
          setStatusMessage('Clonación y reemplazo completado.');
          setResultVideoUrl(pollData.videoUrl);
          setLastTaskMeta({
            taskId,
            costUSD: pollData.costUSD ?? estimatedCostUSD,
            creditsCost: pollData.creditsCost,
            actualTimeSec: pollData.actualTimeSec,
          });
          setIsProcessing(false);
          return;
        }

        const reportedProgress =
          typeof pollData.progress === 'number' && pollData.progress > 0
            ? Math.min(96, Math.max(35, pollData.progress))
            : Math.min(92, 35 + Math.floor(((Date.now() - startTime) / timeoutMs) * 60));

        setTaskStatus(pollData.status === 'submitted' ? 'submitted' : 'processing');
        setProgress(reportedProgress);
        setStatusMessage(
          pollData.status === 'submitted'
            ? `Tarea en cola en Apimart (${taskId.slice(0, 10)}...)`
            : `Renderizando transferencia multimodal en ${selectedModelSpec.name} (${reportedProgress}%)...`
        );
      }

      throw new Error('Tiempo de espera agotado (300s) esperando a que Seedance 2.0 termine el video.');
    } catch (err) {
      setTaskStatus('failed');
      setErrorMsg(err instanceof Error ? err.message : 'Error inesperado en Clonación y Reemplazo.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector de Perfil Superior: Seedance vs Runway */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <button
          type="button"
          onClick={() => setActiveProfile('seedance')}
          className={`group relative flex items-start gap-3.5 rounded-xl border p-4 text-left transition-all ${
            activeProfile === 'seedance'
              ? 'border-fg bg-surface-2/90 shadow-sm'
              : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/40'
          }`}
        >
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              activeProfile === 'seedance'
                ? 'border-fg bg-fg text-bg'
                : 'border-line bg-surface-2 text-fg-muted'
            }`}
          >
            <Wand2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg">
                Clonación y reemplazo por Seedance
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                Activo · Seedance 2.0
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              Motor multimodal guiado por referencias: transfiere el movimiento y cámara del video base, reemplaza el personaje, el objeto en mano y sincroniza la voz.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveProfile('runway')}
          className={`group relative flex items-start gap-3.5 rounded-xl border p-4 text-left transition-all ${
            activeProfile === 'runway'
              ? 'border-fg bg-surface-2/90 shadow-sm'
              : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/40'
          }`}
        >
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              activeProfile === 'runway'
                ? 'border-fg bg-fg text-bg'
                : 'border-line bg-surface-2 text-fg-muted'
            }`}
          >
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg">
                Clonación y reemplazo por Runway
              </span>
              <span className="inline-flex items-center rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-subtle">
                Próximamente · Inpainting
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              Edición selectiva e inpainting por capas con máscaras de área para modificar fondos o elementos puntuales del clip.
            </p>
          </div>
        </button>
      </div>

      {/* Contenido según el perfil seleccionado */}
      {activeProfile === 'runway' ? (
        <div className="surface-card p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-fg-subtle">
                <Layers className="h-3.5 w-3.5" />
                <span>Motor Runway Inpainting · Edición por Capas</span>
              </div>
              <h3 className="text-base font-semibold text-fg">
                Clonación y reemplazo por capas (Runway)
              </h3>
              <p className="text-xs text-fg-muted max-w-2xl">
                Esta interfaz está maquetada y lista para conectar el flujo de máscaras e inpainting por capas de Runway. Por ahora utiliza el perfil activo de Seedance 2.0 para reemplazo multimodal de personaje, objeto y voz.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveProfile('seedance')}
              className="btn-primary h-9 px-4 text-xs"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>Usar Seedance 2.0 ahora</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 opacity-65 pointer-events-none select-none">
            <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/40 p-4 space-y-2">
              <span className="text-xs font-semibold text-fg">1. Clip de entrada</span>
              <p className="text-[12px] text-fg-subtle">
                Video fuente sobre el que se dibujará la máscara de inpainting.
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/40 p-4 space-y-2">
              <span className="text-xs font-semibold text-fg">2. Máscara / Capa objetivo</span>
              <p className="text-[12px] text-fg-subtle">
                Selección por pincel o segmentación automática del área a reemplazar.
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/40 p-4 space-y-2">
              <span className="text-xs font-semibold text-fg">3. Referencia y Prompt de capa</span>
              <p className="text-[12px] text-fg-subtle">
                Textura, objeto o sujeto a regenerar respetando la iluminación original.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Panel Izquierdo: Slots Multimodales y Configuración de Seedance 2.0 */}
          <div className="lg:col-span-6 space-y-4">
            {errorMsg && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="text-xs leading-relaxed">
                  <p className="font-semibold text-red-300">Error de validación o generación</p>
                  <p className="mt-0.5">{errorMsg}</p>
                </div>
              </div>
            )}

            <div className="surface-card p-5 sm:p-6 space-y-5">
              {/* Slot 1: Video original / guía de movimiento (video_urls) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="field-label flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5 text-fg-subtle" />
                    <span>1. Video original / guía de movimiento</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      video_urls
                    </code>
                  </label>
                  <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setVideoMode('upload')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        videoMode === 'upload' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Upload className="h-3 w-3" />
                      Archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoMode('url')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        videoMode === 'url' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Link2 className="h-3 w-3" />
                      URL / asset://
                    </button>
                  </div>
                </div>

                {videoMode === 'upload' ? (
                  <>
                    <UploadZone
                      label="Subir video guía de movimiento (MP4, MOV, WebM)"
                      sublabel="Duración requerida: 1.8s a 15.2s · Resolución recomendada: 480p a 720p"
                      accept="video/mp4,video/quicktime,video/webm"
                      maxSizeMb={50}
                      onFileSelect={handleSelectVideoFile}
                      selectedFile={videoFile}
                    />
                    {videoDurationSec !== undefined && !videoDurationError && (
                      <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Duración detectada: {videoDurationSec.toFixed(1)}s (dentro del rango 1.8s–15.2s)
                      </p>
                    )}
                    {videoDurationError && (
                      <p className="text-[11px] text-red-400">{videoDurationError}</p>
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={videoUrlInput}
                    onChange={(e) => setVideoUrlInput(e.target.value)}
                    placeholder="https://ejemplo.com/video-base.mp4 o asset://id_recurso"
                    className="input-field w-full text-xs"
                  />
                )}
              </div>

              {/* Slot 2: Referencia de rostro / personaje (image_urls[0]) */}
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="field-label flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-fg-subtle" />
                    <span>2. Referencia de rostro / personaje</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      image_urls[0]
                    </code>
                  </label>
                  <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setFaceMode('upload')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        faceMode === 'upload' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Upload className="h-3 w-3" />
                      Archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaceMode('url')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        faceMode === 'url' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Link2 className="h-3 w-3" />
                      URL / asset://
                    </button>
                  </div>
                </div>

                {faceMode === 'upload' ? (
                  <UploadZone
                    label="Subir foto del rostro o personaje a insertar (image 1)"
                    sublabel="Retrato claro y bien iluminado en JPG, PNG o WebP"
                    accept="image/jpeg,image/png,image/webp"
                    maxSizeMb={30}
                    onFileSelect={setFaceFile}
                    selectedFile={faceFile}
                  />
                ) : (
                  <input
                    type="text"
                    value={faceUrlInput}
                    onChange={(e) => setFaceUrlInput(e.target.value)}
                    placeholder="https://ejemplo.com/rostro.jpg o asset://id_rostro"
                    className="input-field w-full text-xs"
                  />
                )}
              </div>

              {/* Slot 3: Referencia de objeto a cambiar/sostener (image_urls[1]) */}
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="field-label flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5 text-fg-subtle" />
                    <span>3. Referencia de objeto a cambiar/sostener</span>
                    <span className="text-[11px] font-normal text-fg-subtle">(opcional)</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      image_urls[1]
                    </code>
                  </label>
                  <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setObjectMode('upload')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        objectMode === 'upload' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Upload className="h-3 w-3" />
                      Archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setObjectMode('url')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        objectMode === 'url' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Link2 className="h-3 w-3" />
                      URL / asset://
                    </button>
                  </div>
                </div>

                {objectMode === 'upload' ? (
                  <UploadZone
                    label="Subir foto del producto u objeto a sostener (image 2)"
                    sublabel="Producto, envase o accesorio en JPG, PNG o WebP"
                    accept="image/jpeg,image/png,image/webp"
                    maxSizeMb={30}
                    onFileSelect={setObjectFile}
                    selectedFile={objectFile}
                  />
                ) : (
                  <input
                    type="text"
                    value={objectUrlInput}
                    onChange={(e) => setObjectUrlInput(e.target.value)}
                    placeholder="https://ejemplo.com/producto.png o asset://id_objeto"
                    className="input-field w-full text-xs"
                  />
                )}
              </div>

              {/* Slot 4: Pista de voz / audio nuevo de referencia (audio_urls[0]) */}
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="field-label flex items-center gap-1.5">
                    <AudioLines className="h-3.5 w-3.5 text-fg-subtle" />
                    <span>4. Pista de voz / audio nuevo de referencia</span>
                    <span className="text-[11px] font-normal text-fg-subtle">(opcional)</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      audio_urls[0]
                    </code>
                  </label>
                  <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setAudioMode('upload')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        audioMode === 'upload' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Upload className="h-3 w-3" />
                      Archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setAudioMode('url')}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                        audioMode === 'url' ? 'bg-surface text-fg font-medium' : 'text-fg-subtle'
                      }`}
                    >
                      <Link2 className="h-3 w-3" />
                      URL / asset://
                    </button>
                  </div>
                </div>

                {audioMode === 'upload' ? (
                  <>
                    <UploadZone
                      label="Subir locución o pista de voz para sincronización labial (audio 1)"
                      sublabel="MP3 o WAV · Duración máxima acumulada: 15 segundos"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
                      maxSizeMb={15}
                      onFileSelect={handleSelectAudioFile}
                      selectedFile={audioFile}
                    />
                    {audioDurationSec !== undefined && !audioDurationError && (
                      <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Duración de audio: {audioDurationSec.toFixed(1)}s (máx. 15s)
                      </p>
                    )}
                    {audioDurationError && (
                      <p className="text-[11px] text-red-400">{audioDurationError}</p>
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={audioUrlInput}
                    onChange={(e) => setAudioUrlInput(e.target.value)}
                    placeholder="https://ejemplo.com/locucion.mp3 o asset://id_audio"
                    className="input-field w-full text-xs"
                  />
                )}
              </div>

              {/* Slot 5: Prompt Descriptivo con Sugerencia Automática */}
              <div className="space-y-2.5 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="field-label">
                    5. Prompt descriptivo y mapeo multimodal
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAutoTemplate}
                      onChange={(e) => setIncludeAutoTemplate(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-line-strong bg-surface text-fg focus:ring-0"
                    />
                    <span>Incluir plantilla multimodal automática</span>
                  </label>
                </div>

                <textarea
                  rows={3}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="Detalles adicionales opcionales (ej. mantener iluminación cálida de estudio, expresión sonriente natural, enfoque nítido en el envase)..."
                  className="input-field w-full text-xs leading-relaxed resize-y"
                />

                <div className="rounded-lg border border-line bg-surface-2/60 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-fg-subtle">
                      Prompt final que se enviará a Seedance 2.0:
                    </span>
                    <button
                      type="button"
                      onClick={() => setUserPrompt(SEEDANCE_PROMPT_TEMPLATE)}
                      className="text-[11px] text-fg hover:underline"
                    >
                      Editar plantilla manualmente
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-muted font-mono break-words">
                    {previewFinalPrompt}
                  </p>
                </div>
              </div>

              {/* Configuración de la API Seedance 2.0 */}
              <div className="space-y-3 border-t border-line pt-4">
                <label className="field-label">
                  Configuración del motor Seedance 2.0
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Selector de Modelo */}
                  <div>
                    <label className="block text-[11px] text-fg-subtle mb-1">
                      Modelo Seedance
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value as SeedanceModelId)}
                      className="input-field w-full text-xs"
                    >
                      {SEEDANCE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} (${m.costPerSecondUSD}/s)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Relación de Aspecto (size: 16:9 por defecto) */}
                  <div>
                    <label className="block text-[11px] text-fg-subtle mb-1">
                      Relación de aspecto (size)
                    </label>
                    <select
                      value={size}
                      onChange={(e) => setSize(e.target.value as SeedanceSize)}
                      className="input-field w-full text-xs"
                    >
                      {SEEDANCE_SIZES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Resolución (720p por defecto) */}
                  <div>
                    <label className="block text-[11px] text-fg-subtle mb-1">
                      Resolución de salida
                    </label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as SeedanceResolution)}
                      className="input-field w-full text-xs"
                    >
                      {(['480p', '720p', '1080p', '4k'] as SeedanceResolution[]).map((res) => {
                        const supported = selectedModelSpec.resolutions.includes(res);
                        return (
                          <option key={res} value={res} disabled={!supported}>
                            {res === '720p' ? '720p (Predeterminado)' : res.toUpperCase()}
                            {!supported ? ' — Solo en seedance-2.0' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Duración (4 a 15s, por defecto 5s) */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-fg-subtle mb-1">
                      <span>Duración de salida</span>
                      <span className="font-semibold text-fg tabular-nums">{duration} segundos</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={15}
                      step={1}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="w-full accent-fg cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-fg-subtle">
                      <span>4s</span>
                      <span>5s (def.)</span>
                      <span>10s</span>
                      <span>15s</span>
                    </div>
                  </div>
                </div>

                {/* Opciones booleanas: generate_audio (true por defecto) y nsfw_check (false por defecto) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-line bg-surface-2 cursor-pointer hover:border-line-strong transition-colors">
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(e) => setGenerateAudio(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-line-strong bg-surface text-fg focus:ring-0"
                    />
                    <span className="text-xs text-fg-muted">
                      Generar / sincronizar audio (<code className="text-[10px]">generate_audio</code>)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-line bg-surface-2 cursor-pointer hover:border-line-strong transition-colors">
                    <input
                      type="checkbox"
                      checked={nsfwCheck}
                      onChange={(e) => setNsfwCheck(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-line-strong bg-surface text-fg focus:ring-0"
                    />
                    <span className="text-xs text-fg-muted">
                      Filtro NSFW estricto (<code className="text-[10px]">nsfw_check</code>)
                    </span>
                  </label>
                </div>
              </div>

              {/* Resumen transparente de costos y botón de acción */}
              <div className="rounded-xl border border-line bg-surface-2/50 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-fg-muted">
                  <DollarSign className="h-4 w-4 text-fg-subtle" />
                  <span>
                    Costo estimado ({selectedModelSpec.name} · {duration}s):
                  </span>
                </div>
                <span className="font-semibold text-fg tabular-nums">
                  ${estimatedCostUSD.toFixed(4)} USD
                </span>
              </div>

              <button
                type="button"
                disabled={isProcessing || (!hasVideoProvided && !hasFaceProvided)}
                onClick={handleStartSeedance}
                className="btn-primary w-full h-11 text-sm"
              >
                <Sparkles className="h-4 w-4" />
                <span>
                  {isProcessing
                    ? 'Procesando en Seedance 2.0…'
                    : 'Ejecutar clonación y reemplazo con Seedance'}
                </span>
              </button>
            </div>
          </div>

          {/* Panel Derecho: Estado de Polling y Reproductor de Resultado */}
          <div className="lg:col-span-6 lg:sticky lg:top-6 space-y-4">
            <div className="h-[min(680px,calc(100dvh-9rem))] min-h-[460px]">
              {isProcessing ? (
                <ShimmerLoader
                  progress={progress}
                  currentPhase={statusMessage || 'Procesando video en Seedance 2.0…'}
                  subtext={`Estado: ${taskStatus.toUpperCase()} · Consultando GET /v1/tasks/{task_id} cada 4s`}
                />
              ) : (
                <VideoPlayer
                  videoUrl={resultVideoUrl || undefined}
                  title="Resultado Seedance 2.0"
                />
              )}
            </div>

            {lastTaskMeta && (
              <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-fg-muted">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>
                    Tarea <code className="text-[11px] text-fg">{lastTaskMeta.taskId}</code> guardada en{' '}
                    <strong className="text-fg">Generados</strong> y{' '}
                    <strong className="text-fg">Proyectos → Clonación y reemplazo</strong>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-fg-subtle tabular-nums">
                  {typeof lastTaskMeta.actualTimeSec === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {lastTaskMeta.actualTimeSec}s
                    </span>
                  )}
                  <span className="font-medium text-fg">
                    Costo: ${lastTaskMeta.costUSD.toFixed(4)} USD
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
