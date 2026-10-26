'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  FolderOpen,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type { AvatarDto } from '@/lib/avatars/avatar-dto';
import { useNavStore } from '@/store/useNavStore';

/**
 * Creación de avatar: cada avatar es una persona (real o creada) con varias fotos
 * que la retratan bien. Luego se elige en "Creación de imágenes" para generarla
 * en cualquier escena manteniendo su cara.
 */

const TIPS = [
  'Cara de frente, con buena luz y sin gafas de sol',
  'Perfil izquierdo y derecho, y tres cuartos',
  'Cuerpo entero y medio cuerpo',
  'Sonriendo y con expresión neutra',
  'Distinta ropa y lugares (para que el modelo no copie el fondo)',
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Algo salió mal.');
  return d as T;
}

export function AvatarsView() {
  const [avatars, setAvatars] = useState<AvatarDto[]>([]);
  const [maxPhotos, setMaxPhotos] = useState(14);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ avatars: AvatarDto[]; maxPhotos: number }>('/api/avatars')
      .then((d) => {
        setAvatars(d.avatars);
        setMaxPhotos(d.maxPhotos);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron leer los avatares.'))
      .finally(() => setLoading(false));
  }, []);

  const replace = (a: AvatarDto) => setAvatars((cur) => cur.map((x) => (x.id === a.id ? a : x)));
  const current = avatars.find((a) => a.id === openId) ?? null;

  if (current) {
    return (
      <AvatarDetail
        avatar={current}
        maxPhotos={maxPhotos}
        onBack={() => setOpenId(null)}
        onChange={replace}
        onDeleted={() => {
          setAvatars((cur) => cur.filter((x) => x.id !== current.id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-fg-subtle">
          {avatars.length} {avatars.length === 1 ? 'avatar' : 'avatares'} · hasta {maxPhotos} fotos cada uno
        </p>
        <button type="button" onClick={() => setCreating(true)} className="btn-primary h-9 px-4 text-[13px]">
          <Plus className="h-4 w-4" /> Nuevo avatar
        </button>
      </div>

      {creating && (
        <NewAvatarForm
          onCancel={() => setCreating(false)}
          onCreated={(a) => {
            setAvatars((cur) => [a, ...cur]);
            setCreating(false);
            setOpenId(a.id);
          }}
        />
      )}

      {error && <ErrorBox text={error} />}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando avatares…
        </div>
      ) : avatars.length === 0 && !creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line p-12 text-[13px] text-fg-subtle hover:text-fg cursor-pointer"
        >
          <UserRound className="h-6 w-6" />
          Todavía no hay avatares. Crea el primero.
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {avatars.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpenId(a.id)}
              className="group overflow-hidden rounded-xl border border-line bg-surface text-left transition-colors hover:border-fg-subtle cursor-pointer"
            >
              <div className="aspect-square bg-surface-2">
                {a.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.coverUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-fg-subtle">
                    <UserRound className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-[13px] font-medium text-fg">{a.name}</p>
                <p className="text-[11px] text-fg-subtle">
                  {a.photos.length} {a.photos.length === 1 ? 'foto' : 'fotos'}
                  {a.photos.length < 5 ? ' · faltan fotos' : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAvatarForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (a: AvatarDto) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ avatar: AvatarDto }>('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      onCreated(d.avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-[13px] font-semibold text-fg">Nuevo avatar</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[12px] text-fg-muted">
          <span className="block">Nombre *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Valentina" className="input-clean h-9 w-full px-3 text-[13px]" />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted">
          <span className="block">Descripción (opcional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej.: mujer de 28 años, pelo castaño ondulado"
            className="input-clean h-9 w-full px-3 text-[13px]"
          />
        </label>
      </div>
      <p className="text-[11px] text-fg-subtle">La descripción se envía al modelo junto con las fotos para ayudarle a mantener la identidad.</p>
      {error && <ErrorBox text={error} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary h-9 px-4 text-[13px]">
          Cancelar
        </button>
        <button type="submit" disabled={busy || name.trim().length < 2} className="btn-primary h-9 px-4 text-[13px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Crear y subir fotos
        </button>
      </div>
    </form>
  );
}

function AvatarDetail({
  avatar,
  maxPhotos,
  onBack,
  onChange,
  onDeleted,
}: {
  avatar: AvatarDto;
  maxPhotos: number;
  onBack: () => void;
  onChange: (a: AvatarDto) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(avatar.name);
  const [description, setDescription] = useState(avatar.description);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const openImages = useNavStore((s) => s.openImagesWithAvatar);

  const dirty = name !== avatar.name || description !== avatar.description;
  const free = maxPhotos - avatar.photos.length;

  const patch = async (body: Record<string, string>) => {
    setError(null);
    try {
      const d = await api<{ avatar: AvatarDto }>(`/api/avatars/${avatar.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onChange(d.avatar);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name));
    const take = list.slice(0, Math.max(0, free));
    const errors: string[] = [];
    if (list.length > take.length) errors.push(`Solo caben ${free} fotos más (máximo ${maxPhotos}); el resto no se subió.`);
    setUploading({ done: 0, total: take.length });
    let last: AvatarDto | null = null;
    for (let i = 0; i < take.length; i++) {
      const fd = new FormData();
      fd.append('file', take[i]);
      try {
        last = (await api<{ avatar: AvatarDto }>(`/api/avatars/${avatar.id}/photos`, { method: 'POST', body: fd })).avatar;
        onChange(last);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `${take[i].name}: no se pudo subir.`);
      }
      setUploading({ done: i + 1, total: take.length });
    }
    setUploading(null);
    if (input.current) input.current.value = '';
    if (errors.length) setError(errors.join(' '));
  };

  const removePhoto = async (file: string) => {
    if (!confirm('¿Quitar esta foto del avatar? Se mueve a la papelera de avatares.')) return;
    try {
      const d = await api<{ avatar: AvatarDto }>(`/api/avatars/${avatar.id}/photos?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
      onChange(d.avatar);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo quitar.');
    }
  };

  const removeAvatar = async () => {
    if (!confirm(`¿Eliminar el avatar "${avatar.name}"? La carpeta se mueve a Avatares\\_papelera, no se borra del disco.`)) return;
    try {
      await api(`/api/avatars/${avatar.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  };

  const openFolder = () =>
    fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: avatar.dir }),
    }).catch(() => {});

  return (
    <div className="w-full max-w-5xl space-y-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg cursor-pointer">
        <ArrowLeft className="h-4 w-4" /> Todos los avatares
      </button>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[12px] text-fg-muted">
            <span className="block">Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-clean h-9 w-full px-3 text-[13px]" />
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            <span className="block">Descripción</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej.: hombre de 35 años, barba corta, ojos verdes"
              className="input-clean h-9 w-full px-3 text-[13px]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={async () => {
                if (await patch({ name, description })) {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1500);
                }
              }}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              Guardar cambios
            </button>
          )}
          {saved && <span className="text-[12px] text-fg-muted">Guardado</span>}
          <button type="button" onClick={openFolder} className="btn-secondary h-8 px-3 text-[12px]">
            <FolderOpen className="h-3.5 w-3.5" /> Carpeta
          </button>
          <button type="button" onClick={removeAvatar} className="btn-secondary h-8 px-3 text-[12px] text-rose-600 dark:text-rose-400">
            <Trash2 className="h-3.5 w-3.5" /> Eliminar avatar
          </button>
          <button
            type="button"
            onClick={() => openImages(avatar.id)}
            disabled={avatar.photos.length === 0}
            className="btn-primary ml-auto h-8 px-3 text-[12px]"
          >
            <Sparkles className="h-3.5 w-3.5" /> Crear imágenes con este avatar
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">
            Fotos <span className="font-normal text-fg-subtle">({avatar.photos.length}/{maxPhotos})</span>
          </h2>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <button type="button" disabled={free <= 0 || !!uploading} onClick={() => input.current?.click()} className="btn-secondary h-8 px-3 text-[12px]">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? `Subiendo ${uploading.done}/${uploading.total}` : 'Subir fotos'}
          </button>
        </div>

        <details className="text-[12px] text-fg-muted">
          <summary className="cursor-pointer text-fg-subtle hover:text-fg">Qué fotos subir para que salga idéntica (8–14 recomendado)</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>

        {error && <ErrorBox text={error} />}

        {avatar.photos.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line p-10 text-[12px] text-fg-subtle hover:text-fg cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Sube varias fotos a la vez (JPG, PNG o WEBP)
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {avatar.photoUrls.map((p) => {
              const isCover = p.file === avatar.cover;
              return (
                <div key={p.file} className={`relative aspect-square overflow-hidden rounded-lg border bg-surface-2 ${isCover ? 'border-accent' : 'border-line'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <button
                    type="button"
                    onClick={() => !isCover && patch({ cover: p.file })}
                    title={isCover ? 'Foto de portada (se envía primero)' : 'Usar como portada'}
                    className={`absolute left-1 top-1 rounded p-1 ${isCover ? 'bg-accent text-accent-fg' : 'bg-black/50 text-white hover:bg-black/70'}`}
                  >
                    <Star className="h-3 w-3" fill={isCover ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removePhoto(p.file)}
                    className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white hover:bg-black/70"
                    aria-label="Quitar foto"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-fg-subtle">
          Se guardan en tu carpeta de proyectos, dentro de <span className="font-mono">Avatares</span>. La estrella marca la portada, que se envía
          primero al modelo.
        </p>
      </section>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text}</p>
    </div>
  );
}
