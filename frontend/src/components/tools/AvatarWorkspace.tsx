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
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  KeyRound,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { useProjectHydration } from '@/store/useProjectHydrationStore';
import { SaveProjectWidget } from '../storage/SaveProjectWidget';
import { usePricingStore } from '@/store/usePricingStore';
import { useCloudinaryStore } from '@/store/useCloudinaryStore';
import { extractVideoDurationSeconds } from '@/lib/video/video-metadata';

export interface VoiceOption {
  id: string;
  name: string;
  style: string;
  category?: 'configured' | 'cloned' | 'premade';
  isDefault?: boolean;
}

const DEFAULT_ELEVENLABS_VOICES: VoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'Conversacional / Calma', category: 'premade' },
  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', style: 'Publicitario / Enérgico', category: 'premade' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', style: 'Narrativa / Juvenil', category: 'premade' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'Comercial / Cercana', category: 'premade' },
];

export interface ElevenLabsModelOption {
  id: string;
  name: string;
  badge?: string;
  description: string;
  speed: string;
}

const ELEVENLABS_MODELS: ElevenLabsModelOption[] = [
  {
    id: 'eleven_v4',
    name: 'Eleven v4',
    badge: 'Nuevo • Hyper-Speed',
    description: 'Mayor velocidad de síntesis, menor latencia y alta expresividad emocional.',
    speed: '⚡ 2x Más Rápido',
  },
  {
    id: 'eleven_multilingual_v2',
    name: 'Multilingual v2',
    badge: 'Estándar Consistente',
    description: 'El modelo estándar para máxima neutralidad y consistencia en español e inglés.',
    speed: '🎯 Precisión Alta',
  },
];

export interface VoiceSettingsState {
  stability: number; // 0.0 a 1.0 (default: 0.50)
  similarityBoost: number; // 0.0 a 1.0 (default: 0.75)
  style: number; // 0.0 a 1.0 (default: 0.00)
  speed: number; // 0.70 a 1.25 (default: 1.00)
}

