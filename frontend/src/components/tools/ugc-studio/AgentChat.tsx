'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bot, ImagePlus, Loader2, PanelRightClose, Send, Sparkles, Square, X } from 'lucide-react';
import { useUgcStudioStore, type ChatMessage } from '@/store/useUgcStudioStore';
import { REFERENCE_ROLE_LABELS, ReferenceRole } from '@/types/ugc-studio.types';

const ROLES = Object.keys(REFERENCE_ROLE_LABELS) as ReferenceRole[];

const SUGGESTIONS = [
  'Renderiza todo',
  'Agrega una escena entre la 1 y la 2 mostrando el producto de cerca',
  'Ponle luz de atardecer a la última escena',
  'Une el video final',
];

interface PendingImage {
  file: File;
  preview: string;
  role: ReferenceRole;
  label: string;
}

function ConfirmCard({ message, disabled }: { message: ChatMessage; disabled: boolean }) {
  const { confirmCard, cancelCard } = useUgcStudioStore.getState();
  const card = message.card!;
  // La escena 1 siempre abre el video: no puede pasar a corte (su número cambia al reordenar)
  const jointIndex = useUgcStudioStore((s) => s.storyboard?.scenes.find((sc) => sc.id === card.sceneIds?.[0])?.index);
  const tone = card.kind === 'render' ? 'border-accent/40' : 'border-amber-500/40';
  return (
    <div className={`rounded-xl border ${tone} bg-surface p-3`}>
      <p className="text-[13px] font-semibold text-fg">{card.title}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{card.detail}</p>
      {card.status === 'pending' ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={() => void confirmCard(message.id)} className="btn-primary h-8 flex-1 text-[12px]">
            {card.kind === 'render'
              ? `Confirmar${card.costUSD !== undefined ? ` (~$${card.costUSD.toFixed(2)})` : ''}`
              : card.kind === 'delete'
                ? 'Eliminar'
                : card.kind === 'open'
                  ? 'Abrir proyecto'
                  : card.kind === 'joint'
                    ? 'Reescribir inicio'
                    : 'Crear storyboard nuevo'}
          </button>
          {card.kind === 'joint' && jointIndex !== undefined && jointIndex > 1 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void confirmCard(message.id, 'corte')}
              className="h-8 flex-1 rounded-lg border border-line text-[12px] text-fg transition-colors hover:border-line-strong disabled:opacity-40"
            >
              Pasar a corte
            </button>
          )}
          <button
            type="button"
            onClick={() => cancelCard(message.id)}
            className="h-8 flex-1 rounded-lg border border-line text-[12px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            {card.kind === 'joint' ? 'Dejar así' : 'Cancelar'}
          </button>
        </div>
      ) : (
        <p className={`mt-2 text-[11px] font-medium ${card.status === 'confirmed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle'}`}>
          {card.status === 'confirmed' ? 'Confirmado' : card.kind === 'joint' ? 'Se deja así' : 'Cancelado'}
        </p>
      )}
    </div>
  );
}

