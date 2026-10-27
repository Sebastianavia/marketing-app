'use client';

import React, { useState } from 'react';
import { Check, Loader2, Paperclip, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { TAG_KINDS, sceneRefs, tagKindLabel, tagRefs } from '@/lib/director-mode/mentions';
import type { DirectorRef, DirectorState, DirectorTag, TagKind } from '@/lib/director-mode/types';
import { RefThumb, TagChip, formatSeconds, useSavedAvatars } from './ref-common';

/**
 * Referencias y etiquetas en el chat: el agente propone (borde punteado) y la persona corrige.
 * Fotos → personaje, lugar, producto o estilo; audio → voz o música; PDF → material (o producto).
 */

type Act = (body: Record<string, unknown> & { accion: string }, key?: string) => Promise<boolean>;

interface PanelProps {
  productionId: string;
  d: DirectorState;
  busy: string | null;
  act: Act;
  costLabel: string;
  /** Abre el selector de archivos (+ Ref) con el alcance actual. */
  onAddFiles: (opts?: { etiquetaId?: string }) => void;
  onOpenTag: (tagId: string) => void;
  /** Abre la tarjeta de la locución propia. */
  onOpenVoiceover: () => void;
}

const VISUAL: TagKind[] = ['personaje', 'lugar', 'producto', 'estilo'];

function kindsFor(r: DirectorRef): TagKind[] {
  return r.medio === 'imagen' ? VISUAL : r.medio === 'audio' ? ['voz', 'musica'] : ['producto'];
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Referencia';
}

/** Vista general: etiquetas, archivos sin etiqueta y los que son solo de una escena. */
export function TagPanel({ productionId, d, busy, act, costLabel, onAddFiles, onOpenTag, onOpenVoiceover }: PanelProps) {
  const tags = d.etiquetas ?? [];
  const refs = d.referencias ?? [];
  // La locución tiene su propia tarjeta
  const loose = refs.filter((r) => !r.etiquetaId && r.id !== d.locucion?.refId);
  const looseImages = loose.filter((r) => r.medio === 'imagen');
  const proposals = tags.filter((t) => !t.confirmada);
  const sceneOrder = new Map((d.guion?.escenas ?? []).map((s) => [s.id, s.orden]));
  const disabled = !!busy;

  const confirm = (t: DirectorTag) =>
    act({ accion: 'guardar_etiqueta', etiquetaId: t.id, tipo: t.tipo, nombre: t.nombre, descripcion: t.descripcion, avatarId: t.avatarId ?? null }, `guardar_etiqueta:${t.id}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] font-medium text-fg">Referencias</p>
        <span className="text-[11px] text-fg-subtle">
          {refs.length} {refs.length === 1 ? 'archivo' : 'archivos'} · {tags.length} {tags.length === 1 ? 'etiqueta' : 'etiquetas'}
        </span>
        <button type="button" onClick={() => onAddFiles()} disabled={disabled} className="btn-secondary ml-auto h-7 px-2 text-[11px]">
          <Paperclip className="h-3 w-3" /> + Ref
        </button>
      </div>

      {d.locucion && (
        <button
          type="button"
          onClick={onOpenVoiceover}
          className="flex w-full items-center gap-2 rounded-lg border border-line p-2 text-left text-[11.5px] text-fg-muted transition-colors hover:bg-surface-2"
        >
          <span aria-hidden>🎙️</span>
          <span className="flex-1">
            Locución del video · {formatSeconds(d.locucion.duracionSeg)} ·{' '}
            {d.locucion.transcripcion ? `${d.locucion.transcripcion.frases.length} frases` : 'sin transcribir'}
            {d.locucion.usarComoVoz ? ' · es la voz del video' : ''}
          </span>
          <span className="text-fg-subtle">Abrir</span>
        </button>
      )}

      {!refs.length && !tags.length && (
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Sube fotos de personas, lugares o productos, un audio de voz o música, o un PDF. Con una escena seleccionada, la referencia queda solo para esa escena.
        </p>
      )}

      {proposals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong p-2 text-[11.5px] text-fg-muted">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Propuse {proposals.length} {proposals.length === 1 ? 'etiqueta' : 'etiquetas'}: corrígelas si hace falta y confírmalas.
          <button
            type="button"
            disabled={disabled}
            onClick={async () => {
              for (const t of proposals) if (!(await confirm(t))) break;
            }}
            className="btn-secondary ml-auto h-7 px-2 text-[11px]"
          >
            <Check className="h-3 w-3" /> Confirmar todas
          </button>
        </div>
      )}

      {tags.length > 0 && (
        <ul className="space-y-2">
          {tags.map((t) => {
            const own = tagRefs(d, t.id);
            return (
              <li key={t.id} className={`rounded-lg border p-2 ${t.confirmada ? 'border-line' : 'border-dashed border-line-strong'}`}>
                <div className="flex items-center gap-2">
                  <TagChip tag={t} />
                  <span className="truncate text-[11.5px] text-fg-muted">
                    {tagKindLabel(t.tipo).label}
                    {t.nombre !== t.mencion ? ` · ${t.nombre}` : ''}
                    {t.avatarNombre ? ` · avatar «${t.avatarNombre}»` : ''}
                  </span>
                  <div className="ml-auto flex shrink-0 gap-1">
                    {!t.confirmada && (
                      <button type="button" disabled={disabled} onClick={() => void confirm(t)} className="btn-secondary h-6 px-1.5 text-[10.5px]" title="Confirmar">
                        {busy === `guardar_etiqueta:${t.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </button>
                    )}
                    <button type="button" onClick={() => onOpenTag(t.id)} className="btn-secondary h-6 px-1.5 text-[10.5px]" title="Editar">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {own.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {own.slice(0, 8).map((r) => (
                      <RefThumb key={r.id} productionId={productionId} r={r} size={36} />
                    ))}
                    {own.length > 8 && <span className="self-center text-[10.5px] text-fg-subtle">+{own.length - 8}</span>}
                  </div>
                )}
                {t.descripcion && <p className="mt-1 line-clamp-2 text-[11px] text-fg-subtle">{t.descripcion}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {loose.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-[11.5px] font-medium text-fg-muted">Sin etiqueta</p>
            {looseImages.length > 0 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void act({ accion: 'proponer_etiquetas', refIds: looseImages.map((r) => r.id) }, 'proponer_etiquetas')}
                className="btn-secondary ml-auto h-7 px-2 text-[11px]"
              >
                {busy === 'proponer_etiquetas' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Proponer etiquetas · {costLabel}
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {loose.map((r) => (
              <LooseRef key={r.id} productionId={productionId} r={r} tags={tags} sceneOrden={r.escenaId ? sceneOrder.get(r.escenaId) : undefined} busy={busy} act={act} />
            ))}
          </ul>
        </div>
      )}

      {(d.guion?.escenas ?? []).some((s) => sceneRefs(d, s.id).length) && (
        <div className="space-y-1">
          <p className="text-[11.5px] font-medium text-fg-muted">Solo para una escena</p>
          <ul className="space-y-1 text-[11.5px] text-fg-muted">
            {(d.guion?.escenas ?? []).map((s) => {
              const own = sceneRefs(d, s.id);
              if (!own.length) return null;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-fg-subtle">Escena {s.orden}:</span>
                  {own.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1 rounded border border-line px-1 py-px">
                      <RefThumb productionId={productionId} r={r} size={20} />
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void act({ accion: 'mover_referencia', refId: r.id, escenaId: null }, `mover_referencia:${r.id}`)}
                        className="cursor-pointer text-[10.5px] text-fg-subtle hover:text-fg"
                        title="Usarla en todo el proyecto"
                      >
                        → proyecto
                      </button>
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Un archivo sin etiqueta: elegir a qué etiqueta va (o crear una), o borrarlo. */
function LooseRef({
  productionId,
  r,
  tags,
  sceneOrden,
  busy,
  act,
}: {
  productionId: string;
  r: DirectorRef;
  tags: DirectorTag[];
  sceneOrden?: number;
  busy: string | null;
  act: Act;
}) {
  const kinds = kindsFor(r);
  const fitting = tags.filter((t) => kinds.includes(t.tipo));
  const disabled = !!busy;
  const key = `mover_referencia:${r.id}`;
  return (
    <li className="flex items-center gap-2 rounded-lg border border-line p-1.5">
      <RefThumb productionId={productionId} r={r} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11.5px] text-fg">{r.nombreOriginal}</p>
        <p className="text-[10.5px] text-fg-subtle">
          {r.medio === 'pdf' ? 'Material: la IA lo lee' : r.medio === 'audio' ? `Audio${r.duracionSeg ? ` · ${formatSeconds(r.duracionSeg)}` : ''}` : 'Foto'}
          {sceneOrden ? ` · solo escena ${sceneOrden}` : ' · todo el proyecto'}
        </p>
      </div>
      {r.medio !== 'pdf' && (
        <select
          value=""
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v.startsWith('nueva:')) {
              const tipo = v.slice(6) as TagKind;
              void act({ accion: 'guardar_etiqueta', tipo, nombre: baseName(r.nombreOriginal), descripcion: '', avatarId: null, refIds: [r.id] }, key);
            } else if (v === 'locucion') void act({ accion: 'usar_locucion', refId: r.id, usarComoVoz: true }, 'usar_locucion');
            else void act({ accion: 'mover_referencia', refId: r.id, etiquetaId: v }, key);
          }}
          className="input-clean h-7 max-w-[130px] px-1.5 text-[11px]"
          aria-label={`Etiquetar ${r.nombreOriginal}`}
        >
          <option value="">{r.medio === 'audio' ? '¿Qué es?' : 'Etiquetar…'}</option>
          {r.medio === 'audio' && <option value="locucion">🎙️ Locución del video</option>}
          {fitting.map((t) => (
            <option key={t.id} value={t.id}>
              @{t.mencion}
            </option>
          ))}
          {kinds.map((k) => (
            <option key={k} value={`nueva:${k}`}>
              + {tagKindLabel(k).label} nuevo
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`¿Quitar «${r.nombreOriginal}»? El archivo pasa a referencias/_borradas.`)) void act({ accion: 'borrar_referencia', refId: r.id }, `borrar_referencia:${r.id}`);
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
        aria-label={`Quitar ${r.nombreOriginal}`}
      >
        {busy === `borrar_referencia:${r.id}` || busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

interface EditorProps {
  productionId: string;
  d: DirectorState;
  tag: DirectorTag;
  busy: string | null;
  act: Act;
  onAddFiles: (opts?: { etiquetaId?: string }) => void;
  onClose?: () => void;
}

/** Corregir una etiqueta: tipo, nombre (@), descripción para los prompts, avatar, fotos. Guardar = confirmar. */
export function TagEditor({ productionId, d, tag, busy, act, onAddFiles, onClose }: EditorProps) {
  const avatars = useSavedAvatars();
  const [tipo, setTipo] = useState<TagKind>(tag.tipo);
  const [nombre, setNombre] = useState(tag.nombre);
  const [descripcion, setDescripcion] = useState(tag.descripcion);
  const [avatarId, setAvatarId] = useState(tag.avatarId ?? '');
  const own = tagRefs(d, tag.id);
  const others = (d.etiquetas ?? []).filter((t) => t.id !== tag.id);
  const hasImages = own.some((r) => r.medio === 'imagen');
  const hasAudio = own.some((r) => r.medio === 'audio');
  const allowed = TAG_KINDS.filter((k) => (hasImages ? VISUAL.includes(k.id) : hasAudio ? k.id === 'voz' || k.id === 'musica' : true));
  const disabled = !!busy;
  const saveKey = `guardar_etiqueta:${tag.id}`;
  const cover = avatars.find((a) => a.id === avatarId)?.coverUrl;

  const save = () =>
    act({ accion: 'guardar_etiqueta', etiquetaId: tag.id, tipo, nombre, descripcion, avatarId: tipo === 'personaje' && avatarId ? avatarId : null }, saveKey);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <TagChip tag={tag} />
        {!tag.confirmada && <span className="text-[11px] text-fg-subtle">Propuesta del agente</span>}
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-fg-subtle hover:text-fg" aria-label="Cerrar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-fg-subtle">
          <span className="block">Qué es</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TagKind)} className="input-clean h-8 w-full px-2 text-[12px]">
            {allowed.map((k) => (
              <option key={k.id} value={k.id}>
                {k.icono} {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-fg-subtle">
          <span className="block">Nombre (se nombra con @)</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} className="input-clean h-8 w-full px-2 text-[12px]" />
        </label>
      </div>
      <label className="block space-y-1 text-[11px] text-fg-subtle">
        <span>Descripción para los prompts (en inglés, lo visible: edad, pelo, ropa; materiales, luz…)</span>
        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} maxLength={600} className="input-clean w-full resize-y p-2 text-[12px]" />
      </label>
      {tipo === 'personaje' && (
        <label className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span className="shrink-0">Avatar guardado</span>
          <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className="input-clean h-8 min-w-0 flex-1 px-2 text-[12px]">
            <option value="">Ninguno (solo estas fotos)</option>
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover} alt="" className="h-8 w-8 rounded-md object-cover" />}
        </label>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-fg-subtle">Archivos ({own.length})</p>
          <button type="button" onClick={() => onAddFiles({ etiquetaId: tag.id })} disabled={disabled} className="btn-secondary ml-auto h-6 px-1.5 text-[10.5px]">
            <Paperclip className="h-3 w-3" /> Añadir
          </button>
        </div>
        {own.length ? (
          <div className="flex flex-wrap gap-1.5">
            {own.map((r) => (
              <span key={r.id} className="relative">
                <RefThumb productionId={productionId} r={r} size={44} />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void act({ accion: 'mover_referencia', refId: r.id, etiquetaId: null }, `mover_referencia:${r.id}`)}
                  aria-label={`Sacar ${r.nombreOriginal} de esta etiqueta`}
                  title="Sacar de esta etiqueta"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-fg text-bg"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-fg-subtle">{tag.avatarId ? 'Usa las fotos del avatar.' : 'Sin archivos todavía.'}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {others.length > 0 && (
          <select
            value=""
            disabled={disabled}
            onChange={(e) => {
              const to = others.find((t) => t.id === e.target.value);
              if (to && window.confirm(`¿Unir @${tag.mencion} con @${to.mencion}? Las @${tag.mencion} del guion pasan a @${to.mencion}.`)) {
                void act({ accion: 'unir_etiquetas', desde: tag.id, hacia: to.id }, `unir_etiquetas:${tag.id}`);
              }
            }}
            className="input-clean h-8 max-w-[150px] px-1.5 text-[11.5px]"
            aria-label="Unir con otra etiqueta"
          >
            <option value="">Unir con…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                @{t.mencion}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(`¿Borrar @${tag.mencion}? Sus archivos quedan sin etiqueta y las @ del guion pasan a ser texto.`)) {
              void act({ accion: 'borrar_etiqueta', etiquetaId: tag.id }, `borrar_etiqueta:${tag.id}`).then((ok) => ok && onClose?.());
            }
          }}
          className="btn-secondary h-8 px-2.5 text-[11.5px]"
        >
          <Trash2 className="h-3.5 w-3.5" /> Borrar
        </button>
        <button type="button" disabled={disabled || !nombre.trim()} onClick={() => void save()} className="btn-primary ml-auto h-8 px-3 text-[12px]">
          {busy === saveKey && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {tag.confirmada ? 'Guardar' : 'Confirmar'}
        </button>
      </div>
      {(d.guion?.escenas ?? []).some((s) => s.prompt) && (
        <p className="text-[10.5px] text-fg-subtle">Si cambias la descripción, los prompts de las escenas que la usan quedan desactualizados.</p>
      )}
    </div>
  );
}
