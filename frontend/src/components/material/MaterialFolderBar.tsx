'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FolderOpen, FolderPlus, Loader2, X } from 'lucide-react';
import { FolderPickerModal } from './FolderPickerModal';
import { describeKinds, folderName, materialApi, type MaterialInfo } from './material-api';

/**
 * Carpeta de material de un proyecto con Claude (clave `edit:<id>`, `director:<id>`, `studio:<id>`).
 * Va sobre el campo de texto del chat: muestra la carpeta elegida y lo que hay, y deja cambiarla o
 * quitarla. Claude la ve desde su siguiente mensaje.
 */
export function MaterialFolderBar({ clave }: { clave: string }) {
  const [info, setInfo] = useState<MaterialInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await materialApi.get(clave));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la carpeta de material.');
    }
  }, [clave]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async (carpeta: string | null) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await materialApi.set(clave, carpeta));
      setPicking(false);
    } catch (err) {
      if (carpeta) throw err; // el modal muestra el error
      setError(err instanceof Error ? err.message : 'No se pudo quitar la carpeta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      {info?.carpeta ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px]">
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-fg" title={info.carpeta}>
              Material: {folderName(info.carpeta)}
            </span>
            <span className="ml-1.5 text-fg-muted">
              {info.problema ? '' : `${info.total ?? 0}${info.truncado ? '+' : ''} archivos · ${describeKinds(info.tipos)}`}
            </span>
            {info.problema && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <AlertCircle className="h-3 w-3" /> {info.problema}
              </span>
            )}
          </div>
          <button type="button" onClick={() => setPicking(true)} className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface hover:text-fg">
            Cambiar
          </button>
          <button type="button" onClick={() => void save(null)} disabled={busy} className="rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" aria-label="Quitar carpeta de material" title="Quitar carpeta de material">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Elige la carpeta del PC con el material del video (fotos, videos, audios, textos). Claude podrá verla."
        >
          <FolderPlus className="h-3.5 w-3.5" /> Carpeta de material
        </button>
      )}
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      <FolderPickerModal open={picking} initial={info?.carpeta} onClose={() => setPicking(false)} onPick={(ruta) => save(ruta)} />
    </div>
  );
}

/**
 * Para los formularios de creación (aún no hay proyecto): elige la carpeta y la devuelve; quien
 * crea el proyecto la guarda después con `materialApi.set(clave, ruta)`.
 */
export function MaterialFolderField({ value, onChange }: { value: string | null; onChange: (ruta: string | null) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      {value ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-fg" title={value}>
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">Material: {folderName(value)}</span>
          <button type="button" onClick={() => setPicking(true)} className="text-fg-muted hover:text-fg">
            Cambiar
          </button>
          <button type="button" onClick={() => onChange(null)} className="text-fg-subtle hover:text-fg" aria-label="Quitar carpeta de material">
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Elige la carpeta del PC con el material del video. Claude podrá verla."
        >
          <FolderPlus className="h-3.5 w-3.5" /> Carpeta de material
        </button>
      )}
      <FolderPickerModal
        open={picking}
        initial={value}
        onClose={() => setPicking(false)}
        onPick={async (ruta) => {
          // Se valida en el servidor al guardar; aquí basta con que el explorador la aceptara
          onChange(ruta);
          setPicking(false);
        }}
      />
    </>
  );
}