/** Chat flotante con el agente creativo: desde aquí se crea y se interviene todo el video. */
export function AgentChat({ open, onClose, initialText }: { open: boolean; onClose: () => void; initialText?: string }) {
  const messages = useUgcStudioStore((s) => s.messages);
  const references = useUgcStudioStore((s) => s.references);
  const busy = useUgcStudioStore((s) => s.busy);
  const phase = useUgcStudioStore((s) => s.phase);
  const activities = useUgcStudioStore((s) => s.activities);
  const uploading = useUgcStudioStore((s) => s.uploading);
  const renderQueue = useUgcStudioStore((s) => s.renderQueue);
  const actionsRunning = useUgcStudioStore((s) => s.actionsRunning);
  // Mientras el agente ejecuta sus pasos no se admite otro mensaje (se mezclarían los planes)
  const working = Boolean(busy) || actionsRunning;
  const error = useUgcStudioStore((s) => s.error);
  const { sendMessage, cancel, addReference, updateReference, removeReference, clearError } = useUgcStudioStore.getState();

  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, phase, error]);

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

  const submit = (value = text) => {
    if (!value.trim() || working) return;
    void sendMessage(value);
    setText('');
  };

  const running = activities.filter((a) => a.status === 'running');

  return (
    <aside
      className={`glass-panel absolute bottom-3 right-3 top-3 z-20 flex w-[min(400px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl transition-all duration-300 ${
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[110%] opacity-0'
      }`}
    >
      {/* Encabezado */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15">
          <Sparkles className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-fg">Agente creativo</p>
          <p className="truncate text-[11px] text-fg-subtle">
            {busy ? (phase ?? 'Trabajando…') : actionsRunning ? 'Aplicando los cambios…' : renderQueue.length > 0 ? `Renderizando ${renderQueue.length} escena(s)…` : 'Pídeme lo que quieras del video'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Ocultar chat" className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Conversación */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Hola. Cuéntame qué video quieres: producto, guion, tono, duración. Adjunta fotos del personaje y del producto con el
              clip y dime qué es cada una. Después puedes pedirme cambios por escena, escenas nuevas, otra luz u otro ángulo.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setText(s)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-left text-[12px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.card ? (
            <div key={m.id} className="space-y-1.5">
              {m.content && <p className="text-[12px] text-fg-muted">{m.content}</p>}
              <ConfirmCard message={m} disabled={Boolean(busy) || actionsRunning || renderQueue.length > 0} />
            </div>
          ) : (
            <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role !== 'user' && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2">
                  <Bot className="h-3.5 w-3.5 text-fg-muted" />
                </div>
              )}
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user' ? 'bg-accent text-accent-fg' : m.role === 'agent' ? 'bg-surface-2 text-fg' : 'bg-transparent px-0 text-fg-muted'
                }`}
              >
                {m.content}
              </p>
            </div>
          )
        )}

        {busy && (
          <div className="flex items-start gap-2 text-[12px] text-fg-muted">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            <div className="min-w-0">
              <p>{phase ?? 'Trabajando…'}</p>
              {running.length > 0 && <p className="truncate text-[11px] text-fg-subtle">{running.map((a) => a.agentName).join(' · ')}</p>}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
            <p className="flex-1">{error}</p>
            <button type="button" onClick={clearError} aria-label="Cerrar error" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Referencias adjuntas */}
      {references.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-line px-4 py-2.5">
          {references.map((r) => (
            <div key={r.id} className="group relative w-[92px] shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.label} className="h-16 w-full rounded-lg border border-line object-cover" />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => removeReference(r.id)}
                aria-label={`Quitar ${r.id}`}
                className="absolute right-1 top-1 hidden rounded-md bg-black/60 p-0.5 text-white group-hover:block"
              >
                <X className="h-3 w-3" />
              </button>
              <select
                value={r.role}
                disabled={!!busy}
                onChange={(e) => updateReference(r.id, { role: e.target.value as ReferenceRole })}
                className="mt-1 w-full rounded-md border border-line bg-surface px-1 py-0.5 text-[10px] text-fg-muted"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {r.id} · {REFERENCE_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <input
                value={r.label}
                disabled={!!busy}
                onChange={(e) => updateReference(r.id, { label: e.target.value })}
                title={r.label}
                className="mt-1 w-full truncate rounded-md border border-line bg-surface px-1 py-0.5 text-[10px] text-fg"
              />
            </div>
          ))}
        </div>
      )}

      {/* Imagen pendiente de etiquetar */}
      {pending && (
        <div className="flex gap-2.5 border-t border-line px-4 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <select
              value={pending.role}
              onChange={(e) => setPending({ ...pending, role: e.target.value as ReferenceRole })}
              className="input-clean w-full px-2 py-1 text-[12px]"
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
              placeholder="¿Qué es? ej. la protagonista, la caja del producto"
              className="input-clean w-full px-2 py-1 text-[12px]"
            />
            <div className="flex gap-1.5">
              <button type="button" onClick={confirmPending} disabled={!pending.label.trim() || uploading} className="btn-primary h-7 flex-1 text-[11px]">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Adjuntar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pending.preview);
                  setPending(null);
                }}
                className="h-7 rounded-lg border border-line px-2.5 text-[11px] text-fg-muted hover:text-fg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-line p-3">
        <div className="input-clean flex items-end gap-1.5 p-1.5">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy || !!pending}
            aria-label="Adjuntar imagen de referencia"
            title="Adjuntar imagen de referencia (personas: foto neutra de frente)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(5, Math.max(1, text.split('\n').length))}
            placeholder={working ? 'El equipo está trabajando…' : 'Escribe al agente…'}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
          />
          {working ? (
            <button
              type="button"
              onClick={cancel}
              aria-label="Detener"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg hover:bg-rose-500/15 hover:text-rose-500"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit()}
              disabled={!text.trim()}
              aria-label="Enviar"
              className="btn-primary h-8 w-8 shrink-0 !p-0"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
