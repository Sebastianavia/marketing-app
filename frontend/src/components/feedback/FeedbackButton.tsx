'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Sparkles, UploadCloud, X } from 'lucide-react';
import { FEEDBACK_EVENT, STATE_STYLE, feedbackApi, notifyFeedback, type FeedbackItem, type FeedbackSourceClient } from './feedback-api';

/** Qué significa cada estado para quien está en Lulo. */
function stateHint(e: FeedbackItem): string {
  const por = e.decision?.por ? ` por ${e.decision.por}` : '';
  switch (e.estado) {
    case 'por_revisar':
      return 'Esperando que el equipo lo revise en la app de feedback.';
    case 'cambios_pedidos':
      return `Cambios pedidos${por}: listos para que Claude los aplique.`;
    case 'en_proceso':
      return `${e.claude?.destino ?? 'Claude'} está aplicando los cambios.`;
    case 'respondido':
      return 'Claude respondió al equipo; falta que lo revisen otra vez.';
    case 'aprobado':
      return `Aprobado${por}.`;
    case 'reemplazado':
      return 'Ya hay una versión nueva en Feedback.';
  }
}

/**
 * Botón «Subir a Feedback» para un video final o borrador de cualquier servicio.
 * Sube el video a la app de feedback del equipo (Cloudflare R2), muestra su estado de revisión y,
 * cuando el equipo pide cambios, deja que Claude los aplique. El estado se lee al mostrarse (sin consultas periódicas).
 */
export function FeedbackButton({ fuente, className = '' }: { fuente: FeedbackSourceClient | null; className?: string }) {
  const sig = fuente ? JSON.stringify(fuente) : '';
  const [entrada, setEntrada] = useState<FeedbackItem | null>(null);
  const [sugerido, setSugerido] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [disponible, setDisponible] = useState(false);
  const [form, setForm] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [busy, setBusy] = useState<'subir' | 'claude' | 'estado' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sig) return;
    try {
      const r = await feedbackApi.estado(JSON.parse(sig));
      setEntrada(r.entrada);
      setSugerido(r.sugerido);
      setDisponible(r.disponible);
    } catch {
      setDisponible(false);
    }
  }, [sig]);

  // Al cambiar de video, quien lo usa cambia la `key` y el botón empieza de cero.
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

  const toClaude = async () => {
    if (!entrada) return;
    setBusy('claude');
    setError(null);
    try {
      const r = await feedbackApi.claude(entrada.key);
      setAviso(`Cambios enviados a ${r.destino}.`);
      notifyFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a Claude.');
    } finally {
      setBusy(null);
    }
  };

  const recheck = async () => {
    setBusy('estado');
    await refresh();
    setBusy(null);
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      {!entrada && !form && (
        <button
          type="button"
          onClick={() => setForm(sugerido ?? { proyecto: 'Lulo Studio', nombre: 'video.mp4' })}
          className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]"
          title="Sube este video a la app de feedback para que el equipo lo revise"
        >
          <UploadCloud className="h-3.5 w-3.5" /> Subir a Feedback
        </button>
      )}

      {!entrada && form && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-0.5 text-[11px] text-fg-muted">
              <span>Proyecto (carpeta en Feedback)</span>
              <input value={form.proyecto} maxLength={120} onChange={(e) => setForm({ ...form, proyecto: e.target.value })} className="input-clean h-8 w-full px-2 text-[12px]" />
            </label>
            <label className="block space-y-0.5 text-[11px] text-fg-muted">
              <span>Nombre del video</span>
              <input value={form.nombre} maxLength={120} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input-clean h-8 w-full px-2 text-[12px]" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy === 'subir' || !form.proyecto.trim() || !form.nombre.trim()} onClick={upload} className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]">
              {busy === 'subir' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              {busy === 'subir' ? 'Subiendo…' : 'Subir para revisión'}
            </button>
            {busy !== 'subir' && (
              <button type="button" onClick={() => setForm(null)} className="btn-secondary inline-flex h-8 items-center gap-1 px-2.5 text-[12px]">
                <X className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {entrada && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ${STATE_STYLE[entrada.estado]}`}>Feedback · {entrada.estadoTexto}</span>
            <span className="text-[11px] text-fg-subtle">
              {entrada.notas} {entrada.notas === 1 ? 'nota' : 'notas'}
            </span>
            <a href={entrada.enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg" title={`${entrada.proyecto} / ${entrada.nombre}`}>
              Ver en Feedback <ExternalLink className="h-3 w-3" />
            </a>
            <button type="button" onClick={recheck} disabled={!!busy} className="rounded p-0.5 text-fg-subtle hover:text-fg" title="Volver a mirar el estado">
              <RefreshCw className={`h-3 w-3 ${busy === 'estado' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-[11px] text-fg-muted">{stateHint(entrada)}</p>
          {entrada.estado === 'cambios_pedidos' && (
            <button type="button" disabled={busy === 'claude'} onClick={toClaude} className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]" title="Claude descarga las notas y aplica los cambios">
              {busy === 'claude' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Aplicar cambios con Claude
            </button>
          )}
        </div>
      )}

      {aviso && <p className="text-[11px] text-fg-muted">{aviso}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
