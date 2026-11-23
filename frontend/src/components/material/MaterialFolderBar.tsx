'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FolderOpen, FolderPlus, Loader2, Tag, X } from 'lucide-react';
import { FolderPickerModal } from './FolderPickerModal';
import { describeKinds, folderName, materialApi, type MaterialInfo, type TaggedFolderInput } from './material-api';

const TAG_SUGGESTIONS = [
  'Resultados de estudiantes',
  'Resultados de clientes',
  'Testimonios',
  'Capturas y pruebas',
  'Tomas de apoyo (B-roll)',
];

/**
 * Carpeta de material de un proyecto con Claude (clave `edit:<id>`, `director:<id>`, `studio:<id>`).
 * Va sobre el campo de texto del chat: muestra la carpeta elegida, las carpetas extra con etiqueta
 * (que Claude solo usa cuando el guion/pedido/material menciona ese tema) y deja cambiarlas o quitarlas.
 */
export function MaterialFolderBar({ clave }: { clave: string }) {
  const [info, setInfo] = useState<MaterialInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickingTaggedIdx, setPickingTaggedIdx] = useState<number | 'new' | null>(null);
  const [newTagDraft, setNewTagDraft] = useState('');
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

  const currentExtras = (): TaggedFolderInput[] =>
    (info?.extras ?? []).map((e) => ({ carpeta: e.carpeta, etiqueta: e.etiqueta }));

  const saveExtras = async (next: TaggedFolderInput[]) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await materialApi.setExtras(clave, next));
      setPickingTaggedIdx(null);
      setNewTagDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la carpeta con etiqueta.');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const extras = info?.extras ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {info?.carpeta ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px]">
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

        <button
          type="button"
          onClick={() => {
            setNewTagDraft('');
            setPickingTaggedIdx('new');
          }}
          disabled={busy || extras.length >= 12}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Agrega una carpeta temática con etiqueta (ej. Resultados de estudiantes, Resultados de clientes). Claude solo la usará si las instrucciones, el guion o la carpeta de material indican que en esa parte va ese tema."
        >
          <Tag className="h-3.5 w-3.5" /> + Carpeta con etiqueta
        </button>
      </div>

      {extras.length > 0 && (
        <div className="space-y-1">
          {extras.map((ex, idx) => (
            <div key={`${ex.carpeta}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/70 px-2.5 py-1.5 text-[11px]">
              <Tag className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-fg" title="Etiqueta / tema: Claude solo usa esta carpeta cuando el guion, pedido o material menciona este tema">
                {ex.etiqueta}
              </span>
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium text-fg" title={ex.carpeta}>
                  {folderName(ex.carpeta)}
                </span>
                <span className="ml-1.5 text-fg-muted">
                  {ex.problema ? '' : `${ex.total ?? 0}${ex.truncado ? '+' : ''} archivos · ${describeKinds(ex.tipos)}`}
                </span>
                {ex.problema && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                    <AlertCircle className="h-3 w-3" /> {ex.problema}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  const nueva = window.prompt('Etiqueta / tema de esta carpeta (Claude solo la usará cuando el guion o las instrucciones hablen de esto):', ex.etiqueta);
                  if (nueva && nueva.trim() && nueva.trim() !== ex.etiqueta) {
                    const next = currentExtras();
                    next[idx] = { ...next[idx], etiqueta: nueva.trim().slice(0, 80) };
                    void saveExtras(next).catch(() => undefined);
                  }
                }}
                className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface hover:text-fg"
              >
                Etiqueta
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewTagDraft(ex.etiqueta);
                  setPickingTaggedIdx(idx);
                }}
                className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface hover:text-fg"
              >
                Carpeta
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = currentExtras().filter((_, i) => i !== idx);
                  void saveExtras(next).catch(() => undefined);
                }}
                disabled={busy}
                className="rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-fg"
                aria-label={`Quitar carpeta ${ex.etiqueta}`}
                title="Quitar carpeta etiquetada"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      <FolderPickerModal open={picking} initial={info?.carpeta} onClose={() => setPicking(false)} onPick={(ruta) => save(ruta)} />
      <TaggedFolderPickerModal
        open={pickingTaggedIdx !== null}
        initialFolder={typeof pickingTaggedIdx === 'number' ? extras[pickingTaggedIdx]?.carpeta : info?.carpeta}
        initialTag={typeof pickingTaggedIdx === 'number' ? (extras[pickingTaggedIdx]?.etiqueta ?? '') : newTagDraft}
        onClose={() => setPickingTaggedIdx(null)}
        onPick={async (ruta, etiqueta) => {
          const next = currentExtras();
          if (typeof pickingTaggedIdx === 'number') {
            next[pickingTaggedIdx] = { carpeta: ruta, etiqueta };
          } else {
            next.push({ carpeta: ruta, etiqueta });
          }
          await saveExtras(next);
        }}
      />
    </div>
  );
}

/**
 * Modal que permite elegir una carpeta adicional y asignarle un tag/etiqueta temática
 * (ej. "Resultados de estudiantes", "Resultados de clientes", etc.).
 */
function TaggedFolderPickerModal({
  open,
  initialFolder,
  initialTag,
  onClose,
  onPick,
}: {
  open: boolean;
  initialFolder?: string | null;
  initialTag: string;
  onClose: () => void;
  onPick: (ruta: string, etiqueta: string) => void | Promise<void>;
}) {
  const [tag, setTag] = useState(initialTag);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTag(initialTag);
      setTagError(null);
    }
  }, [open, initialTag]);

  return (
    <FolderPickerModal
      open={open}
      initial={initialFolder}
      title="Carpeta temática con etiqueta (opcional)"
      hint="Ponle una etiqueta (ej. «Resultados de estudiantes», «Resultados de clientes», «Testimonios»). Claude NO tocará esta carpeta a menos que en las instrucciones, en lo que se dice en el guion o en un documento de la carpeta de material principal se indique o mencione ese tema."
      onClose={onClose}
      onPick={async (ruta) => {
        const clean = tag.trim() || folderName(ruta);
        if (!clean) {
          setTagError('Escribe una etiqueta para saber de qué es esta carpeta.');
          throw new Error('Escribe una etiqueta para saber de qué es esta carpeta.');
        }
        await onPick(ruta, clean.slice(0, 80));
      }}
    >
      {(data) => (
        <div className="space-y-2 rounded-xl border border-line bg-surface-2/60 p-3">
          <label className="block space-y-1 text-[12px]">
            <span className="flex items-center gap-1.5 font-medium text-fg">
              <Tag className="h-3.5 w-3.5 text-accent" /> Etiqueta / tema de esta carpeta
            </span>
            <input
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setTagError(null);
              }}
              maxLength={80}
              placeholder={`Ej.: Resultados de estudiantes (si lo dejas vacío se usará «${folderName(data.ruta)}»)`}
              className="input-clean h-9 w-full px-3 text-[12px]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-subtle">Sugerencias:</span>
            {TAG_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setTag(s);
                  setTagError(null);
                }}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                  tag.trim().toLowerCase() === s.toLowerCase()
                    ? 'border-accent bg-accent/15 font-medium text-fg'
                    : 'border-line text-fg-muted hover:bg-surface hover:text-fg'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {tagError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{tagError}</p>}
        </div>
      )}
    </FolderPickerModal>
  );
}

/**
 * Para los formularios de creación (aún no hay proyecto): elige la carpeta principal y opcionalmente
 * carpetas extra con etiqueta; quien crea el proyecto las envía o las guarda con `materialApi`.
 */
export function MaterialFolderField({
  value,
  onChange,
  taggedFolders,
  onTaggedFoldersChange,
}: {
  value: string | null;
  onChange: (ruta: string | null) => void;
  taggedFolders?: TaggedFolderInput[];
  onTaggedFoldersChange?: (next: TaggedFolderInput[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pickingTaggedIdx, setPickingTaggedIdx] = useState<number | 'new' | null>(null);
  const extras = taggedFolders ?? [];

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

      {onTaggedFoldersChange && (
        <>
          {extras.map((ex, idx) => (
            <span
              key={`${ex.carpeta}-${idx}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-fg"
              title={`${ex.etiqueta}: ${ex.carpeta} (Claude solo la usa si el guion, las instrucciones o la carpeta de material indican que en esa parte va este tema)`}
            >
              <Tag className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="rounded bg-accent/15 px-1.5 py-0.2 font-medium text-fg">{ex.etiqueta}</span>
              <span className="truncate text-fg-muted">{folderName(ex.carpeta)}</span>
              <button
                type="button"
                onClick={() => setPickingTaggedIdx(idx)}
                className="text-fg-muted hover:text-fg"
                title="Cambiar etiqueta o carpeta"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => onTaggedFoldersChange(extras.filter((_, i) => i !== idx))}
                className="text-fg-subtle hover:text-fg"
                aria-label={`Quitar carpeta ${ex.etiqueta}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          {extras.length < 12 && (
            <button
              type="button"
              onClick={() => setPickingTaggedIdx('new')}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
              title="Agrega otra carpeta opcional con etiqueta (ej. Resultados de estudiantes, Resultados de clientes). Claude solo la usará si en las instrucciones, el guion o la carpeta de material dice que en esa parte va ese tema."
            >
              <Tag className="h-3.5 w-3.5" /> + Otra carpeta con etiqueta
            </button>
          )}
        </>
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

      {onTaggedFoldersChange && (
        <TaggedFolderPickerModal
          open={pickingTaggedIdx !== null}
          initialFolder={typeof pickingTaggedIdx === 'number' ? extras[pickingTaggedIdx]?.carpeta : value}
          initialTag={typeof pickingTaggedIdx === 'number' ? (extras[pickingTaggedIdx]?.etiqueta ?? '') : ''}
          onClose={() => setPickingTaggedIdx(null)}
          onPick={(ruta, etiqueta) => {
            const next = [...extras];
            if (typeof pickingTaggedIdx === 'number') {
              next[pickingTaggedIdx] = { carpeta: ruta, etiqueta };
            } else {
              next.push({ carpeta: ruta, etiqueta });
            }
            onTaggedFoldersChange(next);
            setPickingTaggedIdx(null);
          }}
        />
      )}
    </>
  );
}
