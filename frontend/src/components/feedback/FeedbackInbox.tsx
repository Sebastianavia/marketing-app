'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { FEEDBACK_EVENT, feedbackApi, notifyFeedback, type FeedbackInboxData, type FeedbackItem } from './feedback-api';

function ago(iso: string | null) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/** Bandeja de la barra superior: notas que deja el equipo en la app de feedback. */
export function FeedbackInbox() {
  const [data, setData] = useState<FeedbackInboxData | null>(null);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; error?: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async (sync = false) => {
    if (sync) setSyncing(true);
    try {
      setData(await feedbackApi.inbox(sync));
    } catch {
      /* la bandeja es opcional */
    } finally {
      if (sync) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const onEvt = () => void load();
    const first = setTimeout(onEvt, 0);
    const t = setInterval(onEvt, 60_000);
    window.addEventListener(FEEDBACK_EVENT, onEvt);
    window.addEventListener('focus', onEvt);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener(FEEDBACK_EVENT, onEvt);
      window.removeEventListener('focus', onEvt);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const first = setTimeout(() => void load(true), 0);
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(first);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, load]);

  if (!data?.configurado) return null;

  const act = async (e: FeedbackItem, kind: 'claude' | 'revisado') => {
    setBusyKey(e.key);
    setMsg(null);
    try {
      if (kind === 'claude') {
        const r = await feedbackApi.claude(e.key);
        setMsg({ key: e.key, text: `Enviado a ${r.destino}.` });
      } else {
        await feedbackApi.revisado(e.key);
      }
      notifyFeedback();
    } catch (err) {
      setMsg({ key: e.key, text: err instanceof Error ? err.message : 'No se pudo.', error: true });
    } finally {
      setBusyKey(null);
    }
  };

  const items = data.entradas.filter((e) => e.notas > 0 || e.general || e.origen);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors hover:bg-surface-2 hover:text-fg ${open ? 'bg-surface-2 text-fg' : 'text-fg-muted'}`}
        title="Feedback del equipo"
      >
        <MessageSquareText className="h-4 w-4" />
        <span className="hidden lg:inline">Feedback</span>
        {data.nuevos > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-fg tabular-nums">{data.nuevos}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div>
              <p className="text-[13px] font-semibold text-fg">Feedback del equipo</p>
              <p className="text-[11px] text-fg-subtle">
                {data.errorSync ? <span className="text-red-500">{data.errorSync}</span> : data.ultimaSync ? `Revisado ${ago(data.ultimaSync)}` : 'Sin revisar aún'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void load(true)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Buscar notas nuevas">
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              </button>
              <a href={data.app} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Abrir la app de feedback">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px] text-fg-muted">
                Aún no hay videos en Feedback. Usa «Subir a Feedback» debajo de cualquier video final o borrador.
              </p>
            )}
            {items.map((e) => (
              <div key={e.key} className="space-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-fg" title={e.nombre}>
                      {e.nuevo && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
                      {e.nombre}
                    </p>
                    <p className="truncate text-[11px] text-fg-subtle">
                      {e.proyecto} · {e.notas} {e.notas === 1 ? 'nota' : 'notas'}
                      {e.general ? ' + general' : ''}
                      {e.feedbackEn ? ` · ${ago(e.feedbackEn)}` : ''}
                      {!e.origen ? ' · de otra persona' : ''}
                    </p>
                  </div>
                  <a href={e.enlace} target="_blank" rel="noreferrer" className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Abrir en Feedback">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                {(e.notas > 0 || e.general) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.origen && (
                      <button
                        type="button"
                        disabled={busyKey === e.key}
                        onClick={() => void act(e, 'claude')}
                        className={`${e.nuevo ? 'btn-primary' : 'btn-secondary'} inline-flex h-7 items-center gap-1 px-2.5 text-[11px]`}
                      >
                        {busyKey === e.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {e.nuevo ? 'Enviar a Claude' : 'Enviar otra vez'}
                      </button>
                    )}
                    {e.nuevo && (
                      <button type="button" disabled={busyKey === e.key} onClick={() => void act(e, 'revisado')} className="btn-secondary inline-flex h-7 items-center gap-1 px-2.5 text-[11px]">
                        <Check className="h-3 w-3" /> Marcar visto
                      </button>
                    )}
                    {e.claude && !e.nuevo && <span className="text-[11px] text-fg-subtle">Claude lo recibió {ago(e.claude.en)}</span>}
                  </div>
                )}
                {msg?.key === e.key && <p className={`text-[11px] ${msg.error ? 'text-red-500' : 'text-fg-muted'}`}>{msg.text}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
