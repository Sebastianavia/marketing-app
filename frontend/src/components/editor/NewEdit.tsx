'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Clapperboard, FileVideo, FolderOpen, Loader2, Send, UploadCloud, X } from 'lucide-react';
import type { EditProfile } from '@/config/editor-looks';
import type { EditProject } from '@/lib/editor/types';
import { editorApi, uploadEdit, type SystemStatus } from './editor-api';
import { MaterialFolderField } from '@/components/material/MaterialFolderBar';
import { materialApi } from '@/components/material/material-api';
import { LookDots, LookPreview } from './LookPreview';

/**
 * 1. Tu pedido (texto + video)  2. Elige tu perfil  → "Editar video".
 * El video se sube a la carpeta de la edición y el análisis arranca solo.
 */

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.m4v,.webm,.mkv,.avi';
// Pedido por defecto (texto del dueño, 2026-11-11): Claude dirige la edición viral completa
const DEFAULT_PEDIDO =
  'Eres un editor y diseñador experto en videos virales para Reels, TikTok y Shorts: edita este video para que la gente lo vea hasta el final y deje una muy buena impresión, usando con criterio y equilibrio los recursos que consideres necesarios. Pon ayudas visuales animadas basadas en lo que se dice en cada momento (tarjetas, listas que se construyen, cifras, iconos, plantillas y animaciones sincronizadas con la voz, creadas por ti si hacen falta) y subtítulos dinámicos a la altura del cuello con las palabras clave resaltadas. Pon también palabras clave grandes detrás de la persona, recortándola sin fondo en PNG transparente si queda bien. Mantén la cámara viva con acercamientos, punch-ins y cambios de ángulo. Usa pantallas divididas solo cuando aporten, sin abusar, y efectos de sonido virales sincronizados con cada evento visual, con música que acompañe el ritmo. Cada recurso debe durar lo que dura su idea y luego irse; varía los formatos sin repetir siempre lo mismo y evita que algo tape la cara o quede en la zona de botones de la red. Elige tú la paleta y el estilo visual que mejor encajen con este video, y antes de entregar revisa el resultado como un director exigente y corrige lo que no esté a la altura.';

interface Props {
  perfiles: EditProfile[];
  system: SystemStatus | null;
  onCreated: (edit: EditProject) => void;
  onEditProfiles: (id?: string) => void;
}

function duration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

