'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Sparkles,
  Upload,
  Play,
  Pause,
  Download,
  Trash2,
  FileAudio,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Languages,
  ChevronDown,
  Volume2,
  VolumeX,
  Share2,
  Layers,
  ArrowRight,
  Info,
} from 'lucide-react';
import { ClonedVoiceRecord, SUPPORTED_LANGUAGES, SupportedLanguageCode } from '@/types/elevenlabs.types';
import { useMiaStore } from '@/store/useMiaStore';

export function VoiceStudioView() {
  // Pestaña activa: 'clone' (Clonar Nueva Voz) | 'tts' (Estudio de Generación)
  const [activeTab, setActiveTab] = useState<'clone' | 'tts'>('tts');

  // ===========================================================================
  // ESTADO - LISTA DE VOCES
  // ===========================================================================
  const [voices, setVoices] = useState<ClonedVoiceRecord[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);

  // ===========================================================================
  // ESTADO - SECCIÓN 1: CLONAR NUEVA VOZ
  // ===========================================================================
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [sampleFiles, setSampleFiles] = useState<File[]>([]);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSuccessMsg, setCloneSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===========================================================================
  // ESTADO - SECCIÓN 2: ESTUDIO DE GENERACIÓN (MULTILINGUAL TTS)
  // ===========================================================================
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguageCode>('es');
  const [scriptText, setScriptText] = useState(
    'Hola, bienvenido a nuestro estudio de producción. Esta es una demostración de clonación de voz neuronal multilingüe con ElevenLabs. Calidad de estudio lista para tus videos publicitarios.'
  );
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isGeneratingAiScript, setIsGeneratingAiScript] = useState(false);

  // Reproductor de audio
  const [generatedAudioBlob, setGeneratedAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Alertas / Mensajes
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Asistente Mia / Store global para inyección cruzada a HeyGen
  const injectIntoTool = useMiaStore((s) => s.injectIntoTool);
  const setActiveTool = useMiaStore((s) => s.setActiveTool);

  // Cargar lista de voces en el montaje inicial
  useEffect(() => {
    fetchVoices();
  }, []);

  const fetchVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const res = await fetch('/api/elevenlabs/voices');
      if (res.ok) {
        const data = await res.json();
        if (data.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);
          if (data.voices.length > 0 && !selectedVoiceId) {
            setSelectedVoiceId(data.voices[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Error al cargar voces de ElevenLabs:', err);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  // ===========================================================================
  // MANEJADORES: CLONACIÓN DE VOZ
  // ===========================================================================
  const handleFilesAdded = (newFiles: FileList | File[]) => {
    const validAudios: File[] = [];
    const arrayFiles = Array.from(newFiles);

    for (const f of arrayFiles) {
      if (f.type.startsWith('audio/') || f.name.endsWith('.mp3') || f.name.endsWith('.wav')) {
        validAudios.push(f);
      }
    }

    if (validAudios.length === 0) {
      setErrorMessage('Por favor sube únicamente archivos de audio válidos (.mp3 o .wav).');
      return;
    }

    setSampleFiles((prev) => [...prev, ...validAudios]);
    setErrorMessage(null);
  };

  const handleRemoveSample = (index: number) => {
    setSampleFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCloneVoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneName.trim()) {
      setErrorMessage('Ingresa un nombre para la voz antes de clonarla.');
      return;
    }

    if (sampleFiles.length === 0) {
      setErrorMessage('Debes adjuntar al menos 1 muestra de audio nítido (MP3 o WAV).');
      return;
    }

    setIsCloning(true);
    setErrorMessage(null);
    setCloneSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('name', cloneName.trim());
      if (cloneDescription.trim()) {
        formData.append('description', cloneDescription.trim());
      }
      sampleFiles.forEach((file) => {
        formData.append('files', file);
      });

      const res = await fetch('/api/elevenlabs/voices/add', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Fallo durante la clonación de la voz en ElevenLabs.');
      }

      setCloneSuccessMsg(`¡Voz "${data.name}" clonada exitosamente con ID: ${data.voice_id}!`);
      setCloneName('');
      setCloneDescription('');
      setSampleFiles([]);

      // Recargar voces y seleccionar la nueva voz clonada en la pestaña de generación
      await fetchVoices();
      setSelectedVoiceId(data.voice_id);
      setActiveTab('tts');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error inesperado al clonar la voz.');
    } finally {
      setIsCloning(false);
    }
  };

  // ===========================================================================
  // MANEJADORES: GENERACIÓN MULTILINGÜE (TTS)
  // ===========================================================================
  const handleSynthesizeAudio = async () => {
    if (!scriptText.trim()) {
      setErrorMessage('El guion no puede estar vacío.');
      return;
    }
    if (!selectedVoiceId) {
      setErrorMessage('Selecciona una voz para la síntesis.');
      return;
    }

    setIsSynthesizing(true);
    setErrorMessage(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      const res = await fetch('/api/elevenlabs/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText.trim(),
          voiceId: selectedVoiceId,
          language: selectedLanguage,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Error al sintetizar el audio en ElevenLabs.');
      }

      const blob = await res.blob();
      setGeneratedAudioBlob(blob);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error en la síntesis de voz.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Redacción de guion con Gemini en 1 clic a cero costos
  const handleGenerateScriptWithGemini = async () => {
    setIsGeneratingAiScript(true);
    setErrorMessage(null);

    const promptIdea = scriptText.trim() || 'Crea un gancho publicitario para video de alta conversión';
    try {
      const res = await fetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptIdea }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.script) {
          setScriptText(data.script);
        }
      }
    } catch (err) {
      console.warn('Error al auto-generar guion con Gemini:', err);
    } finally {
      setIsGeneratingAiScript(false);
    }
  };

  // Controles de audio
  const togglePlayAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleDownloadMp3 = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    const selectedVoice = voices.find((v) => v.id === selectedVoiceId);
    const voiceTag = selectedVoice ? selectedVoice.name.replace(/\s+/g, '_') : 'Voice';
    a.download = `ElevenLabs_${voiceTag}_${selectedLanguage.toUpperCase()}_${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Enviar audio generado a Avatar Studio (HeyGen)
  const handleSendToAvatarStudio = () => {
    if (!audioUrl) return;
    injectIntoTool('avatar-studio', scriptText);
    setActiveTool('avatar-studio');
  };

  const selectedVoiceObj = voices.find((v) => v.id === selectedVoiceId);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* =======================================================================
          HEADER & NAVEGACIÓN POR PESTAÑAS
          ======================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-white/[0.08] pb-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:text-zinc-400 mb-2 shadow-2xs">
            <Mic className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
            <span>ELEVENLABS MOTOR · MULTILINGUAL V2 · INSTANT VOICE CLONING</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Voice Studio
          </h2>
          <p className="text-xs text-slate-600 dark:text-zinc-400">
            Clonación de voz neuronal a partir de tus muestras y síntesis multilingüe en Español, Inglés y Portugués.
          </p>
        </div>

        {/* Selector de pestañas segmentado estilo Linear */}
        <div className="inline-flex p-1 rounded-xl bg-slate-200/60 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-white/[0.08]">
          <button
            type="button"
            onClick={() => setActiveTab('tts')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'tts'
                ? 'bg-white text-slate-900 dark:bg-zinc-800 dark:text-white shadow-sm border border-slate-200/80 dark:border-white/[0.1]'
                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <Volume2 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            <span>Estudio de Generación</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('clone')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'clone'
                ? 'bg-white text-slate-900 dark:bg-zinc-800 dark:text-white shadow-sm border border-slate-200/80 dark:border-white/[0.1]'
                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <Mic className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Clonar Nueva Voz</span>
            {sampleFiles.length > 0 && (
              <span className="h-4 w-4 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] flex items-center justify-center font-mono">
                {sampleFiles.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Banner de mensajes de éxito o error */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {cloneSuccessMsg && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{cloneSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setCloneSuccessMsg(null)}
            className="text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* =======================================================================
          SECCIÓN 1: CLONAR NUEVA VOZ (/v1/voices/add)
          ======================================================================= */}
      {activeTab === 'clone' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in">
          {/* Formulario de Clonación */}
          <div className="lg:col-span-8 space-y-5">
            <form onSubmit={handleCloneVoiceSubmit} className="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950/60 p-6 space-y-5 shadow-xs">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  <Mic className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                  <span>Configuración de la Voz Personalizada</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-500">
                  Sube entre 1 y 5 minutos de grabaciones limpias (voz hablando a ritmo normal, sin música de fondo).
                </p>
              </div>

              {/* Input: Nombre de la Voz */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Nombre de la Voz <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="Ej: Voz Sebastián Principal (Comercial)"
                  className="w-full rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/60 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40 px-3.5 py-2.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all"
                  required
                />
              </div>

              {/* Input: Descripción opcional */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Descripción o Notas de Tono (Opcional)
                </label>
                <input
                  type="text"
                  value={cloneDescription}
                  onChange={(e) => setCloneDescription(e.target.value)}
                  placeholder="Ej: Tono dinámico y entusiasta para reels y anuncios de marca"
                  className="w-full rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/60 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 px-3.5 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all"
                />
              </div>

              {/* Drag & Drop Zone para Muestras de Audio */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Muestras de Audio (.mp3 o .wav)
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-zinc-500 font-mono">
                    {sampleFiles.length} muestra(s) cargada(s)
                  </span>
                </div>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files) handleFilesAdded(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative cursor-pointer rounded-2xl border border-dashed border-slate-300 dark:border-white/[0.15] bg-slate-50/70 hover:bg-slate-100/60 dark:bg-zinc-900/20 dark:hover:bg-zinc-900/40 p-8 text-center transition-all hover:border-emerald-500/60"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="audio/mpeg,audio/wav,audio/mp3,audio/x-wav"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleFilesAdded(e.target.files);
                    }}
                  />

                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                      <Upload className="h-5 w-5" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                        Arrastra tus archivos de audio aquí o haz clic para explorar
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-500">
                        Formatos soportados: MP3, WAV (Mínimo recomendado: 1 a 3 muestras de 60 segundos)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Lista de archivos adjuntos */}
                {sampleFiles.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    {sampleFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.06] text-xs"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <FileAudio className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                          <span className="truncate text-slate-800 dark:text-zinc-200 font-medium">{file.name}</span>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-500 shrink-0">
                            ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveSample(idx)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-rose-400 dark:hover:bg-white/[0.04] transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Botón Principal: Clonar Voz */}
              <button
                type="submit"
                disabled={isCloning || !cloneName.trim() || sampleFiles.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-semibold text-xs tracking-wide transition-all shadow-lg shadow-emerald-500/10 cursor-pointer"
              >
                {isCloning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Extrayendo embedding de voz y procesando en ElevenLabs...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    <span>Clonar Voz en ElevenLabs ({sampleFiles.length} muestra{sampleFiles.length === 1 ? '' : 's'})</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Panel Lateral: Guía de Calidad y Consejos */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950/60 p-5 space-y-4 text-xs shadow-xs">
              <div className="flex items-center gap-2 text-slate-800 dark:text-zinc-200 font-medium">
                <Info className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                <span>Recomendaciones Técnicas SRE</span>
              </div>
              <ul className="space-y-2.5 text-slate-600 dark:text-zinc-400 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 dark:text-emerald-400 font-bold">•</span>
                  <span><strong>Audio sin ruido:</strong> Graba en una habitación silenciosa con micrófono de solapa o condensador.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 dark:text-emerald-400 font-bold">•</span>
                  <span><strong>Sin música de fondo:</strong> La música o los efectos arruinan el entrenamiento de la red neuronal.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Variedad de entonación:</strong> Habla de forma natural con el estilo exacto que deseas para tus anuncios.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 dark:text-emerald-400 font-bold">•</span>
                  <span><strong>Persistencia local:</strong> La voz clonada se guarda automáticamente en <code className="text-[10px] text-slate-700 dark:text-zinc-300 bg-slate-100 dark:bg-white/[0.05] px-1 py-0.5 rounded">cloned_voices.json</code> para uso permanente.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          SECCIÓN 2: ESTUDIO DE GENERACIÓN (MULTILINGUAL TTS)
          ======================================================================= */}
      {activeTab === 'tts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in">
          {/* Panel Izquierdo: Configuración & Texto */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950/60 p-6 space-y-5 shadow-xs">
              {/* Selector de Voz Elegante */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span>Voz Activa (Base de Datos Local)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('clone')}
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-medium transition-colors"
                  >
                    + Clonar otra voz
                  </button>
                </div>

                <div className="relative">
                  <select
                    value={selectedVoiceId}
                    onChange={(e) => setSelectedVoiceId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/60 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 px-3.5 py-2.5 text-xs text-slate-900 dark:text-zinc-100 outline-none transition-all pr-10 cursor-pointer"
                  >
                    {voices.map((v) => (
                      <option key={v.id} value={v.id} className="bg-white text-slate-900 dark:bg-zinc-900 dark:text-zinc-100">
                        {v.category === 'cloned' ? '⭐ [CLONADA] ' : '🎙️ [PRESET] '}
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3.5 top-3 h-4 w-4 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                </div>

                {selectedVoiceObj && (
                  <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic pl-1">
                    {selectedVoiceObj.description || 'Voz neuronal optimizada.'}
                  </p>
                )}
              </div>

              {/* Segmented Control para Idioma Objetivo */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Languages className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span>Idioma Objetivo (Modelo eleven_multilingual_v2)</span>
                  </label>
                  <span className="font-mono text-[10px] text-slate-600 dark:text-zinc-500 border border-slate-200 dark:border-white/[0.06] bg-slate-100 dark:bg-zinc-900/60 px-2 py-0.5 rounded">
                    eleven_multilingual_v2
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isSelected = selectedLanguage === lang.code;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => setSelectedLanguage(lang.code)}
                        className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-600/15 dark:border-indigo-500/40 dark:text-white shadow-xs'
                            : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:bg-white/[0.02] dark:border-white/[0.06] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="text-sm">{lang.flag}</span>
                        <span>{lang.name}</span>
                        <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-500">[{lang.label}]</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Área de Texto Amplia para el Guion */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Guion de Locución
                  </label>

                  <button
                    type="button"
                    disabled={isGeneratingAiScript}
                    onClick={handleGenerateScriptWithGemini}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-300 transition-colors disabled:opacity-40 cursor-pointer"
                    title="Usa el pool de Gemini a cero costos para redactar un gancho comercial"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{isGeneratingAiScript ? 'Generando con Gemini...' : 'Perfeccionar con Gemini'}</span>
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="Escribe o pega aquí el guion que la voz clonada debe locutar..."
                  className="w-full rounded-2xl bg-slate-50 hover:bg-slate-100/50 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 p-4 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all resize-none leading-relaxed"
                />

                <div className="flex justify-between text-[11px] text-slate-500 dark:text-zinc-500 font-mono">
                  <span>~{Math.round(scriptText.trim().length / 15)}s estimados de locución</span>
                  <span>{scriptText.length} caracteres</span>
                </div>
              </div>

              {/* Botón Principal: Sintetizar Audio */}
              <button
                type="button"
                disabled={isSynthesizing || !scriptText.trim() || !selectedVoiceId}
                onClick={handleSynthesizeAudio}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black disabled:opacity-40 font-semibold text-xs tracking-wide transition-all shadow-md shadow-slate-900/10 dark:shadow-white/5 cursor-pointer"
              >
                {isSynthesizing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Sintetizando locución multilingüe con ElevenLabs...</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4" />
                    <span>Sintetizar Audio ({selectedLanguage.toUpperCase()})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Panel Derecho: Reproductor Minimalista & Exportación */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-950/60 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/[0.06] pb-3">
                <span className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  <Play className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                  <span>Monitor de Audio</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-500">
                  {audioUrl ? 'LISTO' : 'EN ESPERA'}
                </span>
              </div>

              {/* Elemento de Audio Oculto */}
              {audioUrl && (
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setAudioCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
                  className="hidden"
                />
              )}

              {/* Tarjeta de Reproductor */}
              {audioUrl ? (
                <div className="space-y-4 rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50 dark:bg-zinc-900/40 p-4">
                  {/* Animación de ondas de sonido o barra de progreso */}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={togglePlayAudio}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
                    >
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                    </button>

                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between font-mono text-[10px] text-slate-600 dark:text-zinc-400">
                        <span>
                          {Math.floor(audioCurrentTime / 60)}:
                          {String(Math.floor(audioCurrentTime % 60)).padStart(2, '0')}
                        </span>
                        <span>
                          {Math.floor(audioDuration / 60)}:
                          {String(Math.floor(audioDuration % 60)).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Scrubber de audio */}
                      <input
                        type="range"
                        min={0}
                        max={audioDuration || 100}
                        value={audioCurrentTime}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setAudioCurrentTime(val);
                          if (audioRef.current) audioRef.current.currentTime = val;
                        }}
                        className="w-full h-1 bg-slate-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Acciones del Audio: Descargar o Inyectar a HeyGen */}
                  <div className="pt-2 space-y-2 border-t border-slate-200/80 dark:border-white/[0.06]">
                    <button
                      type="button"
                      onClick={handleDownloadMp3}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 text-xs font-medium transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Descargar Archivo MP3</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSendToAvatarStudio}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-md shadow-indigo-600/10 cursor-pointer"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      <span>Inyectar en Avatar Studio (HeyGen)</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200/80 dark:border-white/[0.08] bg-slate-50/50 dark:bg-transparent p-6 text-center text-slate-500 dark:text-zinc-500 text-xs space-y-1">
                  <Volume2 className="h-6 w-6 mx-auto text-slate-400 dark:text-zinc-600 mb-2 opacity-50" />
                  <p className="font-medium text-slate-700 dark:text-zinc-400">Sin audio generado</p>
                  <p className="text-[11px]">Escribe un guion y presiona &ldquo;Sintetizar Audio&rdquo; para escucharlo aquí.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
