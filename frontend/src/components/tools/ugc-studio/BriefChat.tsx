'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, Square, X, Bot, User } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { REFERENCE_ROLE_LABELS, ReferenceRole } from '@/types/ugc-studio.types';

const ROLES = Object.keys(REFERENCE_ROLE_LABELS) as ReferenceRole[];

const inputClass =
  'w-full rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500 dark:focus:border-white/25 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-colors';

interface PendingImage {
  file: File;
  preview: string;
  role: ReferenceRole;
  label: string;
}

export function BriefChat({ initialText }: { initialText?: string }) {
  const messages = useUgcStudioStore((s) => s.messages);
  const references = useUgcStudioStore((s) => s.references);
  const busy = useUgcStudioStore((s) => s.busy);
  const uploading = useUgcStudioStore((s) => s.uploading);
  const { sendBrief, cancel, addReference, updateReference, removeReference } = useUgcStudioStore.getState();

  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPending({
      file,
      preview: URL.createObjectURL(file),
      role: references.some((r) => r.role === 'personaje') ? 'producto' : 'personaje',
      label: '',
    });
  };

  const confirmPending = async () => {
    // Enter también llama aquí: sin este freno se podía subir la misma imagen dos veces
    if (!pending || !pending.label.trim() || uploading) return;
    // Si la subida falla se conserva la imagen para reintentar sin volver a elegirla
    if (!(await addReference(pending.file, pending.role, pending.label))) return;
    URL.revokeObjectURL(pending.preview);
    setPending(null);
  };

  const submit = () => {
    if (!text.trim() || busy) return;
    void sendBrief(text);
    setText('');
  };

  return (
    <div className="surface-card rounded-xl flex flex-col h-full min-h-[560px] overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-white/[0.06]">
        <p className="text-xs font-semibold text-slate-900 dark:text-white">Brief del video</p>
        <p className="text-[11px] text-slate-500 dark:text-zinc-500">
          Describe el video completo y adjunta referencias diciendo qué representa cada una. Para personas, usa fotos neutras (de frente, plano medio, fondo simple): el modelo tiende a copiar la pose de la foto.
        </p>
      </div>

      {/* Conversación */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-[11px] text-slate-500 dark:text-zinc-500 leading-relaxed space-y-2">
            <p>Ejemplo:</p>
            <p className="italic rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] p-2.5">
              “Una creadora de 25 años graba en su cocina cómo prepara su batido con nuestra proteína de vainilla. Tono
              divertido, termina con 15% de descuento. ref1 es la creadora, ref2 es el frasco.”
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'studio' && <Bot className="h-4 w-4 mt-0.5 shrink-0 text-indigo-500" />}
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'bg-slate-100 text-slate-700 dark:bg-white/[0.05] dark:text-zinc-300'
              }`}
            >
              {m.content}
            </p>
            {m.role === 'user' && <User className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />}
          </div>
        ))}
      </div>

      {/* Referencias adjuntas */}
      {references.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-white/[0.06] space-y-2 max-h-56 overflow-y-auto">
          {references.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.label} className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-white/10" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">{r.id}</span>
                  <select
                    value={r.role}
                    disabled={!!busy}
                    onChange={(e) => updateReference(r.id, { role: e.target.value as ReferenceRole })}
                    className="rounded-md bg-transparent border border-slate-200 dark:border-white/[0.08] text-[10px] text-slate-700 dark:text-zinc-300 px-1 py-0.5"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {REFERENCE_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => removeReference(r.id)}
                    className="ml-auto text-slate-400 hover:text-rose-500"
                    aria-label={`Quitar ${r.id}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  value={r.label}
                  disabled={!!busy}
                  onChange={(e) => updateReference(r.id, { label: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Imagen pendiente de etiquetar */}
      {pending && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-white/[0.06] flex items-start gap-2 bg-indigo-500/[0.04]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
          <div className="flex-1 space-y-1.5">
            <select
              value={pending.role}
              onChange={(e) => setPending({ ...pending, role: e.target.value as ReferenceRole })}
              className={inputClass}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {REFERENCE_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <input
              autoFocus
              value={pending.label}
              onChange={(e) => setPending({ ...pending, label: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && confirmPending()}
              placeholder="¿Qué representa? ej: la protagonista, el frasco de proteína..."
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmPending}
                disabled={!pending.label.trim() || uploading}
                className="rounded-lg bg-indigo-600 text-white text-[11px] font-medium px-3 py-1 disabled:opacity-40 flex items-center gap-1"
              >
                {uploading && <Loader2 className="h-3 w-3 animate-spin" />}
                Adjuntar referencia
              </button>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pending.preview);
                  setPending(null);
                }}
                className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-zinc-300">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-slate-200 dark:border-white/[0.06]">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy || !!pending}
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/[0.08] text-slate-500 hover:text-indigo-600 dark:hover:text-white disabled:opacity-40"
            aria-label="Adjuntar imagen de referencia"
            title="Adjuntar imagen de referencia"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            disabled={!!busy}
            placeholder={messages.length ? 'Pide ajustes al storyboard completo…' : 'Describe el video UGC que quieres…'}
            className={`${inputClass} resize-none py-2`}
          />
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20"
              aria-label="Detener"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-zinc-900 disabled:opacity-30"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
