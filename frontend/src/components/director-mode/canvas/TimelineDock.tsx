'use client';

import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Film, Plus } from 'lucide-react';
import { formatTime } from '@/lib/director-mode/durations';
import { nodeId, type PaidSceneLite } from './build-graph';
import type { useDirectorMode } from '../useDirectorMode';

type DM = ReturnType<typeof useDirectorMode>;

interface Props {
  dm: DM;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Tira de Storyboard / Mini-Timeline en la base del Lienzo (estilo Buzzy):
 * Muestra todas las escenas en secuencia horizontal con su miniatura/video, tiempos,
 * diálogo, reordenamiento rápido (←/→) y botón para añadir escena ($0).
 */
export function TimelineDock({ dm, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  const p = dm.production;
  const d = p?.director;
  const scenes = d?.guion?.escenas ?? [];
  if (!p || !d || !scenes.length) return null;

  const gen = d.produccion;
  const paidById = new Map<string, PaidSceneLite>((p.escenas ?? []).map((x) => [x.id, x]));
  const totalSec = scenes[scenes.length - 1]?.fin ?? scenes.reduce((acc, s) => acc + s.duracionSeg, 0);
  const isAligned = scenes.some((s) => Boolean(s.audio));

  const mediaUrl = (paidId: string, rol: 'imagen' | 'clip', v: number) =>
    `/api/director-mode/${p.id}/produccion?escena=${paidId}&rol=${rol}&v=${v}`;

  return (
    <div className="nodrag nopan pointer-events-auto absolute inset-x-3 bottom-3 z-10 rounded-xl border border-line bg-surface/95 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-[11.5px] font-medium text-fg cursor-pointer"
        >
          <Film className="h-3.5 w-3.5 text-fg-subtle" />
          <span>Línea de tiempo · {scenes.length} escenas</span>
          <span className="font-mono text-[10.5px] text-fg-subtle">({formatTime(totalSec)})</span>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" /> : <ChevronUp className="h-3.5 w-3.5 text-fg-subtle" />}
        </button>

        <div className="flex items-center gap-1.5">
          {!isAligned && scenes.length < 25 && (
            <button
              type="button"
              disabled={!!dm.busy}
              onClick={() => void dm.act({ accion: 'insertar_escena' }, 'insertar_escena')}
              className="btn-secondary h-6 px-2 text-[10.5px]"
              title="Añadir una escena nueva al final del guion ($0)"
            >
              <Plus className="h-3 w-3" /> Añadir escena · $0
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="flex gap-2 overflow-x-auto border-t border-line px-3 py-2">
          {scenes.map((s, idx) => {
            const m = gen?.mapa.find((x) => x.escenaId === s.id);
            const clip = m ? paidById.get(m.clip) : undefined;
            const img = m?.imagen ? paidById.get(m.imagen) : undefined;
            const thumb = img?.estado === 'lista' && m?.imagen ? mediaUrl(img.id, 'imagen', Math.round(img.gastoUSD * 1e4)) : undefined;
            const video = clip?.estado === 'lista' && m ? mediaUrl(clip.id, 'clip', Math.round(clip.gastoUSD * 1e4)) : undefined;
            const id = nodeId.escena(s.id);
            const active = selectedId === id || selectedId === nodeId.prompt(s.id);

            return (
              <div
                key={s.id}
                onClick={() => onSelect(id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(id);
                }}
                className={`group relative flex w-44 shrink-0 flex-col overflow-hidden rounded-lg border text-left transition-colors cursor-pointer ${
                  active ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-line bg-surface-2/60 hover:border-line-strong'
                }`}
              >
                <div className="relative h-16 w-full overflow-hidden bg-black/80">
                  {video ? (
                    <video
                      src={video}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      onMouseEnter={(ev) => void ev.currentTarget.play().catch(() => undefined)}
                      onMouseLeave={(ev) => ev.currentTarget.pause()}
                      className="h-full w-full object-cover"
                    />
                  ) : thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={`Escena ${s.orden}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-center text-[9.5px] leading-tight text-white/60">
                      <span className="line-clamp-3">{s.queSeVe || 'Sin descripción'}</span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-1.5 py-0.5 text-[9.5px] text-white">
                    <span className="font-semibold">ESC {String(s.orden).padStart(2, '0')}</span>
                    <span className="font-mono">{s.duracionSeg}s</span>
                  </div>
                  {!isAligned && (
                    <div
                      className="absolute bottom-1 right-1 hidden items-center gap-0.5 group-hover:flex"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={!!dm.busy || idx === 0}
                        onClick={() => void dm.act({ accion: 'mover_escena', escenaId: s.id, direccion: 'arriba' }, `mover:${s.id}`)}
                        className="rounded bg-black/75 p-0.5 text-white hover:bg-black disabled:opacity-30 cursor-pointer"
                        title="Mover antes"
                      >
                        <ArrowLeft className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!!dm.busy || idx === scenes.length - 1}
                        onClick={() => void dm.act({ accion: 'mover_escena', escenaId: s.id, direccion: 'abajo' }, `mover:${s.id}`)}
                        className="rounded bg-black/75 p-0.5 text-white hover:bg-black disabled:opacity-30 cursor-pointer"
                        title="Mover después"
                      >
                        <ArrowRight className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-1.5">
                  <div className="flex items-center justify-between text-[9.5px] text-fg-subtle">
                    <span className="font-mono">
                      {formatTime(s.inicio)}–{formatTime(s.fin)}
                    </span>
                    <span>{video ? '🎞️ Clip' : thumb ? '🖼️ Imagen' : s.prompt ? 'Prompt OK' : 'Guion'}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-fg">
                    {s.dialogo ? `«${s.dialogo}»` : s.queSeVe}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

