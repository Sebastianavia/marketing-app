'use client';

import React, { useState } from 'react';
import { AlertTriangle, Loader2, Pencil, RotateCcw } from 'lucide-react';
import { fitSceneDuration, formatTime } from '@/lib/director-mode/durations';
import { promptIsStale } from '@/lib/director-mode/stages';
import { estimateSeconds } from '@/lib/scenes/scene-plan';
import type { DirectorScene, DirectorSettings } from '@/lib/director-mode/types';

/** Una escena del guion: tiempos, tipo, qué se ve y diálogo. Editar a mano o rehacer solo esta escena. */

interface Props {
  scene: DirectorScene;
  ajustes: DirectorSettings;
  /** Ya hay prompts escritos: avisar si el de esta escena quedó viejo. */
  showPromptState: boolean;
  disabled: boolean;
  redoing: boolean;
  saving: boolean;
  /** "$0" con Gemini gratis; otro texto si es confidencial (Claude). */
  costLabel: string;
  onRedo: (indicacion: string) => void;
  onSave: (cambios: { tipo?: DirectorScene['tipo']; duracionSeg?: number; queSeVe?: string; dialogo?: string }) => Promise<boolean>;
}

export const TYPE_LABEL: Record<DirectorScene['tipo'], string> = {
  avatar: 'Persona habla',
  broll: 'Toma de apoyo',
};

export function DurationHint({ tipo, ajustes, pedida }: { tipo: DirectorScene['tipo']; ajustes: DirectorSettings; pedida: number }) {
  const fit = fitSceneDuration(tipo, ajustes, pedida);
  if (!fit.ajustada) return <span className="text-fg-subtle">{fit.modelo}: admite {fit.admitidas}.</span>;
  return (
    <span className="text-amber-700 dark:text-amber-300">
      {fit.modelo} no admite {pedida} s: se ajustará a {fit.duracionSeg} s (admite {fit.admitidas}).
    </span>
  );
}

export function ScriptSceneCard({ scene, ajustes, showPromptState, disabled, redoing, saving, costLabel, onRedo, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [askRedo, setAskRedo] = useState(false);
  const [indicacion, setIndicacion] = useState('');
  const [tipo, setTipo] = useState(scene.tipo);
  const [duracion, setDuracion] = useState(String(scene.duracionPedidaSeg ?? scene.duracionSeg));
  const [queSeVe, setQueSeVe] = useState(scene.queSeVe);
  const [dialogo, setDialogo] = useState(scene.dialogo);

  const startEdit = () => {
    setTipo(scene.tipo);
    setDuracion(String(scene.duracionSeg));
    setQueSeVe(scene.queSeVe);
    setDialogo(scene.dialogo);
    setEditing(true);
    setAskRedo(false);
  };

  const save = async () => {
    const n = Number(duracion.replace(',', '.'));
    const ok = await onSave({
      tipo: tipo !== scene.tipo ? tipo : undefined,
      duracionSeg: Number.isFinite(n) && n > 0 && n !== scene.duracionSeg ? n : undefined,
      queSeVe,
      dialogo,
    });
    if (ok) setEditing(false);
  };

  const voiceSecs = scene.dialogo.trim() ? estimateSeconds(scene.dialogo) : 0;
  const stale = showPromptState && promptIsStale(scene);
  const wanted = Number(duracion.replace(',', '.'));

  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-fg-subtle">{scene.orden}</span>
        <span className="font-mono text-[11.5px] text-fg">
          [{formatTime(scene.inicio)}–{formatTime(scene.fin)}]
        </span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-muted">{TYPE_LABEL[scene.tipo]}</span>
        {stale && (
          <span className="flex items-center gap-1 text-[10.5px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> prompt desactualizado
          </span>
        )}
        {!editing && (
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={startEdit} disabled={disabled} className="btn-secondary h-7 px-2 text-[11px]">
              <Pencil className="h-3 w-3" /> Editar
            </button>
            <button
              type="button"
              onClick={() => setAskRedo((v) => !v)}
              disabled={disabled}
              className="btn-secondary h-7 px-2 text-[11px]"
            >
              {redoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Rehacer esta
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        <div className="mt-2 space-y-1 text-[12.5px] leading-relaxed">
          <p className="text-fg-muted">
            <span className="text-fg-subtle">Qué se ve: </span>
            {scene.queSeVe || '—'}
          </p>
          <p className="text-fg">
            <span className="text-fg-subtle">Dice: </span>
            {scene.dialogo ? `«${scene.dialogo}»` : <span className="text-fg-subtle">(sin diálogo)</span>}
          </p>
          <p className="text-[11px] text-fg-subtle">
            {scene.duracionPedidaSeg !== undefined ? (
              <span className="text-amber-700 dark:text-amber-300">
                Pediste {scene.duracionPedidaSeg} s → {scene.duracionSeg} s por el modelo.{' '}
              </span>
            ) : null}
            <DurationHint tipo={scene.tipo} ajustes={ajustes} pedida={scene.duracionSeg} />
            {voiceSecs > scene.duracionSeg + 0.5 && (
              <span className="text-amber-700 dark:text-amber-300">
                {' '}El diálogo dura ~{Math.round(voiceSecs)} s y la escena {scene.duracionSeg} s.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            {ajustes.modoVoz === 'avatar' && (
              <label className="space-y-1 text-[11px] text-fg-subtle">
                <span className="block">Tipo</span>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as DirectorScene['tipo'])} className="input-clean h-8 px-2 text-[12px]">
                  <option value="avatar">{TYPE_LABEL.avatar}</option>
                  <option value="broll">{TYPE_LABEL.broll}</option>
                </select>
              </label>
            )}
            <label className="space-y-1 text-[11px] text-fg-subtle">
              <span className="block">Duración (s)</span>
              <input
                type="number"
                min={1}
                max={60}
                step={tipo === 'avatar' ? 0.5 : 1}
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
                className="input-clean h-8 w-20 px-2 text-[12px]"
              />
            </label>
            <p className="pb-1.5 text-[11px]">
              {Number.isFinite(wanted) && wanted > 0 ? <DurationHint tipo={tipo} ajustes={ajustes} pedida={wanted} /> : null}
            </p>
          </div>
          <label className="block space-y-1 text-[11px] text-fg-subtle">
            <span>Qué se ve</span>
            <textarea value={queSeVe} onChange={(e) => setQueSeVe(e.target.value)} rows={2} className="input-clean w-full resize-y p-2 text-[12.5px]" />
          </label>
          <label className="block space-y-1 text-[11px] text-fg-subtle">
            <span>Dice</span>
            <textarea value={dialogo} onChange={(e) => setDialogo(e.target.value)} rows={2} className="input-clean w-full resize-y p-2 text-[12.5px]" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary h-8 px-3 text-[12px]">
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn-primary h-8 px-3 text-[12px]">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} Guardar escena
            </button>
          </div>
        </div>
      )}

      {askRedo && !editing && (
        <div className="mt-2 flex gap-2">
          <input
            value={indicacion}
            onChange={(e) => setIndicacion(e.target.value)}
            placeholder="¿Qué cambiar? (opcional, p. ej. «más cercano», «en una cocina»)"
            className="input-clean h-8 flex-1 px-2 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRedo(indicacion);
                setAskRedo(false);
              }
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onRedo(indicacion);
              setAskRedo(false);
            }}
            className="btn-primary h-8 px-3 text-[12px]"
          >
            Rehacer · {costLabel}
          </button>
        </div>
      )}
    </div>
  );
}
