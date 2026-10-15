'use client';

import React from 'react';

export type Expressiveness = 'low' | 'medium' | 'high';

interface Props {
  motionPrompt: string;
  onMotionPromptChange: (v: string) => void;
  expressiveness: Expressiveness;
  onExpressivenessChange: (v: Expressiveness) => void;
}

const PRESETS = [
  'Gestos naturales con las manos mientras habla, mirando a la cámara',
  'Camina despacio hacia la cámara mientras habla, con gestos suaves',
  'Asiente y sonríe, se inclina un poco hacia adelante al hablar',
];

/**
 * Movimiento y expresividad de HeyGen Avatar IV.
 * Docs de HeyGen: motion_prompt controla "body motion and hand gestures";
 * expressiveness admite high, medium o low (por defecto low).
 */
export function MotionControls({ motionPrompt, onMotionPromptChange, expressiveness, onExpressivenessChange }: Props) {
  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-fg">Movimiento (opcional)</label>
        <textarea
          rows={2}
          value={motionPrompt}
          onChange={(e) => onMotionPromptChange(e.target.value)}
          maxLength={500}
          placeholder="Describe cómo se mueve: gestos, postura, si camina… Si lo dejas vacío, HeyGen usa su movimiento normal."
          className="input-clean w-full resize-y p-2 text-[12px] leading-relaxed"
        />
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onMotionPromptChange(p)}
              className="rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-fg-muted hover:text-fg cursor-pointer"
            >
              {p.split(',')[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-fg">Expresividad</span>
        <div className="flex rounded-md bg-surface p-0.5 text-[11px]">
          {(
            [
              ['low', 'Baja'],
              ['medium', 'Media'],
              ['high', 'Alta'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => onExpressivenessChange(v)}
              className={`rounded px-2.5 py-0.5 cursor-pointer ${expressiveness === v ? 'bg-surface-2 text-fg shadow-xs' : 'text-fg-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10.5px] leading-snug text-fg-subtle">
        HeyGen anima desde una foto: el fondo sale de la foto (usa una foto en el lugar que quieras, p. ej. un jardín). Controla
        gestos y movimiento del cuerpo; que la persona camine o se desplace no está garantizado.
      </p>
    </div>
  );
}
