'use client';

import React, { useState } from 'react';
import { Check, Copy, Download, FileText, Layers, Loader2, Send, Trash2 } from 'lucide-react';
import type { EditProject } from '@/lib/editor/types';

/** Mismos datos que lib/editor/outputs.ts (sin importar el módulo de servidor). */
const NETWORKS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Reels' },
  { id: 'shorts', label: 'Shorts' },
] as const;

type RunFn = (key: string, body: Record<string, unknown>) => Promise<unknown>;

const fileUrl = (id: string, q: string, download = false) => `/api/editor/projects/${id}/media?${q}${download ? '&descargar=1' : ''}`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="btn-secondary h-7 shrink-0 px-2.5 text-[11px]"
      aria-label={`Copiar ${label}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/**
 * Publicar (Fase 5): variantes del borrador (A/B, corta…), exportación por red con su .srt y el texto
 * del post que escribe Claude. Las variantes y el texto se piden a Claude en el chat.
 */
export function PublishPanel({ edit, busy, run, disabled }: { edit: EditProject; busy: string | null; run: RunFn; disabled?: boolean }) {
  const version = edit.borrador?.version;
  const variantes = (edit.variantes ?? []).filter((v) => v.deVersion === version);
  const exports = (edit.exportaciones ?? []).filter((x) => x.deVersion === version);
  const post = edit.post;
  const fullPost = post ? `${post.descripcion}\n\n${post.hashtags.join(' ')}` : '';

  return (
    <div className="space-y-3 rounded-lg border border-line px-3 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
        <Send className="h-3.5 w-3.5 text-accent" /> Publicar
      </p>

      {/* Exportar por red */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-fg-muted">Exportar con la zona segura y el volumen de cada red, más los subtítulos en .srt:</p>
        <div className="flex flex-wrap gap-2">
          {NETWORKS.map((n) => {
            const done = exports.find((x) => x.red === n.id);
            const key = `exportar-${n.id}`;
            return (
              <div key={n.id} className="flex items-center gap-1">
                {done ? (
                  <>
                    <a href={fileUrl(edit.id, `f=export&red=${n.id}`, true)} className="btn-secondary h-8 px-3 text-[12px]">
                      <Download className="h-3.5 w-3.5" /> {n.label}
                    </a>
                    <a href={fileUrl(edit.id, `f=srt&red=${n.id}`, true)} className="rounded px-1.5 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg" title="Subtítulos .srt">
                      .srt
                    </a>
                  </>
                ) : (
                  <button type="button" disabled={!!busy || disabled} onClick={() => void run(key, { accion: 'exportar', red: n.id })} className="btn-secondary h-8 px-3 text-[12px]">
                    {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {n.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {exports.flatMap((x) => x.avisos.filter((a) => /admite como mucho/.test(a))).map((a, i) => (
          <p key={i} className="text-[11px] text-rose-600 dark:text-rose-400">
            {a}
          </p>
        ))}
      </div>

      {/* Variantes */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Layers className="h-3.5 w-3.5" /> Variantes {variantes.length ? '' : '· pídeselas a Claude en el chat («haz dos ganchos A/B» o «una versión de 15 s»)'}
        </p>
        {variantes.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {variantes.map((v) => (
              <li key={v.id} className="space-y-1.5 rounded-lg bg-surface-2 p-2">
                <video src={fileUrl(edit.id, `f=variante&v=${encodeURIComponent(v.id)}`)} controls playsInline preload="metadata" className="mx-auto max-h-[260px] w-full rounded-md bg-black" />
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[12px] text-fg">
                    <b>{v.nombre}</b> · {Math.round(v.duracion)} s{v.descripcion ? <span className="block text-[11px] text-fg-muted">{v.descripcion}</span> : null}
                  </p>
                  <a href={fileUrl(edit.id, `f=variante&v=${encodeURIComponent(v.id)}`, true)} className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg" aria-label={`Descargar variante ${v.nombre}`}>
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button type="button" disabled={!!busy} onClick={() => void run(`borrar-${v.id}`, { accion: 'borrar_variante', variante: v.id })} className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg" aria-label={`Borrar variante ${v.nombre}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Métricas */}
      <p className="text-[11px] text-fg-muted">
        <b className="text-fg">Después de publicar:</b> adjunta en el chat la captura (o el CSV) de retención y pídele a Claude que la analice. Cruza las caídas con lo que había en pantalla y guarda lo aprendido en el Manual.
        {(edit.metricas ?? []).length ? ` · ${edit.metricas!.length} registro(s) de métricas.` : ''}
      </p>

      {/* Texto del post */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <FileText className="h-3.5 w-3.5" /> Texto del post {post ? '' : '· pídeselo a Claude («escribe el texto del post»)'}
        </p>
        {post && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-2">
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] text-fg">
                {post.descripcion}
                <span className="mt-1 block text-accent">{post.hashtags.join(' ')}</span>
              </p>
              <CopyButton text={fullPost} label="descripción y hashtags" />
            </div>
            {post.comentario && (
              <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-2">
                <p className="min-w-0 flex-1 text-[12px] text-fg-muted">
                  <b className="text-fg">Primer comentario (fíjalo):</b> {post.comentario}
                </p>
                <CopyButton text={post.comentario} label="primer comentario" />
              </div>
            )}
            {post.porRed &&
              NETWORKS.filter((n) => post.porRed?.[n.id]).map((n) => (
                <div key={n.id} className="flex items-start gap-2 rounded-lg bg-surface-2 p-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] text-fg-muted">
                    <b className="text-fg">{n.label}:</b> {post.porRed![n.id]}
                  </p>
                  <CopyButton text={post.porRed![n.id]!} label={`texto para ${n.label}`} />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
