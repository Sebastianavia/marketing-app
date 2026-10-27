'use client';

import React, { useState } from 'react';
import { AlertTriangle, Loader2, Pause, Pencil, Play, RotateCcw } from 'lucide-react';
import { fitSceneDuration, formatTime } from '@/lib/director-mode/durations';
import { promptIsStale } from '@/lib/director-mode/stages';
import { estimateSeconds } from '@/lib/scenes/scene-plan';
import type { DirectorScene, DirectorSettings, DirectorState } from '@/lib/director-mode/types';
import { MentionTextarea } from './refs/MentionTextarea';
import { MentionText, useAudioSlices } from './refs/ref-common';
import { getBrollModel } from '@/config/broll-models';

/** Una escena del guion: tiempos, tipo, qué se ve y diálogo. Editar a mano o rehacer solo esta escena. */

interface Props {
  scene: DirectorScene;
  ajustes: DirectorSettings;
  /** Etiquetas y referencias del borrador: @ al editar y prompts desactualizados por etiquetas. */
  ctx?: Pick<DirectorState, 'etiquetas' | 'referencias'>;
  /** Ya hay prompts escritos: avisar si el de esta escena quedó viejo. */
  showPromptState: boolean;
  disabled: boolean;
  redoing: boolean;
  saving: boolean;
  /** "$0" con Gemini gratis; otro texto si es confidencial (Claude). */
  costLabel: string;
  /** URL de la locución propia (escenas alineadas al audio: se puede escuchar su tramo). */
  audioSrc?: string | null;
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

/** Escena que sigue la locución: escuchar su tramo y ver el clip que se generará. */
function AlignedLine({ scene, ajustes, audioSrc }: { scene: DirectorScene; ajustes: DirectorSettings; audioSrc?: string | null }) {
  const { play, playing } = useAudioSlices(audioSrc ?? null);
  const clip = scene.clipSeg ?? scene.duracionSeg;
  const model = scene.tipo === 'avatar' ? 'HeyGen' : getBrollModel(ajustes.modeloBroll).name;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {audioSrc && (
        <button
          type="button"
          onClick={() => play('escena', scene.inicio, scene.fin)}
          className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-[10.5px] text-fg-muted hover:text-fg"
        >
          {playing ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />} Escuchar
        </button>
      )}
      <span className="text-fg-subtle">
        Sigue tu audio ({scene.duracionSeg.toFixed(1)} s). Clip de {clip} s ({model})
        {clip > scene.duracionSeg + 0.05 ? `, se recorta a ${scene.duracionSeg.toFixed(1)} s al montar.` : '.'}
      </span>
      {clip + 0.05 < scene.duracionSeg && (
        <span className="text-amber-700 dark:text-amber-300">
          {model} llega a {clip} s: la escena es más larga. Rehaz la transcripción con ElevenLabs (corta por palabras) o elige otro modelo.
        </span>
      )}
    </span>
  );
}

export function ScriptSceneCard({ scene, ajustes, ctx, showPromptState, disabled, redoing, saving, costLabel, audioSrc, onRedo, onSave }: Props) {
  const aligned = Boolean(scene.audio);
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
  const stale = showPromptState && promptIsStale(scene, ctx);
  const tags = ctx?.etiquetas;
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
            {scene.queSeVe ? <MentionText text={scene.queSeVe} tags={tags} /> : '—'}
          </p>
          <p className="text-fg">
            <span className="text-fg-subtle">Dice: </span>
            {scene.dialogo ? `«${scene.dialogo}»` : <span className="text-fg-subtle">(sin diálogo)</span>}
          </p>
          {aligned ? (
            <p className="text-[11px]">
              <AlignedLine scene={scene} ajustes={ajustes} audioSrc={audioSrc} />
            </p>
          ) : (
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
          )}
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
            {aligned ? (
              <p className="pb-1.5 text-[11px] text-fg-subtle">Duración y diálogo los manda tu locución (corrige palabras en la transcripción).</p>
            ) : (
            <>
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
            </>
            )}
          </div>
          <label className="block space-y-1 text-[11px] text-fg-subtle">
            <span>Qué se ve{tags?.length ? ' (escribe @ para nombrar una etiqueta)' : ''}</span>
            <MentionTextarea value={queSeVe} onChange={setQueSeVe} tags={tags} rows={2} className="input-clean w-full resize-y p-2 text-[12.5px]" />
          </label>
          {!aligned && (
            <label className="block space-y-1 text-[11px] text-fg-subtle">
              <span>Dice</span>
              <textarea value={dialogo} onChange={(e) => setDialogo(e.target.value)} rows={2} className="input-clean w-full resize-y p-2 text-[12.5px]" />
            </label>
          )}
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
