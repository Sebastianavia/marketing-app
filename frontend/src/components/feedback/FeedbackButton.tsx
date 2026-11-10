'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, MessageSquareText, Sparkles, UploadCloud, X } from 'lucide-react';
import { FEEDBACK_EVENT, feedbackApi, notifyFeedback, type FeedbackItem, type FeedbackSourceClient } from './feedback-api';

/**
 * Botón «Subir a Feedback» para un video final o borrador de cualquier servicio.
 * Sube el video a la app de feedback del equipo (Cloudflare R2) y, cuando alguien deja notas,
 * permite mandárselas al Claude que hizo el video para que las aplique.
 */
export function FeedbackButton({ fuente, className = '' }: { fuente: FeedbackSourceClient | null; className?: string }) {
  const sig = fuente ? JSON.stringify(fuente) : '';
  const [entrada, setEntrada] = useState<FeedbackItem | null>(null);
  const [sugerido, setSugerido] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [disponible, setDisponible] = useState(false);
  const [form, setForm] = useState<{ proyecto: string; nombre: string } | null>(null);
  const [busy, setBusy] = useState<'subir' | 'claude' | null>(null);
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
    const t = setInterval(onEvt, 90_000);
    return () => {
      clearTimeout(first);
      window.removeEventListener(FEEDBACK_EVENT, onEvt);
      clearInterval(t);
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
      setAviso(`Notas enviadas a ${r.destino}.`);
      notifyFeedback();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a Claude.');
    } finally {
      setBusy(null);
    }
  };

  const hasNotes = Boolean(entrada && (entrada.notas > 0 || entrada.general));

  return (
    <div className={`space-y-1.5 ${className}`}>
      {!entrada && !form && (
        <button
          type="button"
          onClick={() => setForm(sugerido ?? { proyecto: 'Lulo Studio', nombre: 'video.mp4' })}
          className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]"
          title="Sube este video a la app de feedback para que el equipo deje notas"
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

      {entrada && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={entrada.enlace}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-[12px]"
            title={`${entrada.proyecto} / ${entrada.nombre}`}
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            En Feedback · {entrada.notas} {entrada.notas === 1 ? 'nota' : 'notas'}
            {entrada.nuevo && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-label="Notas nuevas" />}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          {hasNotes && (
            <button
              type="button"
              disabled={busy === 'claude'}
              onClick={toClaude}
              className={`${entrada.nuevo ? 'btn-primary' : 'btn-secondary'} inline-flex h-8 items-center gap-1.5 px-3 text-[12px]`}
              title="Claude lee las notas y aplica los cambios"
            >
              {busy === 'claude' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {entrada.nuevo ? 'Enviar notas a Claude' : 'Enviar otra vez a Claude'}
            </button>
          )}
          {entrada.claude && !entrada.nuevo && (
            <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
              <Check className="h-3 w-3" /> Claude recibió {entrada.claude.notas} {entrada.claude.notas === 1 ? 'nota' : 'notas'}
            </span>
          )}
        </div>
      )}

      {aviso && <p className="text-[11px] text-fg-muted">{aviso}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