const DEFAULT_VOICE_SETTINGS: VoiceSettingsState = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
};

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
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(DEFAULT_ELEVENLABS_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState(DEFAULT_ELEVENLABS_VOICES[0].id);
  const [selectedModelId, setSelectedModelId] = useState<string>('eleven_v4');
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsState>(DEFAULT_VOICE_SETTINGS);
  const [isElevenLabsConfigured, setIsElevenLabsConfigured] = useState<boolean>(true);
  const [localAudioFile, setLocalAudioFile] = useState<File | null>(null);
  const [loadedAudioName, setLoadedAudioName] = useState<string | null>(null);

  // Voz activa actualmente seleccionada
  const selectedVoice = availableVoices.find((v) => v.id === selectedVoiceId) || availableVoices[0];

  // Estado para inyección manual y forzado de Voice ID explícito
  const [customVoiceId, setCustomVoiceId] = useState<string>('');
  const [useCustomVoiceId, setUseCustomVoiceId] = useState<boolean>(false);

  // Hidratación desde localStorage para persistencia del ID personalizado
  useEffect(() => {
    try {
      const savedCustomId = localStorage.getItem('elevenlabs_custom_voice_id');
      if (savedCustomId) {
        setCustomVoiceId(savedCustomId);
      }
      const savedUseCustom = localStorage.getItem('elevenlabs_use_custom_voice_id');
      if (savedUseCustom === 'true') {
        setUseCustomVoiceId(true);
      }
    } catch (e) {
      console.warn('[AvatarWorkspace] Error leyendo custom_voice_id de localStorage:', e);
    }
  }, []);

  const handleCustomVoiceIdChange = (id: string) => {
    setCustomVoiceId(id);
    try {
      localStorage.setItem('elevenlabs_custom_voice_id', id);
    } catch (e) {}
  };

  const handleToggleCustomVoiceId = (enabled: boolean) => {
    setUseCustomVoiceId(enabled);
    try {
      localStorage.setItem('elevenlabs_use_custom_voice_id', String(enabled));
    } catch (e) {}
  };

  // Voice ID efectivo: Si el usuario introdujo un ID manual activo, tiene prioridad máxima
  const isForcingManualVoice = useCustomVoiceId && customVoiceId.trim().length > 0;
  const effectiveVoiceId = isForcingManualVoice ? customVoiceId.trim() : selectedVoiceId;

  // Estados de sincronización y eliminación de voces de ElevenLabs
  const [isSyncingVoices, setIsSyncingVoices] = useState(false);
  const [voiceToDelete, setVoiceToDelete] = useState<VoiceOption | null>(null);
  const [isDeletingVoice, setIsDeletingVoice] = useState(false);
  const [voiceSuccessMsg, setVoiceSuccessMsg] = useState<string | null>(null);

  // Cargar y sincronizar dinámicamente voces de ElevenLabs en tiempo real (purgando registros fantasma)
  const fetchVoices = async (showSyncIndicator = false) => {
    if (showSyncIndicator) setIsSyncingVoices(true);
    try {
      const res = await fetch(`/api/elevenlabs/voices?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const data = await res.json();
      if (Array.isArray(data?.voices) && data.voices.length > 0) {
        setAvailableVoices(data.voices);
        // Validar si la voz actualmente seleccionada sigue existiendo tras la sincronización
        setSelectedVoiceId((prevId) => {
          const exists = data.voices.some((v: VoiceOption) => v.id === prevId);
          if (exists) return prevId;
          return data.configuredVoiceId || data.voices[0]?.id;
        });
      }
      if (typeof data?.isConfigured === 'boolean') {
        setIsElevenLabsConfigured(data.isConfigured);
      }
      if (showSyncIndicator) {
        setVoiceSuccessMsg('Sincronización en tiempo real completada: voces actualizadas y registros fantasma purgados.');
        setTimeout(() => setVoiceSuccessMsg(null), 3500);
      }
    } catch (err) {
      console.warn('[AvatarWorkspace] No se pudieron sincronizar las voces de ElevenLabs:', err);
    } finally {
      if (showSyncIndicator) setIsSyncingVoices(false);
    }
  };

  useEffect(() => {
    fetchVoices();
  }, []);

  const handleDeleteVoice = async () => {
    if (!voiceToDelete) return;
    setIsDeletingVoice(true);
    try {
      const res = await fetch(`/api/elevenlabs/voices/${voiceToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fallo al eliminar la voz.');
      }

      setVoiceSuccessMsg(`Voz "${voiceToDelete.name}" eliminada de ElevenLabs y almacenamiento local.`);
      setTimeout(() => setVoiceSuccessMsg(null), 4000);
      const deletedId = voiceToDelete.id;
      setVoiceToDelete(null);

      // Si la voz borrada era la que estaba seleccionada, cambiar selección
      if (selectedVoiceId === deletedId) {
        const remaining = availableVoices.filter((v) => v.id !== deletedId);
        if (remaining.length > 0) {
          setSelectedVoiceId(remaining[0].id);
        }
      }

      await fetchVoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al eliminar la voz.');
    } finally {
      setIsDeletingVoice(false);
    }
  };

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

  // Invalida el caché de Cloudinary para audio si el usuario cambia el guion, la voz, el modelo, parámetros de síntesis, ID manual o el archivo local
  useEffect(() => {
    setCloudinaryAudioInfo(null);
  }, [
    scriptText,
    selectedVoiceId,
    selectedModelId,
    audioMode,
    localAudioFile,
    voiceSettings,
    customVoiceId,
    useCustomVoiceId,
  ]);

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
        // Refrescar contador en tiempo real tras la subida
        useCloudinaryStore.getState().fetchCount();
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
              voiceId: effectiveVoiceId,
              language: 'es',
              modelId: selectedModelId,
              voiceSettings: {
                stability: voiceSettings.stability,
                similarity_boost: voiceSettings.similarityBoost,
                style: voiceSettings.style,
                speed: voiceSettings.speed,
              },
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
      // Holgura extendida a 10 minutos (600,000 ms) para videos pesados o de alta duración
      const TIMEOUT_MS = 600000;
      let completedWithoutUrlCount = 0;

      while (!completed) {
        await new Promise((resolve) => setTimeout(resolve, 3500));

        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const elapsedMin = Math.floor(elapsedSec / 60);
        const secRemainder = elapsedSec % 60;
        const timeFormatted = elapsedMin > 0 ? `${elapsedMin}m ${secRemainder}s` : `${secRemainder}s`;

        if (Date.now() - startTime > TIMEOUT_MS) {
          clearInterval(timer);
          setIsRendering(false);
          throw new Error(
            `Tiempo de espera agotado (${Math.round(TIMEOUT_MS / 60000)} min). El procesamiento en la nube está tomando más tiempo del habitual. Puedes pulsar en "Reintentar".`
          );
        }

        const pollRes = await fetch(`/api/openrouter/videos/status/${taskId}`);
        if (!pollRes.ok) {
          console.warn('[Polling] Advertencia temporal de red consultando OpenRouter.');
          continue;
        }

        const pollData = await pollRes.json();
        console.log('[Polling check]:', JSON.stringify(pollData, null, 2));

        const status = (pollData.status || pollData.state || pollData.rawStatus || '').toLowerCase();

        // ---------------------------------------------------------------------
        // Extracción exhaustiva de la URL del video resultante:
        // Prioridad 1: Captura de la primera URL válida en unsigned_urls de OpenRouter
        // ---------------------------------------------------------------------
        const unsignedList: any[] =
          (Array.isArray(pollData.unsigned_urls) && pollData.unsigned_urls) ||
          (Array.isArray(pollData.unsignedUrls) && pollData.unsignedUrls) ||
          (Array.isArray(pollData.data?.unsigned_urls) && pollData.data.unsigned_urls) ||
          (Array.isArray(pollData.output?.unsigned_urls) && pollData.output.unsigned_urls) ||
          [];

        const firstUnsignedUrl =
          unsignedList.find((item) => typeof item === 'string' && item.trim().startsWith('http'))?.trim() || null;

        // Prioridad 2: Propiedades directas de URL
        const videoUrl: string | null =
          firstUnsignedUrl ||
          (typeof pollData.videoUrl === 'string' && pollData.videoUrl.startsWith('http') ? pollData.videoUrl : null) ||
          (typeof pollData.video_url === 'string' && pollData.video_url.startsWith('http') ? pollData.video_url : null) ||
          (typeof pollData.url === 'string' && pollData.url.startsWith('http') ? pollData.url : null) ||
          (typeof pollData.output_url === 'string' && pollData.output_url.startsWith('http') ? pollData.output_url : null) ||
          (typeof pollData.result_url === 'string' && pollData.result_url.startsWith('http') ? pollData.result_url : null) ||
          (typeof pollData.output === 'string' && pollData.output.startsWith('http') ? pollData.output : null) ||
          (typeof pollData.result?.url === 'string' && pollData.result.url.startsWith('http') ? pollData.result.url : null) ||
          (typeof pollData.output?.video_url === 'string' && pollData.output.video_url.startsWith('http') ? pollData.output.video_url : null) ||
          null;

        const isFinished =
          ['completed', 'succeeded', 'success', 'done'].includes(status) || Boolean(videoUrl);

        // Resolución Exitosa Inmediata
        if (isFinished && videoUrl) {
          completed = true;
          clearInterval(timer);

          setRenderPhase('Extrayendo duración real y procesando recibo...');
          setRenderProgress(98);

          // 2. Extracción de Duración Real del MP4 vía metadatos
          let realDuration = 10;
          try {
            realDuration = await extractVideoDurationSeconds(videoUrl);
          } catch (metaErr) {
            console.warn('[Metadata] No se pudo extraer duración vía metadatos, usando fallback:', metaErr);
          }
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

        // Si el estado es "completed" pero la URL aún no está en unsigned_urls, esperar hasta 4 sondeos de gracia
        if (['completed', 'succeeded', 'success', 'done'].includes(status) && !videoUrl) {
          completedWithoutUrlCount += 1;
          if (completedWithoutUrlCount > 4) {
            clearInterval(timer);
            setIsRendering(false);
            throw new Error(
              'OpenRouter marcó el renderizado como completado pero aún no generó la URL de descarga. Por favor reintenta.'
            );
          }
        }

        // Manejo de Errores del Proveedor (failed, error, canceled)
        if (['failed', 'error', 'canceled'].includes(status)) {
          clearInterval(timer);
          setIsRendering(false);
          const providerError =
            pollData.error?.message ||
            pollData.error ||
            `El renderizado fue rechazado por el proveedor (${status}).`;
          throw new Error(`${providerError} Puedes reintentar la operación.`);
        }

        // Actualizar mensaje de progreso con tiempo transcurrido
        setRenderPhase(`Generando video con lip-sync en OpenRouter (${timeFormatted})...`);
        // Incrementar barra suavemente entre 70% y 95%
        setRenderProgress((prev) => Math.min(prev + 2, 95));
      }
    } catch (err: any) {
      console.error('[Render Error]:', err);
      if (err instanceof CloudinaryUploadError) {
        showToast('Error al subir archivos multimedia');
        setErrorMsg(`Error al subir archivos a Cloudinary: ${err.message}. Verifica tu conexión y vuelve a intentar.`);
      } else {
        setErrorMsg(err.message || 'Error durante el proceso de renderizado. Por favor reintenta la operación.');
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
          <button type="button" onClick={() => setToast(null)} className="ml-2 text-fg-subtle hover:text-white">✕</button>
        </div>
      )}
      {/* 1. Banner de Proyecto Hidratado desde Disco */}
      {activeProject && (
        <div className="rounded-xl border border-line bg-surface-2 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs tabular-nums text-fg-subtle">
              Proyecto Activo en Disco:
            </span>
            <span className="text-xs font-semibold text-fg">
              {activeProject.title || activeProject.name}
            </span>
            <span className="text-[10px] tabular-nums text-fg-subtle bg-surface-2/60 border border-line-strong px-2 py-0.5 rounded">
              /{activeProject.category}/{activeProject.name}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenProjectFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line bg-surface text-fg-muted hover:text-fg text-xs tabular-nums transition-colors shadow-2xs"
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line bg-surface text-fg-subtle hover:text-rose-500 text-xs tabular-nums transition-colors shadow-2xs"
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
              <p className="text-[11px] text-fg-muted tabular-nums pt-0.5">
                ✓ El texto de tu guion y la configuración se han mantenido intactos en el editor.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearWarnings}
            className="text-fg-muted hover:text-fg text-xs px-2.5 py-1 rounded bg-surface-2/80 hover:bg-surface-2 shrink-0 transition-colors"
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
            <Camera className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-fg">
              Lienzo de Producción (Stage)
            </span>
          </div>

          {/* Selector de relación de aspecto del lienzo */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-line text-xs">
            <button
              type="button"
              onClick={() => setAspectRatio('9:16')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                aspectRatio === '9:16'
                  ? 'bg-surface text-fg shadow-xs font-medium'
                  : 'text-fg-subtle hover:text-fg'
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
                  ? 'bg-surface text-fg shadow-xs font-medium'
                  : 'text-fg-subtle hover:text-fg'
              }`}
            >
              <Monitor className="h-3 w-3" />
              <span>16:9</span>
            </button>
          </div>
        </div>

        {/* CONTENEDOR PRINCIPAL DEL CANVAS */}
        <div
          className={`relative mx-auto rounded-2xl border border-line bg-surface-2 overflow-hidden shadow-xl transition-all duration-300 flex items-center justify-center ${
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
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md border text-[11px] tabular-nums shadow-lg ${
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
                  <p className="text-[11px] tabular-nums text-fg-muted mb-4">
                    Tiempo transcurrido: {elapsedSeconds}s · Progreso: {renderProgress}%
                  </p>

                  <div className="w-full max-w-[200px] bg-surface-2 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-accent h-full transition-all duration-500"
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
              className="flex flex-col items-center justify-center p-8 text-center cursor-pointer group w-full h-full hover:bg-surface-2/50 transition-colors"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface shadow-2xs group-hover:bg-surface-2 text-fg-subtle group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-all mb-3 border border-line">
                <Camera className="h-6 w-6" />
              </div>
              <p className="text-xs font-medium text-fg mb-1">
                Arrastra tu foto de avatar aquí
              </p>
              <p className="text-[11px] text-fg-subtle max-w-[200px]">
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
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={handleRender}
              disabled={isRendering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-[11px] transition-colors shrink-0 shadow-xs cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reintentar</span>
            </button>
          </div>
        )}

        {/* Banner informativo de sincronización o borrado de voces */}
        {voiceSuccessMsg && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span>{voiceSuccessMsg}</span>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface p-5 space-y-5 shadow-xs">
          {/* =================================================================
              MÓDULO 1: GUION & TEXTO (Google Gemini - Cero Costos / Pool Activo)
              ================================================================= */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-fg-muted flex items-center gap-1.5">
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
              className="w-full rounded-xl bg-surface-2 hover:bg-surface-2/60 border border-line focus:border-accent/60 focus:ring-1 focus:ring-accent/40 px-3.5 py-2 text-xs text-fg placeholder:text-fg-subtle outline-none transition-all"
            />

            {/* Textarea con el guion final que dirá el avatar */}
            <textarea
              rows={3}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Escribe o edita el texto exacto que el avatar dirá..."
              className="w-full rounded-xl bg-surface-2 hover:bg-surface-2/60 border border-line focus:border-accent/60 focus:ring-1 focus:ring-accent/40 p-3.5 text-xs text-fg placeholder:text-fg-subtle outline-none transition-all resize-none leading-relaxed"
            />

            <div className="flex justify-between text-[11px] text-fg-subtle tabular-nums">
              <span>Aprox. ~{Math.round(scriptText.split(/\s+/).filter(Boolean).length / 2.5)}s de locución</span>
              <span>{scriptText.length} caracteres</span>
            </div>
          </div>

          {/* =================================================================
              MÓDULO 2: AUDIO CONDICIONAL (ElevenLabs vs Local MP3)
              ================================================================= */}
          <div className="space-y-3 pt-3 border-t border-line">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-fg-muted flex items-center gap-1.5">
                  <Music className="h-3.5 w-3.5 text-accent" />
                  <span>2. Fuente de Audio (Locución o Archivo Local)</span>
                </label>
                {audioMode === 'generar' && (
                  <button
                    type="button"
                    onClick={() => fetchVoices(true)}
                    disabled={isSyncingVoices}
                    title="Sincronizar directamente con ElevenLabs y purgar registros fantasma"
                    className="flex items-center gap-1 text-[10px] tabular-nums px-2 py-0.5 rounded-lg border border-line bg-surface-2 hover:bg-surface-2 text-fg-muted hover:text-accent transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`h-2.5 w-2.5 ${isSyncingVoices ? 'animate-spin text-accent' : ''}`} />
                    <span>{isSyncingVoices ? 'Sincronizando...' : 'Sincronizar'}</span>
                  </button>
                )}
              </div>

              {/* Segmented Switch: generar vs local */}
              <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-line text-xs">
                <button
                  type="button"
                  onClick={() => setAudioMode('generar')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                    audioMode === 'generar'
                      ? 'bg-surface text-fg shadow-xs font-medium'
                      : 'text-fg-subtle hover:text-fg'
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
                      ? 'bg-surface text-fg shadow-xs font-medium'
                      : 'text-fg-subtle hover:text-fg'
                  }`}
                >
                  <FileAudio className="h-3 w-3" />
                  <span>Audio Local MP3</span>
                </button>
              </div>
            </div>

            {/* Sub-vista Condicional: MODO GENERAR (ElevenLabs) */}
            {audioMode === 'generar' ? (
              <div className="space-y-2.5">
                {/* 1. Selector Minimalista de Voces (Menú Desplegable o ID Manual) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-fg-muted flex items-center gap-1.5">
                      <Mic className="h-3 w-3 text-accent" />
                      <span>Voz de Locución:</span>
                    </span>

                    {/* Botón para alternar / usar ID personalizado */}
                    <button
                      type="button"
                      onClick={() => handleToggleCustomVoiceId(!useCustomVoiceId)}
                      className={`flex items-center gap-1 text-[10px] tabular-nums px-2 py-0.5 rounded-lg border transition-all cursor-pointer ${
                        useCustomVoiceId
                          ? 'bg-accent border-accent text-accent font-semibold shadow-2xs'
                          : 'border-line bg-surface-2 hover:bg-surface-2 text-fg-muted hover:text-accent'
                      }`}
                      title="Forzar un Voice ID específico sin depender de la lista desplegable"
                    >
                      <KeyRound className="h-2.5 w-2.5 text-accent" />
                      <span>{useCustomVoiceId ? '✓ ID Manual Activo' : 'Usar ID Personalizado'}</span>
                    </button>
                  </div>

                  {useCustomVoiceId ? (
                    /* Inyección Manual de Voice ID */
                    <div className="space-y-2 p-2.5 rounded-xl bg-accent/60 border border-accent/80 animate-in fade-in">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={customVoiceId}
                            onChange={(e) => handleCustomVoiceIdChange(e.target.value)}
                            placeholder="Introduce tu voice_id explícito (ej: oio1IiuJQR7FuDyK6NYDno)..."
                            className="w-full rounded-lg bg-surface border border-accent/80 focus:border-accent focus:ring-1 focus:ring-accent/40 px-3 py-1.5 text-xs tabular-nums text-fg placeholder:text-fg-subtle outline-none transition-all"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleCustomVoiceId(false)}
                          className="px-2.5 py-1.5 rounded-lg border border-line bg-surface text-[11px] tabular-nums text-fg-subtle hover:text-fg transition-colors cursor-pointer shrink-0"
                          title="Volver a seleccionar desde el menú desplegable"
                        >
                          Usar Menú
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[10px] tabular-nums text-accent px-0.5">
                        <span>⚡ Prioridad Alta: Este Voice ID forzará la síntesis ignorando el desplegable.</span>
                        {customVoiceId.trim() && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Guardado localmente ✓</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Selector Desplegable Estándar */
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={selectedVoiceId}
                          onChange={(e) => setSelectedVoiceId(e.target.value)}
                          className="w-full appearance-none rounded-xl bg-surface-2 hover:bg-surface-2/80 border border-line focus:border-accent/60 focus:ring-1 focus:ring-accent/40 pl-3 pr-8 py-2 text-xs font-medium text-fg outline-none transition-all cursor-pointer"
                        >
                          {availableVoices.map((voice) => {
                            const isCloned = voice.category === 'configured' || voice.category === 'cloned';
                            return (
                              <option
                                key={voice.id}
                                value={voice.id}
                                className="bg-surface text-fg py-1"
                              >
                                {isCloned ? `⭐ ${voice.name} (Clonada)` : voice.name}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none" />
                      </div>

                      {/* Botón de borrado si la voz activa es clonada */}
                      {selectedVoice && (selectedVoice.category === 'cloned' || selectedVoice.category === 'configured') && (
                        <button
                          type="button"
                          title="Eliminar esta voz clonada de ElevenLabs y almacenamiento local"
                          onClick={() => setVoiceToDelete(selectedVoice)}
                          className="p-2 rounded-xl border border-line bg-surface-2 hover:bg-rose-500/10 hover:border-rose-500/30 dark:hover:bg-rose-500/20 text-fg-subtle hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {/* Botón Sincronizar en tiempo real */}
                      <button
                        type="button"
                        onClick={() => fetchVoices(true)}
                        disabled={isSyncingVoices}
                        title="Sincronizar en tiempo real con ElevenLabs y purgar registros fantasma"
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-line bg-surface-2 hover:bg-surface-2 text-fg-muted hover:text-accent transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncingVoices ? 'animate-spin text-accent' : ''}`} />
                        <span className="hidden sm:inline">{isSyncingVoices ? 'Sincronizando...' : 'Sincronizar'}</span>
                      </button>
                    </div>
                  )}

                  {/* Subtítulo informativo */}
                  <div className="flex items-center justify-between text-[11px] text-fg-subtle px-1">
                    {useCustomVoiceId && customVoiceId.trim() ? (
                      <span className="tabular-nums text-accent">
                        Voice ID Forzado: {customVoiceId.trim()}
                      </span>
                    ) : selectedVoice ? (
                      <span className="truncate">{selectedVoice.style}</span>
                    ) : null}

                    {useCustomVoiceId && customVoiceId.trim() ? (
                      <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:bg-amber-400/20 dark:text-amber-300 font-medium">
                        Prioridad Manual Activa
                      </span>
                    ) : selectedVoice && (selectedVoice.category === 'configured' || selectedVoice.category === 'cloned') ? (
                      <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium shrink-0 ml-2">
                        {selectedVoice.category === 'configured' ? '⭐ Voz Oficial' : '⭐ Clonada'}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Selector de Modelos de Síntesis Vocal (eleven_v4 vs eleven_multilingual_v2) */}
                <div className="space-y-1.5 pt-2 border-t border-line">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-fg-muted flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-accent" />
                      <span>Motor de Síntesis Vocal (Model):</span>
                    </span>
                    <span className="text-[10px] tabular-nums text-fg-subtle">
                      {selectedModelId === 'eleven_v4' ? '⚡ eleven_v4 activo' : '🎯 eleven_multilingual_v2 activo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ELEVENLABS_MODELS.map((model) => {
                      const isSelected = selectedModelId === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => setSelectedModelId(model.id)}
                          className={`flex items-start justify-between p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-accent/70 border-accent text-fg shadow-xs ring-1 ring-accent/40'
                              : 'bg-surface-2 border-line text-fg-muted hover:text-fg hover:bg-surface-2'
                          }`}
                        >
                          <div className="space-y-0.5 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold">{model.name}</span>
                              <span
                                className={`text-[9px] tabular-nums px-1.5 py-0.5 rounded font-medium ${
                                  model.id === 'eleven_v4'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300 border border-emerald-500/20'
                                    : 'bg-accent/10 text-accent border border-accent/20'
                                }`}
                              >
                                {model.badge}
                              </span>
                            </div>
                            <p className="text-[10px] text-fg-subtle leading-tight">
                              {model.description}
                            </p>
                          </div>
                          <span className="text-[10px] tabular-nums text-fg-subtle shrink-0 self-center">
                            {model.speed}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Controles de Audio Alineados al Modelo (Sliders ElevenLabs) */}
                <div className="space-y-2 pt-2 border-t border-line">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3 w-3 text-accent" />
                      <span className="text-[11px] font-semibold text-fg">
                        {selectedModelId === 'eleven_v4'
                          ? 'Parámetros Optimizados (eleven_v4)'
                          : 'Parámetros de Síntesis (ElevenLabs)'}
                      </span>
                      {selectedModelId === 'eleven_v4' && (
                        <span className="text-[9px] tabular-nums px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300 border border-emerald-500/20">
                          Estructura Simplificada
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceSettings(DEFAULT_VOICE_SETTINGS)}
                      className="text-[10px] tabular-nums text-accent hover:underline cursor-pointer"
                      title="Restablecer valores predeterminados de ElevenLabs"
                    >
                      Restablecer
                    </button>
                  </div>

                  <div className={`grid gap-2.5 p-3 rounded-xl bg-surface-2/70 border border-line ${
                    selectedModelId === 'eleven_v4' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
                  }`}>
                    {/* Estabilidad: Creativo a Robusto */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-fg-muted">
                          Estabilidad (stability)
                        </label>
                        <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-accent/10 text-accent font-semibold">
                          {Math.round(voiceSettings.stability * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={voiceSettings.stability}
                        onChange={(e) => setVoiceSettings((prev) => ({ ...prev, stability: parseFloat(e.target.value) }))}
                        className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-400"
                      />
                      <div className="flex justify-between text-[9px] text-fg-subtle tabular-nums">
                        <span>Creativo (0.0)</span>
                        <span>Robusto (1.0)</span>
                      </div>
                    </div>

                    {/* Similitud: Baja a Alta */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-fg-muted">
                          Similitud (similarity_boost)
                        </label>
                        <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-accent/10 text-accent font-semibold">
                          {Math.round(voiceSettings.similarityBoost * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={voiceSettings.similarityBoost}
                        onChange={(e) => setVoiceSettings((prev) => ({ ...prev, similarityBoost: parseFloat(e.target.value) }))}
                        className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-400"
                      />
                      <div className="flex justify-between text-[9px] text-fg-subtle tabular-nums">
                        <span>Baja (0.0)</span>
                        <span>Alta (1.0)</span>
                      </div>
                    </div>

                    {/* Exageración de estilo (solo visible en modelos compatibles como Multilingual v2) */}
                    {selectedModelId !== 'eleven_v4' && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-medium text-fg-muted">
                            Exageración de estilo (style)
                          </label>
                          <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-accent/10 text-accent font-semibold">
                            {Math.round(voiceSettings.style * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={voiceSettings.style}
                          onChange={(e) => setVoiceSettings((prev) => ({ ...prev, style: parseFloat(e.target.value) }))}
                          className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-400"
                        />
                        <div className="flex justify-between text-[9px] text-fg-subtle tabular-nums">
                          <span>Neutro (0%)</span>
                          <span>Dinámico (100%)</span>
                        </div>
                      </div>
                    )}

                    {/* Velocidad */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-fg-muted">
                          Velocidad de locución (speed)
                        </label>
                        <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-accent/10 text-accent font-semibold">
                          {voiceSettings.speed.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.70"
                        max="1.25"
                        step="0.05"
                        value={voiceSettings.speed}
                        onChange={(e) => setVoiceSettings((prev) => ({ ...prev, speed: parseFloat(e.target.value) }))}
                        className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-400"
                      />
                      <div className="flex justify-between text-[9px] text-fg-subtle tabular-nums">
                        <span>Lento (0.70x)</span>
                        <span>Rápido (1.25x)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {!isElevenLabsConfigured && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px]">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>
                      Configura <strong>ELEVENLABS_API_KEY</strong> y tu <strong>ELEVENLABS_VOICE_ID</strong> en tu archivo <code className="px-1 py-0.5 rounded bg-bg/10 tabular-nums">.env.local</code> para activar la locución con tu voz personalizada sin límites.
                    </p>
                  </div>
                )}
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
                  <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-line">
                    <div className="flex items-center gap-2.5 truncate">
                      <FileAudio className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-fg truncate">
                        {localAudioFile.name}
                      </span>
                      <span className="text-[11px] tabular-nums text-fg-subtle shrink-0">
                        ({(localAudioFile.size / (1024 * 1024)).toFixed(2)} MB)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setLocalAudioFile(null)}
                      className="text-fg-subtle hover:text-rose-500 dark:hover:text-rose-400 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : loadedAudioName || activeProject?.audioName ? (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-emerald-500/20">
                    <div className="flex items-center gap-2.5 truncate">
                      <FileAudio className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-fg truncate">
                        {loadedAudioName || activeProject?.audioName}
                      </span>
                      <span className="text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                        Restaurado de Disco
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => audioInputRef.current?.click()}
                        className="text-[11px] text-fg-muted hover:text-fg px-2 py-1 rounded bg-surface border border-line transition-colors shadow-2xs"
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
                        className="text-fg-subtle hover:text-rose-500 dark:hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => audioInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 p-3.5 rounded-xl border border-dashed border-line-strong hover:border-line-strong bg-surface-2/70 hover:bg-surface-2/60 cursor-pointer text-xs text-fg-muted transition-colors"
                  >
                    <Upload className="h-4 w-4 text-fg-subtle" />
                    <span>Seleccionar archivo .mp3 desde tu disco duro</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* =================================================================
              MÓDULO 3: BOTÓN PRINCIPAL DE RENDERIZADO (Cloudinary -> OpenRouter)
              ================================================================= */}
          <div className="pt-3 border-t border-line">
            <button
              type="button"
              disabled={isRendering || (!photoFile && !photoPreviewUrl)}
              onClick={handleRender}
              className="btn-primary w-full h-12 px-4 text-sm !justify-between"
            >
              <div className="flex items-center gap-2">
                {isRendering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}
                <span>
                  {isRendering
                    ? renderPhase
                    : 'Generar video'}
                </span>
              </div>

              <span className="text-[12px] font-medium opacity-75 tabular-nums">
                Avatar IV
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

    {/* Modal de Confirmación para Eliminar Voz en ElevenLabs */}
    {voiceToDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/20 shrink-0">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-fg">
                ¿Eliminar Voz de ElevenLabs?
              </h3>
              <p className="text-xs text-fg-subtle leading-relaxed">
                ¿Estás seguro de que deseas eliminar permanentemente la voz{' '}
                <strong className="text-fg">
                  &quot;{voiceToDelete.name}&quot;
                </strong>{' '}
                tanto de ElevenLabs como de tu almacenamiento local? Esta acción no se puede deshacer.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
            <button
              type="button"
              disabled={isDeletingVoice}
              onClick={() => setVoiceToDelete(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-fg-muted hover:bg-surface-2 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeletingVoice}
              onClick={handleDeleteVoice}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isDeletingVoice ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Eliminando...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  <span>Eliminar Voz</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
}
