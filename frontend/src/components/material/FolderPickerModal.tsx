'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Check, Folder, FolderOpen, HardDrive, Loader2, X } from 'lucide-react';
import { describeKinds, materialApi, type BrowseResult } from './material-api';

/**
 * Explorador de carpetas del PC (la app corre en local: no hay diálogo nativo en el navegador).
 * Muestra subcarpetas y cuántos archivos hay en la actual; «Usar esta carpeta» solo se activa si
 * el servidor la acepta como carpeta de material.
 */
export function FolderPickerModal({
  open,
  initial,
  title = 'Carpeta de material',
  hint = 'Elige la carpeta donde están las fotos, videos, audios y textos para este video. Claude podrá verlos (solo leerlos).',
  onClose,
  onPick,
  children,
  hidePick = false,
}: {
  open: boolean;
  initial?: string | null;
  title?: string;
  hint?: string;
  onClose: () => void;
  onPick: (ruta: string) => void | Promise<void>;
  /** Contenido extra bajo la lista (p. ej. las imágenes de la carpeta en UGC). */
  children?: (data: BrowseResult) => React.ReactNode;
  /** Sin botón «Usar esta carpeta» (UGC: se elige una imagen, no la carpeta). */
  hidePick?: boolean;
}) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(async (ruta?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await materialApi.browse(ruta);
      setData(d);
      setTyped(d.ruta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la carpeta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void go(initial ?? undefined), 0);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, initial, go, onClose]);

  if (!open) return null;

  const pick = async () => {
    if (!data?.usable) return;
    setSaving(true);
    setError(null);
    try {
      await onPick(data.ruta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo usar esa carpeta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <FolderOpen className="h-4 w-4 text-accent" /> {title}
            </h2>
            <p className="mt-1 text-[12px] text-fg-muted">{hint}</p>
          </div>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {data && (
          <div className="flex flex-wrap gap-1.5">
            {data.raices.map((r) => (
              <button key={r.ruta} type="button" onClick={() => void go(r.ruta)} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg">
                <HardDrive className="h-3 w-3" /> {r.nombre}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) void go(typed.trim());
          }}
        >
          <button type="button" disabled={!data?.padre || loading} onClick={() => data?.padre && void go(data.padre)} className="btn-secondary h-9 w-9 shrink-0 px-0" aria-label="Subir un nivel" title="Subir un nivel">
            <ArrowUp className="h-4 w-4" />
          </button>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className="input-clean h-9 flex-1 px-3 font-mono text-[12px]" aria-label="Ruta de la carpeta" placeholder="Pega una ruta, p. ej. D:\Material\Campaña" />
          <button type="submit" className="btn-secondary h-9 px-3 text-[12px]">
            Ir
          </button>
        </form>

        <div className="desktop-scroll min-h-[180px] flex-1 overflow-y-auto rounded-lg border border-line bg-surface-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : data && data.carpetas.length ? (
            <ul>
              {data.carpetas.map((c) => (
                <li key={c.ruta}>
                  <button type="button" onClick={() => void go(c.ruta)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg hover:bg-surface">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className="truncate">{c.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[12px] text-fg-muted">{data ? 'Sin subcarpetas.' : ''}</p>
          )}
        </div>

        {data && children?.(data)}

        {data && (
          <p className="text-[12px] text-fg-muted">
            En esta carpeta: {data.archivos ? `${data.archivos} archivo${data.archivos === 1 ? '' : 's'} (${describeKinds(data.tipos)})` : 'ningún archivo suelto'}
            {' '}· también cuenta lo que haya en sus subcarpetas.
          </p>
        )}
        {(error || (!hidePick && data && !data.usable && data.problema)) && <p className="text-[12px] text-rose-600 dark:text-rose-400">{error ?? data?.problema}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary h-9 px-4 text-[12px]">
            Cancelar
          </button>
          {!hidePick && (
            <button type="button" onClick={() => void pick()} disabled={!data?.usable || saving || loading} className="btn-primary h-9 px-4 text-[12px]">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Usar esta carpeta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