export function NewEdit({ perfiles, system, onCreated, onEditProfiles }: Props) {
  const [pedido, setPedido] = useState(DEFAULT_PEDIDO);
  const [titulo, setTitulo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileSeconds, setFileSeconds] = useState(0);
  const [localVideo, setLocalVideo] = useState<SystemStatus['videos'][number] | null>(null);
  const [picking, setPicking] = useState(false);
  const [perfilId, setPerfilId] = useState<string>(perfiles[0]?.id ?? '');
  const [revisarAntes, setRevisarAntes] = useState(true);
  const [material, setMaterial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const perfil = perfiles.find((p) => p.id === perfilId) ?? perfiles[0];
  const blockers = useMemo(() => {
    const list: string[] = [];
    if (system && !system.ffmpeg) list.push('No se encontró FFmpeg en este PC.');
    if (system && system.ffmpeg && !system.subtitulos) list.push('Tu FFmpeg no puede poner subtítulos (falta libass).');
    if (system && !system.elevenlabs) list.push('Falta ELEVENLABS_API_KEY para transcribir.');
    return list;
  }, [system]);

  const pickFile = async (f: File | null) => {
    setError(null);
    setLocalVideo(null);
    setFile(f);
    setFileSeconds(f ? await duration(f) : 0);
    if (f && !titulo) setTitulo(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60));
  };

  const cost = fileSeconds && system ? (fileSeconds / 60) * system.costoMinuto : null;
  const hasVideo = !!file || !!localVideo;
  const canSend = hasVideo && !!perfil && !busy && blockers.length === 0;

  const send = async () => {
    if (!perfil || !hasVideo) return;
    setBusy(true);
    setError(null);
    const meta = { titulo: titulo.trim(), pedido: pedido.trim(), perfilId: perfil.id, revisarAntes, ...(material ? { carpetaMaterial: material } : {}) };
    try {
      // Antes de subir el video: si la carpeta ya no vale, el error llega claro y sin esperar la subida
      if (material) {
        const b = await materialApi.browse(material);
        if (!b.usable) throw new Error(`Carpeta de material: ${b.problema ?? 'no se puede usar'}`);
      }
      const edit = localVideo
        ? await editorApi.fromProjects({ ...meta, rutaLocal: localVideo.ruta })
        : await uploadEdit(file!, meta, (pct) => setProgress(pct));
      setFile(null);
      setLocalVideo(null);
      setTitulo('');
      setMaterial(null);
      setProgress(null);
      onCreated(edit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la edición.');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid lg:grid-cols-2">
        {/* 1. Pedido */}
        <section className="space-y-4 border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-fg">
            <span className="font-display text-[20px] text-fg-subtle">1</span> Tu pedido
          </h2>
          <label className="block space-y-1 text-[12px] text-fg-muted">
            <span className="block">Describe lo que quieres, como se lo dirías a un editor</span>
            <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={8} className="input-clean w-full resize-y px-3 py-2 text-[13px]" />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
            <MaterialFolderField value={material} onChange={setMaterial} />
            <span>Opcional: tomas de apoyo, logos, música o el guion. Claude las verá (solo con «Claude · mi suscripción»).</span>
          </div>

          {!hasVideo ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void pickFile(f);
              }}
              className={`flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors ${
                dragging ? 'border-accent bg-surface-2' : 'border-line-strong'
              }`}
            >
              <UploadCloud className="h-6 w-6 text-fg-subtle" />
              <p className="text-[13px] text-fg">Arrastra tu video en bruto aquí</p>
              <p className="text-[11px] text-fg-subtle">Hablando a cámara, con errores y todo · MP4, MOV, WEBM · hasta 30 min</p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => input.current?.click()} className="btn-secondary h-8 px-3 text-[12px]">
                  <FileVideo className="h-3.5 w-3.5" /> Elegir archivo
                </button>
                <button type="button" onClick={() => setPicking((v) => !v)} className="btn-secondary h-8 px-3 text-[12px]" disabled={!system?.videos.length}>
                  <FolderOpen className="h-3.5 w-3.5" /> De mis proyectos {system ? `(${system.videos.length})` : ''}
                </button>
              </div>
              <input ref={input} type="file" accept={VIDEO_ACCEPT} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md bg-[#111] text-white/70">
                <Clapperboard className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">{file?.name ?? localVideo?.titulo}</p>
                <p className="text-[11px] text-fg-subtle">
                  {file
                    ? `${fileSeconds ? `${Math.floor(fileSeconds / 60)}:${String(Math.round(fileSeconds % 60)).padStart(2, '0')} · ` : ''}${(file.size / 1024 / 1024).toFixed(1)} MB`
                    : `De Proyectos · ${localVideo?.categoria}`}
                </p>
              </div>
              <button type="button" onClick={() => void pickFile(null)} disabled={busy} className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Quitar video">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {picking && !hasVideo && system && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-1.5 desktop-scroll">
              {system.videos.map((v) => (
                <button
                  key={v.ruta}
                  type="button"
                  onClick={() => {
                    setLocalVideo(v);
                    setFile(null);
                    setFileSeconds(0);
                    setPicking(false);
                    if (!titulo) setTitulo(v.titulo.slice(0, 60));
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12px] hover:bg-surface-2 cursor-pointer"
                >
                  <span className="truncate text-fg">{v.titulo}</span>
                  <span className="shrink-0 text-fg-subtle">{v.categoria}</span>
                </button>
              ))}
            </div>
          )}

          <label className="block space-y-1 text-[12px] text-fg-muted">
            <span className="block">Nombre de la edición</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="Ej.: Reel lanzamiento" className="input-clean h-9 w-full px-3 text-[13px]" />
          </label>

          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-fg">
            <input type="checkbox" checked={revisarAntes} onChange={(e) => setRevisarAntes(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Enséñame el guion antes de crear el video
          </label>
        </section>

        {/* 2. Perfil */}
        <section className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-fg">
              <span className="font-display text-[20px] text-fg-subtle">2</span> Elige tu perfil
            </h2>
            <button type="button" onClick={() => onEditProfiles(perfil?.id)} className="text-[12px] text-fg-muted underline-offset-2 hover:text-fg hover:underline cursor-pointer">
              Editar perfiles →
            </button>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            {perfil && (
              <div className="shrink-0 space-y-1.5">
                <LookPreview look={perfil} width={150} />
                <p className="max-w-[150px] text-[11px] text-fg-subtle">Vista previa aproximada</p>
              </div>
            )}
            <div className="grid flex-1 content-start gap-2 sm:grid-cols-2">
              {perfiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPerfilId(p.id)}
                  aria-pressed={perfil?.id === p.id}
                  className={`space-y-1.5 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                    perfil?.id === p.id ? 'border-accent bg-surface-2' : 'border-line hover:border-fg-subtle'
                  }`}
                >
                  <LookDots look={p} />
                  <span className="block text-[13px] font-medium text-fg">{p.nombre}</span>
                  <span className="line-clamp-2 block text-[11px] text-fg-subtle">{p.descripcion || 'Sin descripción'}</span>
                </button>
              ))}
              {perfiles.length === 0 && (
                <button type="button" onClick={() => onEditProfiles()} className="rounded-xl border border-dashed border-line p-4 text-[12px] text-fg-subtle hover:text-fg">
                  Crea tu primer perfil
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Barra inferior */}
      <div className="flex flex-col gap-3 border-t border-line bg-surface-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-fg-muted">
          <span>
            Perfil <b className="font-medium text-fg">{perfil?.nombre ?? '—'}</b>
          </span>
          <span>
            Formato <b className="font-medium text-fg">{perfil?.formato ?? '—'}</b>
          </span>
          {cost !== null && (
            <span>
              Transcripción aprox. <b className="font-medium text-fg">${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}</b>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {progress !== null && <span className="tabular-nums text-[12px] text-fg-muted">Subiendo {progress}%</span>}
          <button type="button" onClick={send} disabled={!canSend} className="btn-primary h-10 px-5 text-[13px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Editar video
          </button>
        </div>
      </div>

      {(error || blockers.length > 0) && (
        <div className="space-y-1 border-t border-line px-5 py-3 sm:px-6">
          {[...(error ? [error] : []), ...blockers].map((m) => (
            <p key={m} className="flex items-start gap-2 text-[12px] text-rose-600 dark:text-rose-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
