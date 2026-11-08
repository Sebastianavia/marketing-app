'use client';

import React from 'react';
import { BROLL_MODELS, clipChoiceProblem, clipCostUSD } from '@/config/broll-models';
import { DEFAULT_IMAGE_MODEL, getImageModel } from '@/config/image-models';
import { sceneClipChoice } from '@/lib/director-mode/durations';
import type { DirectorScene, DirectorState } from '@/lib/director-mode/types';

/**
 * Modelo, calidad e imagen inicial del clip de UNA toma de apoyo (acción ajustar_clip, $0).
 * Lo usan el nodo Clip del lienzo y la Vista lista. Solo ofrece combinaciones válidas.
 */

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export const IMAGE_START_USD = getImageModel(DEFAULT_IMAGE_MODEL).pricePerImage['1K'] ?? 0;

/** Costo estimado de la escena (clip + imagen inicial), igual que el presupuesto del servidor. */
export function sceneClipEstimate(scene: DirectorScene, d: Pick<DirectorState, 'ajustes'>) {
  const c = sceneClipChoice(scene, d.ajustes);
  const conAudio = d.ajustes.modoVoz === 'native' && Boolean(scene.dialogo.trim());
  const clip = clipCostUSD(c.model, scene.clipSeg ?? scene.duracionSeg, { withAudio: conAudio, resolution: c.resolucion });
  return { ...c, conAudio, clipUSD: clip, imagenUSD: c.imagenInicial ? IMAGE_START_USD : 0 };
}

interface Props {
  scene: DirectorScene;
  d: DirectorState;
  disabled?: boolean;
  /** Compacto (nodo del lienzo). */
  compact?: boolean;
  onChange: (body: { accion: 'ajustar_clip'; escenaId: string; modelo?: string | null; resolucion?: string | null; imagenInicial?: boolean | null }) => void;
}

export function ClipPicker({ scene, d, disabled, compact, onChange }: Props) {
  const e = sceneClipEstimate(scene, d);
  // Con locución propia la escena no se puede acortar: el clip debe cubrirla
  const options = BROLL_MODELS.filter(
    (m) => !clipChoiceProblem(m, { formato: d.ajustes.formato, conAudio: e.conAudio, duracionSeg: scene.audio ? scene.duracionSeg : undefined })
  );
  const cls = `input-clean nodrag nopan ${compact ? 'h-7 text-[11px]' : 'h-8 text-[12px]'} px-1.5`;
  const send = (patch: { modelo?: string | null; resolucion?: string | null; imagenInicial?: boolean | null }) =>
    onChange({ accion: 'ajustar_clip', escenaId: scene.id, ...patch });

  return (
    <div className={`nodrag nopan ${compact ? 'space-y-1' : 'flex flex-wrap items-center gap-2'}`} onClick={(ev) => ev.stopPropagation()}>
      <select
        aria-label="Modelo del clip"
        value={e.model.id}
        disabled={disabled}
        onChange={(ev) => send({ modelo: ev.target.value === d.ajustes.modeloBroll ? null : ev.target.value })}
        className={`${cls} ${compact ? 'w-full' : ''}`}
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.id === d.ajustes.modeloBroll ? ' (ajustes)' : ''}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1.5">
        {e.model.resolutions.length > 1 && (
          <select
            aria-label="Calidad del clip"
            value={e.resolucion}
            disabled={disabled}
            onChange={(ev) => send({ resolucion: ev.target.value })}
            className={cls}
          >
            {e.model.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <label className={`flex items-center gap-1 ${compact ? 'text-[10.5px]' : 'text-[11.5px]'} text-fg-muted`} title="Primer fotograma con GPT Image 2, con tu avatar y referencias">
          <input type="checkbox" checked={e.imagenInicial} disabled={disabled} onChange={(ev) => send({ imagenInicial: ev.target.checked })} />
          Imagen inicial
        </label>
      </div>
      <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-fg-subtle`}>
        ≈ {usd(e.clipUSD + e.imagenUSD)}
        {e.imagenUSD > 0 ? ` (clip ${usd(e.clipUSD)} + imagen ${usd(e.imagenUSD)})` : ''}
        {e.model.durationByModel ? ' · peor caso 10 s' : ''}
        {e.conAudio ? ' · con voz' : ''}
      </p>
    </div>
  );
}
