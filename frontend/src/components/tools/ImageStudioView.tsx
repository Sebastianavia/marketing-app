'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Download, FolderOpen, ImagePlus, Loader2, Plus, UserRound, X } from 'lucide-react';
import type { AvatarDto } from '@/lib/avatars/avatar-dto';
import { useNavStore } from '@/store/useNavStore';
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_ASPECTS,
  IMAGE_MODELS,
  REALISM_SUFFIX,
  getImageModel,
} from '@/config/image-models';

/**
 * Creación de imágenes: elige un avatar guardado (sus fotos van primero para mantener la cara)
 * y/o sube varias fotos de referencia (producto, persona, lugar…), escribe qué quieres
 * y el modelo genera imágenes nuevas basadas en ellas. Todo se guarda en la biblioteca.
 */

interface RefImage {
  id: string;
  name: string;
  dataUrl: string;
}

interface Result {
  url: string;
  path: string;
  costUSD: number;
  prompt: string;
}

const usd = (n: number) => `$${n.toFixed(3)}`;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    r.readAsDataURL(file);
  });
}

export function ImageStudioView() {
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL);
  const [aspect, setAspect] = useState<string>('1:1');
  const [resolution, setResolution] = useState('1K');
  const [count, setCount] = useState(1);
  const [realism, setRealism] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const [avatars, setAvatars] = useState<AvatarDto[] | null>(null);
  // Si venimos de "Crear imágenes con este avatar", arranca con ese avatar elegido.
  const [avatarId, setAvatarId] = useState<string | null>(() => useNavStore.getState().pendingAvatarId);
  const takePendingAvatar = useNavStore((s) => s.takePendingAvatar);
  const openTool = useNavStore((s) => s.openTool);

  useEffect(() => {
    takePendingAvatar();
    fetch('/api/avatars')
      .then((r) => r.json())
      .then((d) => setAvatars(Array.isArray(d.avatars) ? d.avatars.filter((a: AvatarDto) => a.photos.length > 0) : []))
      .catch(() => setAvatars([]));
  }, [takePendingAvatar]);

  const spec = getImageModel(model);
  const avatar = avatars?.find((a) => a.id === avatarId) ?? null;
  /** Con avatar se reserva al menos un hueco para sus fotos. */
  const maxExtra = avatar ? spec.maxRefs - 1 : spec.maxRefs;
  const avatarUsed = avatar ? Math.min(avatar.photos.length, spec.maxRefs - refs.length) : 0;
  const res = spec.resolutions.includes(resolution) ? resolution : spec.resolutions[0];
  const unit = spec.pricePerImage[res] ?? 0;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const next: RefImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} pesa más de 10 MB.`);
        continue;
      }
      next.push({ id: Math.random().toString(36).slice(2), name: f.name, dataUrl: await readAsDataUrl(f) });
    }
    setRefs((cur) => {
      const all = [...cur, ...next];
      if (all.length > maxExtra) setError(`Caben hasta ${maxExtra} referencias extra; se tomaron las primeras.`);
      return all.slice(0, maxExtra);
    });
  };

  const generate = async () => {
    setError(null);
    if (prompt.trim().length < 3) return setError('Escribe qué imagen quieres.');
    setBusy(true);
    try {
      const r = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          references: refs.map((x) => x.dataUrl),
          aspectRatio: aspect,
          resolution: res,
          count,
          realism,
          ...(avatar ? { avatarId: avatar.id } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo generar la imagen.');
      setResults((cur) => [...d.images.map((im: Omit<Result, 'prompt'>) => ({ ...im, prompt })), ...cur]);
      if (d.errors?.length) setError(`Algunas imágenes fallaron: ${d.errors[0]}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.');
    } finally {
      setBusy(false);
    }
  };

  const addAsReference = async (r: Result) => {
    if (refs.length >= maxExtra) return setError(`Máximo ${maxExtra} referencias extra.`);
    const blob = await fetch(r.url).then((x) => x.blob());
    const dataUrl = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(blob);
    });
    setRefs((cur) => [...cur, { id: Math.random().toString(36).slice(2), name: 'generada.png', dataUrl }]);
  };

  const openFolder = (p: string) =>
    fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p.replace(/[\\/][^\\/]*$/, '') }),
    }).catch(() => {});

  return (
    <div className="w-full max-w-4xl space-y-6">
      {/* Avatar */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">
            1. Avatar <span className="font-normal text-fg-subtle">(opcional)</span>
          </h2>
          <button type="button" onClick={() => openTool('avatars')} className="btn-secondary h-8 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Crear o editar avatares
          </button>
        </div>
        {avatars === null ? (
          <p className="flex items-center gap-2 text-[12px] text-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando avatares…
          </p>
        ) : avatars.length === 0 ? (
          <p className="text-[12px] text-fg-subtle">Aún no tienes avatares con fotos. Créalos en «Creación de avatar» para generar siempre a la misma persona.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {avatars.map((a) => {
              const on = a.id === avatarId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAvatarId(on ? null : a.id)}
                  className={`relative w-24 shrink-0 overflow-hidden rounded-lg border text-left cursor-pointer ${on ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-fg-subtle'}`}
                >
                  <div className="aspect-square bg-surface-2">
                    {a.coverUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={a.coverUrl} alt={a.name} className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="m-auto mt-8 h-6 w-6 text-fg-subtle" />
                    )}
                  </div>
                  <p className="truncate px-2 py-1 text-[11px] text-fg">{a.name}</p>
                  {on && (
                    <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-fg">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {avatar && (
          <p className="text-[11px] text-fg-subtle">
            Se enviarán {avatarUsed} de sus {avatar.photos.length} fotos ({avatarUsed === 1 ? 'imagen 1' : `imágenes 1–${avatarUsed}`}) para mantener su cara
            {avatarUsed < avatar.photos.length ? ' (las referencias extra ocupan el resto de huecos)' : ''}. En el texto puedes decir simplemente «ella» o «él».
          </p>
        )}
      </section>

      {/* Referencias */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">
            2. {avatar ? 'Referencias extra' : 'Imágenes de referencia'}{' '}
            <span className="font-normal text-fg-subtle">({refs.length}/{maxExtra}, opcional)</span>
          </h2>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <button type="button" onClick={() => input.current?.click()} className="btn-secondary h-8 px-3 text-[12px]">
            <ImagePlus className="h-3.5 w-3.5" /> Subir
          </button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          {avatar
            ? `Producto, ropa, lugar o estilo. Empiezan en la imagen ${avatarUsed + 1}, p. ej. “ella sosteniendo el producto de la imagen ${avatarUsed + 1}”.`
            : 'Producto, persona, lugar, estilo… En el texto puedes referirte a ellas, p. ej. “la persona de la imagen 1 sosteniendo el producto de la imagen 2”.'}
        </p>
        {refs.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {refs.map((r, i) => (
              <div key={r.id} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.dataUrl} alt={r.name} className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">{i + 1 + avatarUsed}</span>
                <button
                  type="button"
                  onClick={() => setRefs((cur) => cur.filter((x) => x.id !== r.id))}
                  className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white"
                  aria-label="Quitar referencia"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line p-6 text-[12px] text-fg-subtle hover:text-fg cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Sube varias imágenes a la vez (hasta {maxExtra})
          </button>
        )}
      </section>

      {/* Prompt y ajustes */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[13px] font-semibold text-fg">3. ¿Qué imagen quieres?</h2>
        <textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            avatar
              ? `Ej.: ${avatar.name} caminando por un jardín al atardecer, vestido de lino blanco, plano medio, luz dorada, mirando a cámara y sonriendo.`
              : 'Ej.: La mujer de la imagen 1 sosteniendo la crema de la imagen 2 en un baño luminoso por la mañana, plano medio, mirando a cámara.'
          }
          className="input-clean w-full resize-y p-3 text-[13px] leading-relaxed"
        />
        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-fg-muted">
          <input type="checkbox" checked={realism} onChange={(e) => setRealism(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="text-fg">Máximo realismo</span> — añade al final: <em>“{REALISM_SUFFIX}”</em>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-[12px] text-fg-muted sm:col-span-2">
            <span className="block">Modelo</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="input-clean h-9 w-full px-2 text-[13px]">
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            <span className="block">Formato</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="input-clean h-9 w-full px-2 text-[13px]">
              {IMAGE_ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            <span className="block">Resolución</span>
            <select value={res} onChange={(e) => setResolution(e.target.value)} className="input-clean h-9 w-full px-2 text-[13px]">
              {spec.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-fg-subtle">{spec.note}</p>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[12px] text-fg-muted">
            Cantidad
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="input-clean h-8 px-2 text-[13px]">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[12px] tabular-nums text-fg-muted">≈ {usd(unit * count)}</span>
          <button type="button" onClick={generate} disabled={busy} className="btn-primary ml-auto h-10 px-5 text-[13px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? 'Generando…' : count > 1 ? `Generar ${count} imágenes` : 'Generar imagen'}
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-fg">Resultados (guardados en tu carpeta Generados)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {results.map((r) => (
              <figure key={r.path} className="overflow-hidden rounded-xl border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.prompt} className="w-full bg-surface-2 object-contain" />
                <figcaption className="flex flex-wrap items-center gap-2 p-3 text-[11px] text-fg-muted">
                  <span className="tabular-nums">{usd(r.costUSD)}</span>
                  <a href={r.url} download className="ml-auto flex items-center gap-1 hover:text-fg">
                    <Download className="h-3.5 w-3.5" /> Descargar
                  </a>
                  <button type="button" onClick={() => openFolder(r.path)} className="flex items-center gap-1 hover:text-fg cursor-pointer">
                    <FolderOpen className="h-3.5 w-3.5" /> Carpeta
                  </button>
                  <button type="button" onClick={() => addAsReference(r)} className="flex items-center gap-1 hover:text-fg cursor-pointer">
                    <Plus className="h-3.5 w-3.5" /> Usar como referencia
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
