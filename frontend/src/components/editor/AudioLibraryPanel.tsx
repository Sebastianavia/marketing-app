'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, Music2, Pause, Play, RotateCcw, Upload, X } from 'lucide-react';

/** Mismos datos que lib/editor/audio-library.ts (sin importar el módulo de servidor). */
type Kind = 'efecto' | 'musica' | 'ambiente';
const KINDS: Array<[Kind, string]> = [
  ['efecto', 'Efectos'],
  ['musica', 'Música'],
  ['ambiente', 'Ambientes'],
];
interface Item {
  id: string;
  nombre: string;
  tipo: Kind;
  etiquetas: string[];
  licencia: string;
  fuente?: string;
  nota?: string;
  soloEnApp?: boolean;
  duracion: number;
  bpm?: number;
  subidoPor: string;
  fecha: string;
  estado: 'activa' | 'retirada';
}
interface Library {
  version: number;
  items: Item[];
}
type Data = { biblioteca: Library; compartida: boolean; aviso?: string };

const API = '/api/editor/audio-library';

async function readJson(r: Response): Promise<Data> {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo usar la biblioteca.');
  return d as Data;
}

const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);

interface Draft {
  file: File | null;
  nombre: string;
  tipo: Kind;
  etiquetas: string;
  licencia: string;
  fuente: string;
  nota: string;
  soloEnApp: boolean;
}
const emptyDraft = (): Draft => ({ file: null, nombre: '', tipo: 'efecto', etiquetas: '', licencia: '', fuente: '', nota: '', soloEnApp: false });

/**
 * Biblioteca de audio del equipo: efectos, música y ambientes reales (con licencia) que Claude puede
 * usar en sus ediciones. Compartida por todos en R2, como el manual.
 */
