'use client';

import React, { useState } from 'react';
import { Check, Loader2, RotateCcw, Sparkles, AlertCircle } from 'lucide-react';
import {
  ELEVEN_MODELS,
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_VOICE_SETTINGS,
  SPEED_MIN,
  SPEED_MAX,
  V3_STABILITY_MODES,
  getElevenModel,
  hasAudioTags,
  type VoiceSettingsState,
} from '@/config/elevenlabs-models';

interface Props {
  modelId: string;
  onModelChange: (id: string) => void;
  settings: VoiceSettingsState;
  onSettingsChange: (s: VoiceSettingsState) => void;
  /** Guion actual: para contar caracteres, avisar de etiquetas y "Dar emoción". */
  text: string;
  onTextChange?: (t: string) => void;
  tool?: string;
}

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

/**
 * Selector de modelo de ElevenLabs con solo los ajustes que admite cada modelo.
 * Compartido por Voice Studio y Avatar Studio.
 */
export function VoiceModelPanel({ modelId, onModelChange, settings, onSettingsChange, text, onTextChange, tool }: Props) {
  const spec = getElevenModel(modelId);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  const chars = text.trim().length;
  const overLimit = chars > spec.charLimit;
  const tagsIgnored = !spec.audioTags && hasAudioTags(text);
  const set = (patch: Partial<VoiceSettingsState>) => onSettingsChange({ ...settings, ...patch });
  // Modo de v3 más cercano al valor actual de estabilidad
  const v3Mode = V3_STABILITY_MODES.reduce((best, m) =>
    Math.abs(m.value - settings.stability) < Math.abs(best.value - settings.stability) ? m : best
  );

  const handleEnhance = async () => {
    if (!onTextChange || !text.trim()) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const res = await fetch('/api/elevenlabs/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, modelId: spec.id, tool }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.text !== 'string') throw new Error(data.error || 'No se pudo dar emoción al guion.');
      onTextChange(data.text);
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'No se pudo dar emoción al guion.');
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Modelo */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium text-fg-muted">Modelo de voz</span>
          <span className="text-[10px] text-fg-subtle">Precio por 1.000 caracteres</span>
        </div>
        <div className="grid gap-1.5">
          {ELEVEN_MODELS.map((m) => {
            const active = m.id === spec.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onModelChange(m.id)}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                  active ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-2'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-accent bg-accent text-accent-fg' : 'border-line'
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-fg">{m.name}</span>
                    {m.id === DEFAULT_ELEVEN_MODEL && (
                      <span className="rounded border border-line px-1 text-[9px] text-fg-muted">Predeterminado</span>
                    )}
                    {m.audioTags && (
                      <span className="rounded border border-line px-1 text-[9px] text-fg-muted">Etiquetas de emoción</span>
                    )}
                  </span>
                  <span className="block text-[10.5px] leading-snug text-fg-subtle">{m.description}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">{usd(m.pricePer1k)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ajustes del modelo elegido */}
      <div className="space-y-3 rounded-lg border border-line bg-surface-2/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-fg">Ajustes de {spec.name}</span>
          <button
            type="button"
            onClick={() => onSettingsChange(DEFAULT_VOICE_SETTINGS)}
            className="flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" /> Restablecer
          </button>
        </div>

        {spec.controls.stability === 'modes' ? (
          <div className="space-y-1">
            <span className="text-[11px] text-fg-muted">Estabilidad</span>
            <div className="grid grid-cols-3 gap-1">
              {V3_STABILITY_MODES.map((mode) => {
                const active = mode.value === v3Mode.value;
                return (
                  <button
                    key={mode.label}
                    type="button"
                    onClick={() => set({ stability: mode.value })}
                    className={`rounded-md border px-2 py-1.5 text-[11px] cursor-pointer ${
                      active ? 'border-accent bg-accent/5 text-fg' : 'border-line text-fg-muted hover:text-fg'
                    }`}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <Slider
            label="Estabilidad"
            left="Creativo"
            right="Robusto"
            value={settings.stability}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(settings.stability * 100)}%`}
            onChange={(v) => set({ stability: v })}
          />
        )}

        {spec.controls.similarity && (
          <Slider
            label="Similitud"
            left="Baja"
            right="Alta"
            value={settings.similarityBoost}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(settings.similarityBoost * 100)}%`}
            onChange={(v) => set({ similarityBoost: v })}
          />
        )}

        {spec.controls.style && (
          <Slider
            label="Exageración de estilo"
            left="Ninguno"
            right="Exagerado"
            value={settings.style}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(settings.style * 100)}%`}
            onChange={(v) => set({ style: v })}
          />
        )}

        {spec.controls.speed && (
          <Slider
            label="Velocidad"
            left="Más lento"
            right="Más rápido"
            value={settings.speed}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.01}
            display={`${settings.speed.toFixed(2)}x`}
            onChange={(v) => set({ speed: v })}
          />
        )}

        {spec.controls.speakerBoost && (
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-[11px] text-fg-muted">Aumento de altavoz</span>
            <input
              type="checkbox"
              checked={settings.useSpeakerBoost}
              onChange={(e) => set({ useSpeakerBoost: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
          </label>
        )}
      </div>

      {/* Emoción */}
      <div className="space-y-2">
        <p className="text-[10.5px] leading-snug text-fg-subtle">{spec.emotionHint}</p>
        {onTextChange && (
          <button
            type="button"
            onClick={handleEnhance}
            disabled={enhancing || !text.trim()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
          >
            {enhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {spec.audioTags ? 'Dar emoción (añade etiquetas)' : 'Dar emoción (solo puntuación)'}
          </button>
        )}
        {enhanceError && <p className="text-[10.5px] text-red-600 dark:text-red-400">{enhanceError}</p>}
        {tagsIgnored && (
          <p className="flex items-start gap-1.5 text-[10.5px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {spec.name} no admite etiquetas entre corchetes: se quitarán antes de generar.
          </p>
        )}
        <p className={`text-right text-[10px] tabular-nums ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}>
          {chars.toLocaleString()} / {spec.charLimit.toLocaleString()} caracteres · ≈ {usd((chars / 1000) * spec.pricePer1k)}
        </p>
      </div>
    </div>
  );
}

function Slider(props: {
  label: string;
  left: string;
  right: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-fg-muted">{props.label}</span>
        <span className="text-[10px] tabular-nums text-fg-muted">{props.display}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line accent-[var(--color-accent)]"
      />
      <div className="flex justify-between text-[9.5px] text-fg-subtle">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </div>
    </div>
  );
}
