'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  FileUp,
  FolderOpen,
  ImagePlus,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { VoiceModelPanel } from '@/components/voice/VoiceModelPanel';
import { MotionControls, type Expressiveness } from '@/components/voice/MotionControls';
import { postOrchestrated } from '@/lib/ai/orchestrator-client';
import {
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_VOICE_SETTINGS,
  getElevenModel,
  type VoiceSettingsState,
} from '@/config/elevenlabs-models';
import { BROLL_MODELS, DEFAULT_BROLL_MODEL, VOICE_MODES, brollRate, getBrollModel, type VoiceMode } from '@/config/broll-models';
import { estimateSceneProject } from '@/lib/scenes/scene-estimate';
import { estimateSeconds } from '@/lib/scenes/scene-plan';

/**
 * Guion a video (por escenas): guion, idea o PDF → escenas editables →
 * voz continua con tiempos → un clip por escena (avatar o toma de apoyo) → montaje con FFmpeg.
 */

type Source = 'script' | 'idea' | 'pdf';
type Aspect = '9:16' | '16:9' | '1:1';

interface DraftScene {
  key: string;
  type: 'avatar' | 'broll';
  narration: string;
  visualPrompt: string;
  imageId?: string;
}

interface DraftImage {
  id: string;
  name: string;
  dataUrl: string;
}

interface VoiceOption {
  id: string;
  name: string;
}

interface ProjectStatus {
  id: string;
  title: string;
  status: 'queued' | 'voice' | 'clips' | 'stitching' | 'completed' | 'failed';
  phase: string;
  error?: string;
  totalSeconds?: number;
  estimatedCostUSD?: number;
  costUSD?: number;
  outputPath?: string;
  outputUrl?: string | null;
  scenes: Array<{ number: number; type: string; narration: string; status: string; phase?: string; error?: string }>;
}

const DRAFT_KEY = 'lulo_scenes_draft';
const ACTIVE_KEY = 'lulo_scenes_active';
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const newKey = () => Math.random().toString(36).slice(2, 10);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(file);
  });
}

