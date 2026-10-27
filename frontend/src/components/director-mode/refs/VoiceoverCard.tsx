'use client';

import React, { useState } from 'react';
import { AudioLines, Loader2, Pause, Play, Sparkles, Trash2 } from 'lucide-react';
import { sttCost } from '@/config/cost-rates';
import type { DirectorState } from '@/lib/director-mode/types';
import { formatSeconds, refUrl, useAudioSlices } from './ref-common';

/**
 * "Video desde mi audio": la locución elegida, su transcripción con tiempos (Gemini gratis o ElevenLabs de pago)
 * y la opción de usarla como voz en off. El montaje con este audio llega en la Fase 4.
 */

type Act = (body: Record<string, unknown> & { accion: string }, key?: string) => Promise<boolean>;

export function elevenPrice(seconds: number): { usd: number; label: string } {
  const usd = sttCost(seconds);
  return { usd, label: usd < 0.001 ? '< $0.001' : `≈ $${usd.toFixed(3)}` };
}

export function VoiceoverCard({ productionId, d, busy, act }: { productionId: string; d: DirectorState; busy: string | null; act: Act }) {
  const loc = d.locucion!;
  const ref = d.referencias?.find((r) => r.id === loc.refId);
  const src = ref ? refUrl(productionId, ref.id) : null;
  const { play, playing } = useAudioSlices(src);
  const t = loc.transcripcion;
  const [texts, setTexts] = useState<string[]>(() => t?.frases.map((f) => f.texto) ?? []);
  const edited = Boolean(t && texts.some((x, i) => x !== t.frases[i]?.texto));
  const price = elevenPrice(loc.duracionSeg);
  const disabled = !!busy;
  const working = busy === 'transcribir_locucion';

  const eleven = () => {
    if (!window.confirm(`Transcribir ${formatSeconds(loc.duracionSeg)} con ElevenLabs Speech to Text cuesta ${price.label} ($0.22 por hora de audio). ¿Seguir?`)) return;
    void act({ accion: 'transcribir_locucion', motor: 'elevenlabs', costoVisto: price.usd }, 'transcribir_locucion');
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <AudioLines className="h-4 w-4 text-fg-subtle" />
        <p className="text-[12.5px] font-medium text-fg">Tu locución</p>
        <span className="truncate text-[11px] text-fg-subtle">
          {formatSeconds(loc.duracionSeg)} · {ref?.nombreOriginal ?? 'audio'}
        </span>
      </div>
      {src && <audio controls preload="none" src={src} className="h-8 w-full" />}

      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-fg-muted">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={loc.usarComoVoz}
          disabled={disabled}
          onChange={(e) => void act({ accion: 'usar_locucion', refId: loc.refId, usarComoVoz: e.target.checked }, 'usar_locucion')}
        />
        <span>
          Usar como voz del video (en vez de generar voz con ElevenLabs). El video dura lo que tu audio: {Math.round(loc.duracionSeg)} s. Se aplica al montar
          (Fase 4).
        </span>
      </label>

      <div className="space-y-1.5 border-t border-line pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="mr-auto text-[11.5px] text-fg-muted">
            {t
              ? `Transcrita con ${t.motor === 'gemini' ? 'Gemini (aproximada' + (t.ajustadaASilencios ? ', cortes ajustados a los silencios)' : ')') : 'ElevenLabs (precisa)'} · ${t.frases.length} frases`
              : 'Sin transcribir: hace falta para repartir las escenas sobre el audio.'}
          </p>
          <button
            type="button"
            disabled={disabled || d.confidencial}
            onClick={() => void act({ accion: 'transcribir_locucion', motor: 'gemini' }, 'transcribir_locucion')}
            className="btn-secondary h-7 px-2 text-[11px]"
            title={d.confidencial ? 'Con «Confidencial» el audio no se envía a Gemini gratis' : 'Gemini gratis: tiempos aproximados, ajustados a los silencios con FFmpeg'}
          >
            {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {t ? 'Otra vez' : 'Transcribir'} · gratis
          </button>
          <button type="button" disabled={disabled} onClick={eleven} className="btn-secondary h-7 px-2 text-[11px]" title="ElevenLabs Speech to Text: tiempos por palabra">
            Precisa (ElevenLabs) · {price.label}
          </button>
        </div>
        {d.confidencial && <p className="text-[10.5px] text-fg-subtle">Confidencial: solo se puede transcribir con ElevenLabs (de pago), nunca con Gemini gratis.</p>}

        {t && (
          <>
            <ol className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {t.frases.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => play(`f${i}`, f.inicio, f.fin)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                    aria-label={`Escuchar la frase ${i + 1}`}
                  >
                    {playing === `f${i}` ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </button>
                  <span className="w-[74px] shrink-0 font-mono text-[10px] text-fg-subtle">
                    {f.inicio.toFixed(1)}–{f.fin.toFixed(1)}s
                  </span>
                  <input
                    value={texts[i] ?? ''}
                    onChange={(e) => setTexts((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                    className="input-clean h-7 min-w-0 flex-1 px-1.5 text-[11.5px]"
                    aria-label={`Frase ${i + 1}`}
                  />
                </li>
              ))}
            </ol>
            {edited && (
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setTexts(t.frases.map((f) => f.texto))} className="btn-secondary h-7 px-2 text-[11px]">
                  Deshacer
                </button>
                <button type="button" disabled={disabled} onClick={() => void act({ accion: 'editar_transcripcion', frases: texts }, 'editar_transcripcion')} className="btn-primary h-7 px-2.5 text-[11px]">
                  Guardar palabras
                </button>
              </div>
            )}
            {loc.usarComoVoz && <p className="text-[10.5px] text-fg-subtle">Al escribir el guion, las escenas se reparten sobre estas frases: el audio manda inicio, fin y diálogo.</p>}
          </>
        )}
      </div>

      <div className="flex justify-end border-t border-line pt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (window.confirm('¿Dejar de usar esta locución? El audio sigue en las referencias.')) void act({ accion: 'quitar_locucion' }, 'quitar_locucion');
          }}
          className="btn-secondary h-7 px-2 text-[11px]"
        >
          <Trash2 className="h-3 w-3" /> Quitar locución
        </button>
      </div>
    </div>
  );
}