export function AudioLibraryPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Kind | 'todo'>('todo');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await readJson(await fetch(API, { cache: 'no-store' })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la biblioteca.');
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Un solo <audio> montado mientras algo suena: pausar = desmontarlo
  const toggle = (id: string) => setPlaying((cur) => (cur === id ? null : id));

  const upload = async () => {
    if (!draft?.file) return;
    setBusy('subir');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('archivo', draft.file);
      fd.append(
        'datos',
        JSON.stringify({
          nombre: draft.nombre.trim(),
          tipo: draft.tipo,
          etiquetas: draft.etiquetas.split(',').map((t) => t.trim()).filter(Boolean),
          licencia: draft.licencia.trim(),
          fuente: draft.fuente.trim() || undefined,
          nota: draft.nota.trim() || undefined,
          soloEnApp: draft.soloEnApp,
        })
      );
      setData(await readJson(await fetch(API, { method: 'POST', body: fd })));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir.');
    } finally {
      setBusy(null);
    }
  };

  const setState = async (id: string, accion: 'retirar' | 'reactivar') => {
    setBusy(id);
    setError(null);
    try {
      setData(await readJson(await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, id }) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(null);
    }
  };

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando la biblioteca…
      </div>
    );
  }
  const items = data?.biblioteca.items ?? [];
  const visible = items.filter((it) => (showRetired ? it.estado === 'retirada' : it.estado === 'activa')).filter((it) => filter === 'todo' || it.tipo === filter);
  const count = (k: Kind) => items.filter((it) => it.estado === 'activa' && it.tipo === k).length;
  const canUpload = !!draft?.file && draft.nombre.trim().length >= 2 && draft.licencia.trim().length >= 3;

  return (
    <section className="space-y-5">
      {playing && <audio key={playing} src={`${API}?id=${encodeURIComponent(playing)}`} autoPlay onEnded={() => setPlaying(null)} onError={() => setPlaying(null)} className="hidden" />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[75ch] space-y-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Music2 className="h-4 w-4 text-accent" /> Biblioteca de audio
          </h2>
          <p className="text-[12px] text-fg-muted">
            Efectos, música y ambientes reales que Claude puede usar en las ediciones, además de los que genera la app. Cada audio necesita su licencia: sube solo lo que el equipo puede usar
            (CC0, Pixabay, bibliotecas pagadas por Lulo…). Los sonidos en tendencia de TikTok o Instagram márcalos «solo en la app»: Claude los recomienda pero no los mete en el video.
            {data?.compartida ? ' Compartida por todo el equipo.' : ''}
          </p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft(emptyDraft())} className="btn-primary h-9 px-3 text-[12px]">
            <Upload className="h-3.5 w-3.5" /> Subir audio
          </button>
        )}
      </div>

      {data?.aviso && <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-fg-muted">{data.aviso}</p>}
      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-fg-muted hover:border-accent/60">
            <Upload className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">{draft.file ? draft.file.name : 'Elige un archivo (.mp3, .wav, .m4a, .aac, .ogg, .flac · máx. 60 MB)'}</span>
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setDraft((d) => d && { ...d, file: f, nombre: d.nombre || (f ? f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : '') });
              }}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} maxLength={80} placeholder="Nombre (p. ej. «Whoosh largo cinematográfico»)" className="input-clean h-9 px-3 text-[13px]" />
            <div className="flex rounded-lg border border-line p-0.5 text-[12px]" role="radiogroup" aria-label="Tipo de audio">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={draft.tipo === k} onClick={() => setDraft({ ...draft, tipo: k })} className={`rounded-md px-3 py-1.5 ${draft.tipo === k ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <input value={draft.licencia} onChange={(e) => setDraft({ ...draft, licencia: e.target.value })} maxLength={200} placeholder="Licencia (obligatoria): CC0, Pixabay License, Epidemic (cuenta Lulo)…" className="input-clean h-9 w-full px-3 text-[12px]" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={draft.etiquetas} onChange={(e) => setDraft({ ...draft, etiquetas: e.target.value })} placeholder="Etiquetas separadas por comas: transición, épico, gym" className="input-clean h-9 px-3 text-[12px]" />
            <input value={draft.fuente} onChange={(e) => setDraft({ ...draft, fuente: e.target.value })} maxLength={300} placeholder="Fuente (URL o sitio, opcional)" className="input-clean h-9 px-3 text-[12px]" />
          </div>
          <input value={draft.nota} onChange={(e) => setDraft({ ...draft, nota: e.target.value })} maxLength={300} placeholder="Cuándo usarlo (lo lee Claude): «para revelar una cifra», «intro de tutoriales»…" className="input-clean h-9 w-full px-3 text-[12px]" />
          <label className="flex items-center gap-2 text-[12px] text-fg-muted">
            <input type="checkbox" checked={draft.soloEnApp} onChange={(e) => setDraft({ ...draft, soloEnApp: e.target.checked })} />
            Sonido en tendencia: solo se puede añadir desde la app de la red al publicar (no va en el MP4)
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn-secondary h-8 px-3 text-[12px]">
              Cancelar
            </button>
            <button type="button" onClick={() => void upload()} disabled={!canUpload || busy === 'subir'} className="btn-primary h-8 px-3 text-[12px]">
              {busy === 'subir' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Subir
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {(['todo', ...KINDS.map(([k]) => k)] as Array<Kind | 'todo'>).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md border px-2.5 py-1 ${filter === k ? 'border-accent/50 bg-surface-2 text-fg' : 'border-line text-fg-muted hover:text-fg'}`}>
            {k === 'todo' ? 'Todo' : `${KINDS.find(([x]) => x === k)![1]} · ${count(k)}`}
          </button>
        ))}
        <button type="button" onClick={() => setShowRetired((v) => !v)} className="ml-auto text-fg-subtle hover:text-fg-muted">
          {showRetired ? 'Ver activos' : `Ver retirados (${items.filter((it) => it.estado === 'retirada').length})`}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg-muted">
          {showRetired ? 'No hay audios retirados.' : 'Todavía no hay audios aquí. Mientras tanto Claude usa los efectos y la música que genera la app.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((it) => (
            <li key={it.id} className={`flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 ${it.estado === 'retirada' ? 'opacity-60' : ''}`}>
              <button type="button" onClick={() => toggle(it.id)} className="mt-0.5 rounded-full border border-line p-1.5 text-fg-muted hover:text-fg" aria-label={playing === it.id ? `Pausar ${it.nombre}` : `Escuchar ${it.nombre}`}>
                {playing === it.id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg">
                  <span className="font-medium">{it.nombre}</span>
                  <span className="text-[11px] text-fg-subtle">
                    {KINDS.find(([k]) => k === it.tipo)![1].replace(/s$/, '')} · {fmtDur(it.duracion)}
                    {it.bpm ? ` · ${it.bpm} BPM` : ''}
                  </span>
                  {it.soloEnApp && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">solo en la app</span>}
                </p>
                {it.nota && <p className="text-[12px] text-fg-muted">{it.nota}</p>}
                <p className="text-[11px] text-fg-subtle">
                  {it.etiquetas.length ? `${it.etiquetas.join(', ')} · ` : ''}Licencia: {it.licencia}
                  {it.fuente ? ` · ${it.fuente}` : ''} · {it.subidoPor}, {new Date(it.fecha).toLocaleDateString('es')}
                </p>
              </div>
              {it.estado === 'activa' ? (
                <button type="button" disabled={busy === it.id} onClick={() => void setState(it.id, 'retirar')} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Retirar ${it.nombre}`} title="Retirar (Claude dejará de usarlo)">
                  {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <button type="button" disabled={busy === it.id} onClick={() => void setState(it.id, 'reactivar')} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Reactivar ${it.nombre}`}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