export function TextToVideoView() {
  // Material de entrada
  const [source, setSource] = useState<Source>('script');
  const [keepScript, setKeepScript] = useState(true);
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState<{ name: string; dataUrl: string; size: number } | null>(null);
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [planning, setPlanning] = useState(false);
  const [confidential, setConfidential] = useState(false);
  const [pdfImages, setPdfImages] = useState<Array<{ name: string; dataUrl: string; width: number; height: number }>>([]);
  const [pdfImagesLoading, setPdfImagesLoading] = useState(false);
  const [missingModels, setMissingModels] = useState<string[]>([]);

  // Escenas y recursos
  const [title, setTitle] = useState('');
  const [scenes, setScenes] = useState<DraftScene[]>([]);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [voiceModel, setVoiceModel] = useState<string>(DEFAULT_ELEVEN_MODEL);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsState>(DEFAULT_VOICE_SETTINGS);
  const [brollModel, setBrollModel] = useState(DEFAULT_BROLL_MODEL);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('voiceover');
  const [motionPrompt, setMotionPrompt] = useState('');
  const [expressiveness, setExpressiveness] = useState<Expressiveness>('low');
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean } | null>(null);

  // Render
  const [activeId, setActiveId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  // Mia puede inyectar un guion
  const injectedData = useMiaStore((s) => s.injectedData);
  const clearInjectedData = useMiaStore((s) => s.clearInjectedData);
  useEffect(() => {
    if (injectedData && injectedData.targetTool === 'text-to-video') {
      const t = setTimeout(() => {
        setSource('script');
        setText(injectedData.content);
        clearInjectedData();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [injectedData, clearInjectedData]);

  // Carga inicial: borrador, proyecto activo, voces y FFmpeg
  useEffect(() => {
    const t = setTimeout(() => {
      if (restored.current) return;
      restored.current = true;
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (typeof d.text === 'string') setText(d.text);
          if (typeof d.title === 'string') setTitle(d.title);
          if (Array.isArray(d.scenes)) setScenes(d.scenes);
          if (d.aspect) setAspect(d.aspect);
          if (d.voiceModel) setVoiceModel(d.voiceModel);
          if (d.brollModel) setBrollModel(d.brollModel);
          if (d.voiceMode) setVoiceMode(d.voiceMode);
          if (typeof d.confidential === 'boolean') setConfidential(d.confidential);
        }
        const active = localStorage.getItem(ACTIVE_KEY);
        if (active) setActiveId(active);
      } catch {
        // sin almacenamiento local
      }
    }, 0);
    fetch('/api/elevenlabs/voices')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: VoiceOption[] = (d?.voices ?? []).map((v: { id: string; name: string }) => ({ id: v.id, name: v.name }));
        setVoices(list);
        if (list[0]) setVoiceId((cur) => cur || list[0].id);
      })
      .catch(() => {});
    fetch('/api/system/video-models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMissingModels((d.missing ?? []).map((m: { id: string }) => m.id)))
      .catch(() => {});
    fetch('/api/system/ffmpeg')
      .then((r) => r.json())
      .then(setFfmpeg)
      .catch(() => setFfmpeg({ available: false }));
    return () => clearTimeout(t);
  }, []);

  // Guarda el borrador (sin imágenes ni PDF, que pesan demasiado)
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, title, scenes, aspect, voiceModel, brollModel, confidential, voiceMode }));
    } catch {
      // ignorar
    }
  }, [text, title, scenes, aspect, voiceModel, brollModel, confidential, voiceMode]);

  // Seguimiento del proyecto en curso
  const poll = useCallback(async (id: string) => {
    const r = await fetch(`/api/scenes/${id}`, { cache: 'no-store' });
    if (r.status === 404) {
      setActiveId(null);
      setProject(null);
      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch {
        // ignorar
      }
      return;
    }
    if (r.ok) setProject(await r.json());
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const run = () => alive && void poll(activeId);
    const first = setTimeout(run, 0);
    const timer = setInterval(run, 4000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [activeId, poll]);

  const persona = images.find((i) => i.id === personaId) ?? images[0];
  // Las tomas de apoyo parten de una foto de producto si hay; si no, solo de la descripción.
  // (Veo rechaza algunas fotos de personas, así que la persona no se usa por defecto.)
  const defaultBrollImage =
    voiceMode === 'native'
      ? persona?.id ?? 'none' // misma persona en todas las escenas
      : images.find((i) => i.id !== persona?.id)?.id ?? 'none';
  const brollSpec = getBrollModel(brollModel);
  const availableModels = BROLL_MODELS.filter((m) => voiceMode !== 'native' || m.audio);
  const fullText = scenes.map((s) => s.narration.trim()).join(' ');
  const voiceSpec = getElevenModel(voiceModel);
  const estimate = useMemo(
    () =>
      scenes.length
        ? estimateSceneProject({ voiceModelId: voiceModel, brollModel, voiceMode, scenes: scenes.filter((s) => s.narration.trim()) })
        : null,
    [scenes, voiceModel, brollModel, voiceMode]
  );

  // ----- Acciones -----

  const planScenes = async () => {
    setError(null);
    if (source === 'pdf' && !pdf) return setError('Sube primero el PDF.');
    if (source !== 'pdf' && !text.trim()) return setError(source === 'script' ? 'Pega tu guion.' : 'Escribe la idea del video.');
    setPlanning(true);
    try {
      const res = await postOrchestrated('/api/scenes/plan', {
        mode: source === 'script' && keepScript ? 'keep' : 'write',
        text,
        pdfBase64: source === 'pdf' && pdf ? pdf.dataUrl.replace(/^data:[^;]+;base64,/, '') : undefined,
        pdfName: pdf?.name,
        targetSeconds,
        emotionTags: voiceMode !== 'native' && voiceSpec.audioTags,
        voiceMode,
        confidential,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron armar las escenas.');
      setTitle(data.title || 'Video');
      setScenes(
        (data.scenes as Array<Omit<DraftScene, 'key'>>).map((s) => ({ ...s, key: newKey(), imageId: undefined }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron armar las escenas.');
    } finally {
      setPlanning(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const next: DraftImage[] = [];
    for (const f of Array.from(files).slice(0, 8 - images.length)) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} pesa más de 10 MB.`);
        continue;
      }
      next.push({ id: `img-${newKey()}`, name: f.name, dataUrl: await readFileAsDataUrl(f) });
    }
    setImages((cur) => [...cur, ...next]);
    if (!personaId && next[0]) setPersonaId(next[0].id);
  };

  const loadPdf = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return setError('El archivo debe ser un PDF.');
    if (file.size > 20 * 1024 * 1024) return setError('El PDF debe pesar menos de 20 MB.');
    const dataUrl = await readFileAsDataUrl(file);
    setPdf({ name: file.name, size: file.size, dataUrl });
    setError(null);
    setPdfImages([]);
    setPdfImagesLoading(true);
    try {
      const r = await fetch('/api/scenes/pdf-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: dataUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setPdfImages(d.images ?? []);
    } finally {
      setPdfImagesLoading(false);
    }
  };

  const addPdfImage = (img: { name: string; dataUrl: string }) => {
    if (images.length >= 8 || images.some((i) => i.dataUrl === img.dataUrl)) return;
    const id = `img-${newKey()}`;
    setImages((cur) => [...cur, { id, name: img.name, dataUrl: img.dataUrl }]);
    if (!personaId) setPersonaId(id);
  };

  const patchScene = (key: string, patch: Partial<DraftScene>) =>
    setScenes((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const moveScene = (i: number, dir: -1 | 1) =>
    setScenes((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const copy = [...cur];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const submit = async () => {
    setError(null);
    const valid = scenes.filter((s) => s.narration.trim());
    if (!valid.length) return setError('Añade al menos una escena con texto.');
    if (voiceMode === 'avatar' && valid.some((s) => s.type === 'avatar') && !persona)
      return setError('Sube la foto de la persona para las escenas donde habla.');
    if (voiceMode !== 'native' && !voiceId) return setError('Elige una voz.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Video',
          aspectRatio: aspect,
          brollModel,
          voiceMode,
          avatarMotion: voiceMode === 'avatar' ? { motionPrompt: motionPrompt.trim() || undefined, expressiveness } : undefined,
          voice:
            voiceMode === 'native'
              ? undefined
              : {
                  voiceId,
                  voiceName: voices.find((v) => v.id === voiceId)?.name,
                  modelId: voiceModel,
                  settings: voiceSettings,
                },
          images: images.map((img) => ({ id: img.id, name: img.name, dataBase64: img.dataUrl })),
          scenes: valid.map((s) => ({
            type: voiceMode === 'avatar' ? s.type : 'broll',
            narration: s.narration.trim(),
            visualPrompt: s.visualPrompt.trim(),
            imageId:
              voiceMode === 'avatar' && s.type === 'avatar'
                ? persona!.id
                : s.imageId && (s.imageId === 'none' || images.some((i) => i.id === s.imageId))
                ? s.imageId
                : defaultBrollImage,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar el video.');
      setActiveId(data.id);
      setProject(null);
      try {
        localStorage.setItem(ACTIVE_KEY, data.id);
      } catch {
        // ignorar
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el video.');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!activeId) return;
    await fetch(`/api/scenes/${activeId}/retry`, { method: 'POST' });
    void poll(activeId);
  };

  const closeProject = () => {
    setActiveId(null);
    setProject(null);
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignorar
    }
  };

  const openFolder = (filePath: string) => {
    fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath.replace(/[\\/][^\\/]*$/, '') }),
    }).catch(() => {});
  };

  // ----- Vista: proyecto en marcha -----
  if (activeId) {
    const running = !project || ['queued', 'voice', 'clips', 'stitching'].includes(project.status);
    return (
      <div className="w-full max-w-3xl space-y-5">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-[15px] font-semibold text-fg">{project?.title ?? 'Preparando…'}</h2>
          {!running && (
            <button type="button" onClick={closeProject} className="btn-secondary h-9 px-3 text-[13px]">
              Nuevo video
            </button>
          )}
        </header>

        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-[14px] text-fg">
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : project?.status === 'completed' ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-500" />
            )}
            <span className="font-medium">{project?.phase ?? 'En cola'}</span>
          </div>
          {running && (
            <p className="mt-1 text-[12px] text-fg-subtle">
              Puedes cerrar esta pestaña o cambiar de herramienta: el video sigue generándose y aparecerá aquí al volver.
            </p>
          )}
          {project?.error && <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-400">{project.error}</p>}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-fg-muted tabular-nums">
            {project?.totalSeconds ? <span>Duración {project.totalSeconds.toFixed(1)} s</span> : null}
            {project?.estimatedCostUSD !== undefined && <span>Estimado {usd(project.estimatedCostUSD)}</span>}
            {project?.costUSD ? <span>Gastado {usd(project.costUSD)}</span> : null}
          </div>
          {project?.status === 'failed' && (
            <button type="button" onClick={retry} className="btn-primary mt-4 h-9 px-4 text-[13px]">
              <RotateCcw className="h-3.5 w-3.5" /> Reintentar lo que falló
            </button>
          )}
        </div>

        {project?.outputUrl && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <video
              src={project.outputUrl}
              controls
              className={`mx-auto max-h-[70vh] rounded-lg bg-black ${aspect === '16:9' ? 'w-full' : 'w-auto'}`}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-muted">
              <span className="truncate">{project.outputPath}</span>
              <button type="button" onClick={() => openFolder(project.outputPath!)} className="btn-secondary h-8 px-3 text-[12px]">
                <FolderOpen className="h-3.5 w-3.5" /> Abrir carpeta
              </button>
            </div>
          </div>
        )}

        {project && (
          <ol className="divide-y divide-line rounded-xl border border-line bg-surface">
            {project.scenes.map((s) => (
              <li key={s.number} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 w-5 shrink-0 text-[12px] tabular-nums text-fg-subtle">{s.number}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-fg line-clamp-2">{s.narration}</p>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">
                    {s.type === 'avatar' ? 'Habla la persona' : 'Toma de apoyo'}
                    {s.phase && s.status === 'rendering' ? ` · ${s.phase}` : ''}
                    {s.error ? ` · ${s.error}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${
                    s.status === 'done'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : s.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-surface-2 text-fg-muted'
                  }`}
                >
                  {s.status === 'done' ? 'Listo' : s.status === 'failed' ? 'Falló' : s.status === 'rendering' ? 'Generando' : 'En espera'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  // ----- Vista: preparar el video -----
  const sourceTabs: Array<{ id: Source; label: string; icon: React.ReactNode }> = [
    { id: 'script', label: 'Mi guion', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'idea', label: 'Una idea', icon: <Lightbulb className="h-3.5 w-3.5" /> },
    { id: 'pdf', label: 'Un PDF', icon: <FileUp className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="w-full max-w-3xl space-y-6">

      {ffmpeg && !ffmpeg.available && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Falta FFmpeg para montar el video. En la carpeta <code>frontend</code> ejecuta <code>npm i ffmpeg-static</code> y reinicia la app,
            o define <code>FFMPEG_PATH</code> en <code>.env.local</code>.
          </p>
        </div>
      )}

      {/* 1. Material */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[13px] font-semibold text-fg">1. ¿Cómo suena y de dónde sale el video?</h2>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {VOICE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setVoiceMode(m.id);
                if (m.id === 'native' && !getBrollModel(brollModel).audio) setBrollModel(DEFAULT_BROLL_MODEL);
              }}
              className={`rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
                voiceMode === m.id ? 'border-accent bg-accent/5' : 'border-line hover:bg-surface-2'
              }`}
            >
              <span className="block text-[12.5px] font-medium text-fg">{m.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{m.description}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {sourceTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSource(t.id)}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] transition-colors cursor-pointer ${
                source === t.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {source === 'pdf' && (
          <div className="flex items-center gap-3">
            <input ref={pdfInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => loadPdf(e.target.files?.[0])} />
            <button type="button" onClick={() => pdfInput.current?.click()} className="btn-secondary h-9 px-3 text-[13px]">
              <FileUp className="h-3.5 w-3.5" /> {pdf ? 'Cambiar PDF' : 'Subir PDF'}
            </button>
            {pdf && (
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-muted">
                <span className="truncate">{pdf.name}</span>
                <span className="tabular-nums text-fg-subtle">{(pdf.size / 1024 / 1024).toFixed(1)} MB</span>
                <button type="button" onClick={() => setPdf(null)} className="text-fg-subtle hover:text-fg" aria-label="Quitar PDF">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
        )}

        {source === 'pdf' && (pdfImagesLoading || pdfImages.length > 0) && (
          <div className="space-y-2 rounded-lg bg-surface-2/60 p-3">
            <p className="text-[12px] text-fg-muted">
              {pdfImagesLoading ? 'Buscando fotos dentro del PDF…' : `Fotos encontradas en el PDF (${pdfImages.length}). Pulsa una para usarla en el video.`}
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {pdfImages.map((img) => {
                const added = images.some((i) => i.dataUrl === img.dataUrl);
                return (
                  <button
                    key={img.name}
                    type="button"
                    onClick={() => addPdfImage(img)}
                    disabled={added || images.length >= 8}
                    className={`relative aspect-square overflow-hidden rounded-md border cursor-pointer ${added ? 'border-accent' : 'border-line hover:border-fg-subtle'}`}
                    title={`${img.width}×${img.height}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                    {added && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {source === 'pdf' && pdf && !pdfImagesLoading && pdfImages.length === 0 && (
          <p className="text-[11px] text-fg-subtle">No se encontraron fotos dentro del PDF; puedes subirlas en el paso 3.</p>
        )}

        <textarea
          rows={source === 'script' ? 7 : 3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            source === 'script'
              ? 'Pega aquí tu guion completo…'
              : source === 'idea'
              ? 'Producto, público y lo que quieres destacar. Ej.: crema hidratante para piel seca, mujeres 25–40, envío gratis.'
              : 'Indicaciones opcionales para la IA (tono, qué destacar, a quién va dirigido…)'
          }
          className="input-clean w-full resize-y p-3 text-[13px] leading-relaxed"
        />

        {source === 'script' && (
          <div className="flex flex-wrap gap-4 text-[12px] text-fg-muted">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" checked={keepScript} onChange={() => setKeepScript(true)} /> Usar mi guion tal cual (solo lo divide en escenas)
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" checked={!keepScript} onChange={() => setKeepScript(false)} /> Que la IA lo reescriba
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          {!(source === 'script' && keepScript) && (
            <label className="space-y-1 text-[12px] text-fg-muted">
              <span className="block">Duración aproximada</span>
              <select value={targetSeconds} onChange={(e) => setTargetSeconds(Number(e.target.value))} className="input-clean h-9 px-2 text-[13px]">
                {[15, 30, 45, 60, 90].map((s) => (
                  <option key={s} value={s}>{s} segundos</option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1 text-[12px] text-fg-muted">
            <span className="block">Formato</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} className="input-clean h-9 px-2 text-[13px]">
              <option value="9:16">Vertical 9:16</option>
              <option value="16:9">Horizontal 16:9</option>
              <option value="1:1">Cuadrado 1:1</option>
            </select>
          </label>
          <button type="button" onClick={planScenes} disabled={planning} className="btn-primary ml-auto h-9 px-4 text-[13px]">
            {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {planning ? 'Armando escenas…' : scenes.length ? 'Volver a armar escenas' : 'Armar escenas'}
          </button>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-fg-muted">
          <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="text-fg">Material confidencial</span> — no usar el modo Gratis. En Gratis, Google puede usar el contenido
            para mejorar sus productos; con esta casilla las escenas las arma Claude Haiku (de pago, centavos).
          </span>
        </label>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* 2. Escenas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">2. Escenas {scenes.length ? `(${scenes.length})` : ''}</h2>
          <button
            type="button"
            onClick={() => setScenes((cur) => [...cur, { key: newKey(), type: 'broll', narration: '', visualPrompt: '' }])}
            className="flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir escena
          </button>
        </div>

        {scenes.length > 0 && (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título del video"
            className="input-clean h-9 w-full px-3 text-[13px]"
          />
        )}

        {scenes.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-[12px] text-fg-subtle">
            Aquí aparecerán las escenas para que las revises y edites antes de generar.
          </p>
        )}

        {scenes.map((s, i) => (
          <div key={s.key} className="space-y-2 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium tabular-nums text-fg">Escena {i + 1}</span>
              <span className="text-[11px] tabular-nums text-fg-subtle">~{estimateSeconds(s.narration).toFixed(0)} s</span>
              {voiceMode === 'native' && estimateSeconds(s.narration) > Math.max(...brollSpec.durations) - 1 && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  Muy largo para un clip de {Math.max(...brollSpec.durations)} s: acórtalo o divídelo
                </span>
              )}
              {voiceMode === 'avatar' && (
              <div className="ml-2 flex rounded-md bg-surface-2 p-0.5 text-[11px]">
                {(['avatar', 'broll'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => patchScene(s.key, { type: t })}
                    className={`rounded px-2 py-0.5 cursor-pointer ${s.type === t ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted'}`}
                  >
                    {t === 'avatar' ? 'Habla la persona' : 'Toma de apoyo'}
                  </button>
                ))}
              </div>
              )}
              <div className="ml-auto flex items-center gap-1 text-fg-subtle">
                <button type="button" onClick={() => moveScene(i, -1)} className="p-1 hover:text-fg" aria-label="Subir escena">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => moveScene(i, 1)} className="p-1 hover:text-fg" aria-label="Bajar escena">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setScenes((cur) => cur.filter((x) => x.key !== s.key))}
                  className="p-1 hover:text-rose-500"
                  aria-label="Quitar escena"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <textarea
              rows={2}
              value={s.narration}
              onChange={(e) => patchScene(s.key, { narration: e.target.value })}
              placeholder={voiceMode === 'native' ? 'Lo que dice la persona en este clip (máx. ~6 s)' : 'Lo que dice la voz en esta escena'}
              className="input-clean w-full resize-y p-2.5 text-[13px] leading-relaxed"
            />
            {(s.type === 'broll' || voiceMode !== 'avatar') && (
              <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
                <textarea
                  rows={2}
                  value={s.visualPrompt}
                  onChange={(e) => patchScene(s.key, { visualPrompt: e.target.value })}
                  placeholder="Qué se ve en la toma (sujeto, acción, plano, luz, movimiento de cámara)"
                  className="input-clean w-full resize-y p-2.5 text-[12px] leading-relaxed"
                />
                <select
                  value={s.imageId && (s.imageId === 'none' || images.some((i) => i.id === s.imageId)) ? s.imageId : defaultBrollImage}
                  onChange={(e) => patchScene(s.key, { imageId: e.target.value })}
                  className="input-clean h-9 px-2 text-[12px]"
                  title="Imagen de la que parte la toma"
                >
                  <option value="none">Sin imagen: solo la descripción</option>
                  {images.map((img) => (
                    <option key={img.id} value={img.id}>
                      Parte de: {img.name}
                      {img.id === persona?.id ? ' (persona)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
      </section>

      {scenes.length > 0 && (
        <>
          {/* 3. Imágenes */}
          <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-fg">3. Imágenes</h2>
              <input ref={imgInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
              <button type="button" onClick={() => imgInput.current?.click()} className="btn-secondary h-8 px-3 text-[12px]" disabled={images.length >= 8}>
                <ImagePlus className="h-3.5 w-3.5" /> Añadir
              </button>
            </div>
            <p className="text-[11px] text-fg-subtle">
              La foto marcada como persona se usa en las escenas donde habla. Cada toma de apoyo parte de la imagen que elijas en su
              escena (por ejemplo, una foto del producto) o solo de su descripción. Veo puede rechazar fotos de personas: si pasa,
              la toma se reintenta sola sin imagen.
            </p>
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.map((img) => (
                  <div key={img.id} className="space-y-1">
                    <div className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          setImages((cur) => cur.filter((x) => x.id !== img.id));
                          if (personaId === img.id) setPersonaId(null);
                        }}
                        className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white"
                        aria-label="Quitar imagen"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPersonaId(img.id)}
                      className={`flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[11px] cursor-pointer ${
                        persona?.id === img.id ? 'bg-accent/10 text-accent' : 'text-fg-subtle hover:text-fg'
                      }`}
                    >
                      <User className="h-3 w-3" /> {persona?.id === img.id ? 'Persona' : 'Usar como persona'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {voiceMode === 'avatar' && scenes.some((s) => s.type === 'avatar') && (
            <section className="space-y-2 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-[13px] font-semibold text-fg">Movimiento de la persona (HeyGen)</h2>
              <MotionControls
                motionPrompt={motionPrompt}
                onMotionPromptChange={setMotionPrompt}
                expressiveness={expressiveness}
                onExpressivenessChange={setExpressiveness}
              />
            </section>
          )}

          {/* 4. Voz */}
          {voiceMode !== 'native' && (
          <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold text-fg">4. Voz</h2>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="input-clean h-9 w-full px-2 text-[13px]">
              {voices.length === 0 && <option value="">Cargando voces…</option>}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <VoiceModelPanel
              modelId={voiceModel}
              onModelChange={setVoiceModel}
              settings={voiceSettings}
              onSettingsChange={setVoiceSettings}
              text={fullText}
              tool="text-to-video"
            />
          </section>
          )}

          {/* 5. Tomas de apoyo */}
          <section className="space-y-2 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold text-fg">
              {voiceMode === 'native' ? '4. Modelo de video (genera la persona y su voz)' : '5. Modelo para las tomas de apoyo'}
            </h2>
            <div className="grid gap-1.5">
              {availableModels.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                    missingModels.includes(m.id) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                  } ${brollModel === m.id ? 'border-accent bg-accent/5' : 'border-line hover:bg-surface-2'}`}
                >
                  <input
                    type="radio"
                    checked={brollModel === m.id}
                    disabled={missingModels.includes(m.id)}
                    onChange={() => setBrollModel(m.id)}
                  />
                  <span className="flex-1">
                    <span className="block text-[12.5px] font-medium text-fg">{m.name}</span>
                    <span className="block text-[11px] text-fg-subtle">
                      {missingModels.includes(m.id) ? 'Ya no está disponible en OpenRouter.' : m.note}
                    </span>
                  </span>
                  <span className="text-[11px] tabular-nums text-fg-muted">${brollRate(m, voiceMode === 'native').toFixed(3)}/s</span>
                </label>
              ))}
            </div>
            {voiceMode === 'avatar' && (
              <p className="text-[11px] text-fg-subtle">Las escenas donde habla la persona usan HeyGen Avatar IV ($0.05/s).</p>
            )}
            {voiceMode === 'native' && (
              <p className="text-[11px] leading-snug text-fg-subtle">
                Precio con audio incluido. Cada clip genera su propia voz, así que puede sonar distinta entre escenas (la API no
                permite fijar una voz). Si subes la foto de la persona se usa como primer fotograma de cada clip para que se parezca;
                si el modelo la rechaza, la escena se reintenta sin foto.
              </p>
            )}
          </section>

          {/* Resumen y generar */}
          <section className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur">
            <div className="text-[12px] tabular-nums text-fg-muted">
              <span className="block text-fg">
                ~{estimate ? estimate.totalSeconds.toFixed(0) : 0} s · {scenes.length} escenas
              </span>
              <span>
                Costo estimado {estimate ? usd(estimate.totalUSD) : '$0'} (voz {estimate ? usd(estimate.voiceUSD) : '$0'} + clips{' '}
                {estimate ? usd(estimate.clipsUSD) : '$0'})
              </span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !ffmpeg?.available}
              className="btn-primary ml-auto h-10 px-5 text-[13px]"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Iniciando…' : 'Generar video'}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
