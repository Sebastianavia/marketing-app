'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { FEEDBACK_EVENT, STATE_STYLE, feedbackApi, notifyFeedback, type FeedbackInboxData, type FeedbackItem, type ReviewState } from './feedback-api';

function ago(iso: string | null) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

const GROUPS: Array<{ titulo: string; estados: ReviewState[] }> = [
  { titulo: 'Cambios pedidos · listos para Claude', estados: ['cambios_pedidos'] },
  { titulo: 'Esperando revisión del equipo', estados: ['por_revisar', 'respondido'] },
  { titulo: 'Claude trabajando', estados: ['en_proceso'] },
  { titulo: 'Aprobados', estados: ['aprobado'] },
];

/**
 * Bandeja de la barra superior: estado de los videos en la app de feedback. Lee el bucket solo al
 * abrirla o con «Actualizar» (nunca en segundo plano); el número es lo último que se leyó.
 */
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
    window.addEventListener(FEEDBACK_EVENT, onEvt);
    return () => {
      clearTimeout(first);
      window.removeEventListener(FEEDBACK_EVENT, onEvt);
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

  const toClaude = async (e: FeedbackItem) => {
    setBusyKey(e.key);
    setMsg(null);
    try {
      const r = await feedbackApi.claude(e.key);
      setMsg({ key: e.key, text: `Enviado a ${r.destino}.` });
      notifyFeedback();
    } catch (err) {
      setMsg({ key: e.key, text: err instanceof Error ? err.message : 'No se pudo.', error: true });
    } finally {
      setBusyKey(null);
    }
  };

  const row = (e: FeedbackItem) => (
    <div key={e.key} className="space-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-fg" title={e.nombre}>
            {e.nombre}
          </p>
          <p className="truncate text-[11px] text-fg-subtle">
            {e.proyecto} · {e.notas} {e.notas === 1 ? 'nota' : 'notas'}
            {e.decision?.por ? ` · ${e.decision.por}` : ''}
            {e.decision?.en ? ` · ${ago(e.decision.en)}` : e.subidoEn ? ` · subido ${ago(e.subidoEn)}` : ''}
            {!e.origen ? ' · otro PC' : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATE_STYLE[e.estado]}`}>{e.estadoTexto}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {e.estado === 'cambios_pedidos' && e.origen && (
          <button type="button" disabled={busyKey === e.key} onClick={() => void toClaude(e)} className="btn-primary inline-flex h-7 items-center gap-1 px-2.5 text-[11px]">
            {busyKey === e.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Aplicar con Claude
          </button>
        )}
        {e.estado === 'cambios_pedidos' && !e.origen && <span className="text-[11px] text-fg-subtle">Pídeselo a Claude en el Estudio Claude</span>}
        <a href={e.enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          Ver <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {msg?.key === e.key && <p className={`text-[11px] ${msg.error ? 'text-red-500' : 'text-fg-muted'}`}>{msg.text}</p>}
    </div>
  );

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
        {data.pendientes > 0 && (
          <span className="rounded-full bg-orange-500 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums" title="Videos con cambios pedidos">
            {data.pendientes}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[min(440px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div>
              <p className="text-[13px] font-semibold text-fg">Feedback del equipo</p>
              <p className="text-[11px] text-fg-subtle">
                {data.errorSync ? <span className="text-red-500">{data.errorSync}</span> : syncing ? 'Leyendo la app de feedback…' : data.ultimaSync ? `Leído ${ago(data.ultimaSync)}` : 'Sin leer aún'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void load(true)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Actualizar">
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              </button>
              <a href={data.app} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Abrir la app de feedback">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {data.entradas.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px] text-fg-muted">
                Aún no hay videos en Feedback. Usa «Subir a Feedback» debajo de cualquier video final o borrador.
              </p>
            )}
            {GROUPS.map((g) => {
              const items = data.entradas.filter((e) => g.estados.includes(e.estado));
              if (!items.length) return null;
              return (
                <section key={g.titulo}>
                  <p className="bg-surface-2/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {g.titulo} · {items.length}
                  </p>
                  {items.map(row)}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
