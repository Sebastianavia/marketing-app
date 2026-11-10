'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Sparkles, UploadCloud, X } from 'lucide-react';
import { FEEDBACK_EVENT, STATE_STYLE, feedbackApi, notifyFeedback, type FeedbackItem, type FeedbackSourceClient } from './feedback-api';

/** Qué significa cada estado para quien está en Lulo. */
function stateHint(e: FeedbackItem): string {
  switch (e.estado) {
    case 'por_revisar':
      return e.notas || e.general
        ? 'El equipo está dejando notas; cuando pulse «Enviar a Claude» podrás extraerlas.'
        : 'Esperando notas del equipo en la app de feedback.';
    case 'enviado':
      return `${e.decision?.por ? `${e.decision.por} envió` : 'El equipo envió'} las notas a Claude: listas para extraer.`;
    case 'en_proceso':
      return `${e.claude?.destino ?? 'Claude'} está ejecutando las correcciones.`;
    case 'respondido':
      return 'Claude ya hizo las correcciones: sube la versión nueva para que el equipo la revise.';
    case 'reemplazado':
      return 'Ya hay una versión más nueva en Feedback.';
  }
}

/** Una versión del video en Feedback: estado, notas, enlace y «Extraer notas y feedback». */
function VersionRow({ e, onExtract, busy }: { e: FeedbackItem; onExtract: (key: string) => void; busy: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-fg">{e.nombre}</span>
        <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium ${STATE_STYLE[e.estado]}`}>{e.estadoTexto}</span>
        <span className="text-[11px] text-fg-subtle">
          {e.notas} {e.notas === 1 ? 'nota' : 'notas'}
          {e.general ? ' + general' : ''}
        </span>
        <a href={e.enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg" title={`${e.proyecto} / ${e.nombre}`}>
          Ver <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-[11px] text-fg-muted">{stateHint(e)}</p>
      {e.estado === 'enviado' && (
        <button type="button" disabled={busy} onClick={() => onExtract(e.key)} className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]" title="Claude descarga las notas de esta versión y ejecuta las correcciones">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Extraer notas y feedback
        </button>
      )}
    </div>
  );
}

/**
 * Feedback de un video final o borrador de cualquier servicio:
 *  - «Subir a Feedback» sube esta versión al proyecto del video en la app de feedback.
 *  - Muestra esta versión y las anteriores con su estado; cuando el equipo envía sus notas a Claude,
 *    «Extraer notas y feedback» se las pasa al Claude que hizo el video para que las ejecute.
 * El estado se lee del bucket solo al mostrarse o con «Actualizar» (sin consultas periódicas).
 */
export function FeedbackButton({ fuente, className = '' }: { fuente: FeedbackSourceClient | null; className?: string }) {
  const sig = fuente ? JSON.stringify(fuente) : '';
  const [entrada, setEntrada] = useState<FeedbackItem | null>(null);
  const [versiones, setVersiones] = useState<FeedbackItem[]>([]);
  const [sugerido, setSugerido] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [disponible, setDisponible] = useState(false);
  const [form, setForm] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sig) return;
    try {
      const r = await feedbackApi.estado(JSON.parse(sig));
      setEntrada(r.entrada);
      setVersiones(r.versiones ?? []);
      setSugerido(r.sugerido);
      setDisponible(r.disponible);
    } catch {
      setDisponible(false);
    }
  }, [sig]);

  // Al cambiar de video, quien lo usa cambia la `key` y el componente empieza de cero.
  useEffect(() => {
    const onEvt = () => void refresh();
    const first = setTimeout(onEvt, 0);
    window.addEventListener(FEEDBACK_EVENT, onEvt);
    return () => {
      clearTimeout(first);
      window.removeEventListener(FEEDBACK_EVENT, onEvt);
    };
  }, [refresh]);

  if (!fuente || !disponible) return null;

  const upload = async () => {
    if (!form) return;
    setBusy('subir');
    setError(null);
    try {
      const r = await feedbackApi.subir(fuente, form.proyecto, form.nombre);
      setEntrada(r.entrada);
      setForm(null);
      notifyFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir.');
    } finally {
      setBusy(null);
    }
  };

  const extract = async (key: string) => {
    setBusy(key);
    setError(null);
    setAviso(null);
    try {
      const r = await feedbackApi.claude(key);
      setAviso(`Notas extraídas: ${r.destino} está ejecutando las correcciones.`);
      notifyFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron extraer las notas.');
    } finally {
      setBusy(null);
    }
  };

  const recheck = async () => {
    setBusy('estado');
    await refresh();
    setBusy(null);
  };

  const hasVersions = Boolean(entrada) || versiones.length > 0;

  return (
    <div className={`space-y-2 ${className}`}>
      {hasVersions && (
        <div className="space-y-2.5 rounded-lg border border-line bg-surface-2/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Feedback{(entrada ?? versiones[0]) ? ` · ${(entrada ?? versiones[0])!.proyecto}` : ''}
            </p>
            <button type="button" onClick={recheck} disabled={!!busy} className="rounded p-0.5 text-fg-subtle hover:text-fg" title="Actualizar">
              <RefreshCw className={`h-3 w-3 ${busy === 'estado' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {entrada && <VersionRow e={entrada} onExtract={extract} busy={busy === entrada.key} />}
          {versiones.map((v) => (
            <div key={v.key} className={entrada ? 'border-t border-line pt-2' : ''}>
              <VersionRow e={v} onExtract={extract} busy={busy === v.key} />
            </div>
          ))}
        </div>
      )}

      {!entrada && !form && (
        <button
          type="button"
          onClick={() => setForm(sugerido ?? { proyecto: 'Lulo Studio', nombre: 'video.mp4' })}
          className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]"
          title="Sube esta versión a la app de feedback para que el equipo deje sus notas"
        >
          <UploadCloud className="h-3.5 w-3.5" /> {versiones.length ? 'Subir esta versión a Feedback' : 'Subir a Feedback'}
        </button>
      )}

      {!entrada && form && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-0.5 text-[11px] text-fg-muted">
              <span>Proyecto en Feedback</span>
              <input value={form.proyecto} maxLength={120} onChange={(e) => setForm({ ...form, proyecto: e.target.value })} className="input-clean h-8 w-full px-2 text-[12px]" />
            </label>
            <label className="block space-y-0.5 text-[11px] text-fg-muted">
              <span>Nombre de la versión</span>
              <input value={form.nombre} maxLength={120} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input-clean h-8 w-full px-2 text-[12px]" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy === 'subir' || !form.proyecto.trim() || !form.nombre.trim()} onClick={upload} className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]">
              {busy === 'subir' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              {busy === 'subir' ? 'Subiendo…' : 'Subir'}
            </button>
            {busy !== 'subir' && (
              <button type="button" onClick={() => setForm(null)} className="btn-secondary inline-flex h-8 items-center gap-1 px-2.5 text-[12px]">
                <X className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {aviso && <p className="text-[11px] text-fg-muted">{aviso}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
