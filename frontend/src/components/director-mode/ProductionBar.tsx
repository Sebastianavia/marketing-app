'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clapperboard, Eye, Film, Image as ImageIcon, Loader2, Pause, Play, RefreshCw, SkipBack, SkipForward, Wallet, X } from 'lucide-react';
import type { Production, ProductionScene } from '@/lib/director/production-store';
import type { useDirectorMode } from './useDirectorMode';

/**
 * Generación del modo Director desde la app (lo mismo que hacen las herramientas de Claude · director):
 * Preparar presupuesto ($0) → aprobar en el aviso amarillo de la barra superior →
 * 1) Generar Storyboard (imágenes + voz) → Previsualizar Animatic → 2) Animar Clips → Montar el video ($0).
 * Muestra el estimado por escena y el total. Nunca aprueba: eso es solo del aviso.
 */

type DM = ReturnType<typeof useDirectorMode>;

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

const LABEL: Record<Production['escenas'][number]['estado'], string> = {
  pendiente: 'Espera tu aprobación',
  aprobada: 'Aprobada',
  generando: 'Generando…',
  lista: 'Lista',
  fallida: 'Falló',
  rechazada: 'Rechazada',
};

const isRunnable = (s: ProductionScene) =>
  s.estado === 'aprobada' || (s.estado === 'fallida' && !s.falloConCobro && !s.reintentoUsado && s.aprobadaUSD !== null);

export function ProductionBar({ dm, production, pulirConClaude }: { dm: DM; production: Production; pulirConClaude: boolean }) {
  const d = production.director!;
  const gen = d.produccion;
  const [open, setOpen] = useState(false);
  const [showAnimatic, setShowAnimatic] = useState(false);
  const busy = dm.busy?.startsWith('produccion:') ? dm.busy.slice('produccion:'.length) : null;
  const ids = new Set(gen ? gen.mapa.flatMap((m) => [m.clip, m.voz, m.imagen].filter(Boolean) as string[]).concat(gen.vozGeneral ? [gen.vozGeneral] : []) : []);
  const mine = production.escenas.filter((s) => ids.has(s.id));
  const generating = mine.some((s) => s.estado === 'generando');
  const produce = dm.produce;

  // Mientras algo se genera, se consulta el estado cada 8 s (el lienzo se actualiza solo y lanza clips encadenados)
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => void produce('estado'), 8_000);
    return () => clearInterval(t);
  }, [generating, produce]);

  if (d.etapas.prompts.estado !== 'aprobada') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] text-fg-subtle">
        <Clapperboard className="h-3.5 w-3.5" /> Aprueba los prompts para preparar el presupuesto de imágenes y clips.
      </div>
    );
  }

  const total = mine.reduce((t, s) => t + s.estimadoUSD, 0);
  const spent = mine.reduce((t, s) => t + s.gastoUSD, 0);
  const pending = mine.filter((s) => s.estado === 'pendiente');
  const runnable = mine.some(isRunnable);
  const storyboardRunnable = mine.filter((s) => s.spec.tipo === 'imagen' || s.spec.tipo === 'voz').some(isRunnable);
  const clipsRunnable = mine.filter((s) => s.spec.tipo === 'toma_de_apoyo' || s.spec.tipo === 'avatar').some(isRunnable);
  const storyboardCost = mine
    .filter((s) => (s.spec.tipo === 'imagen' || s.spec.tipo === 'voz') && isRunnable(s))
    .reduce((t, s) => t + s.estimadoUSD, 0);
  const clipsCost = mine
    .filter((s) => (s.spec.tipo === 'toma_de_apoyo' || s.spec.tipo === 'avatar') && isRunnable(s))
    .reduce((t, s) => t + s.estimadoUSD, 0);
  const hasAnyMediaReady = mine.some((s) => (s.spec.tipo === 'imagen' || s.spec.tipo === 'toma_de_apoyo' || s.spec.tipo === 'avatar') && s.estado === 'lista');
  const allReady = mine.length > 0 && mine.every((s) => s.estado === 'lista');
  const untouched = mine.every((s) => s.gastoUSD === 0 && s.estado !== 'generando' && s.estado !== 'lista');

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="h-3.5 w-3.5 text-fg-subtle" />
        {gen ? (
          <span className="text-fg">
            Estimado {usd(total)}
            {spent > 0 && <span className="text-fg-muted"> · gastado {usd(spent)}</span>}
            {pending.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · apruébalo en el aviso amarillo de arriba</span>}
          </span>
        ) : (
          <span className="text-fg-muted">Prepara el presupuesto: imagen inicial y clip de cada escena. No gasta nada.</span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {(!gen || untouched) && (
            <button type="button" disabled={!!dm.busy} onClick={() => void produce('preparar')} className="btn-secondary h-7 px-2.5 text-[11.5px]">
              {busy === 'preparar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {gen ? 'Volver a preparar' : 'Preparar presupuesto · $0'}
            </button>
          )}
          {gen && storyboardRunnable && (
            <button
              type="button"
              disabled={!!dm.busy}
              onClick={() => void produce('generar', { fase: 'storyboard' })}
              className="btn-secondary h-7 px-2.5 text-[11.5px]"
              title="Genera primero solo las imágenes iniciales y la locución para revisar el storyboard antes de pagar los clips de video"
            >
              {busy === 'generar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
              1. Crear Storyboard ({usd(storyboardCost)})
            </button>
          )}
          {gen && hasAnyMediaReady && (
            <button
              type="button"
              onClick={() => setShowAnimatic((v) => !v)}
              className={`h-7 px-2.5 text-[11.5px] ${showAnimatic ? 'btn-primary' : 'btn-secondary'}`}
              title="Reproduce en secuencia las imágenes iniciales y clips listos sincronizados con el guion y la voz"
            >
              <Eye className="h-3 w-3" /> {showAnimatic ? 'Ocultar Animatic' : 'Previsualizar Storyboard'}
            </button>
          )}
          {gen && clipsRunnable && !storyboardRunnable && (
            <button
              type="button"
              disabled={!!dm.busy}
              onClick={() => void produce('generar', { fase: 'clips' })}
              className="btn-primary h-7 px-2.5 text-[11.5px]"
              title="Anima todas las escenas aprobadas a partir de sus imágenes iniciales"
            >
              {busy === 'generar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              2. Animar Clips ({usd(clipsCost)})
            </button>
          )}
          {gen && runnable && storyboardRunnable && (
            <button
              type="button"
              disabled={!!dm.busy}
              onClick={() => void produce('generar', { fase: 'todo' })}
              className="btn-primary h-7 px-2.5 text-[11.5px]"
              title="Genera imágenes iniciales, locución y clips de video de una vez"
            >
              {busy === 'generar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Generar todo
            </button>
          )}
          {gen && allReady && (
            <button
              type="button"
              disabled={!!dm.busy}
              onClick={() => void produce('montar', { pulirConClaude })}
              className="btn-primary h-7 px-2.5 text-[11.5px]"
            >
              {busy === 'montar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
              {gen.final ? 'Montar otra vez · $0' : 'Montar video · $0'}
            </button>
          )}
          {gen && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary h-7 px-2 text-[11.5px]" aria-expanded={open}>
              Detalle <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {busy === 'generar' && <p className="text-[11px] text-fg-subtle">Ejecutando las escenas solicitadas en Apimart / ElevenLabs…</p>}
      {generating && busy !== 'generar' && <p className="text-[11px] text-fg-subtle">Generando clips en segundo plano (máx. 4 a la vez). Puedes seguir trabajando.</p>}

      {gen?.final && (
        <p className="text-[11px] text-fg-muted">
          Video final: {gen.final.archivo} · {gen.final.duracionSeg.toFixed(1)} s ·{' '}
          <a href={`/api/director-mode/${production.id}/produccion?final=1&v=${gen.final.version}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            ver
          </a>{' '}
          · también en Proyectos.
        </p>
      )}

      {showAnimatic && gen && <AnimaticPlayer production={production} onClose={() => setShowAnimatic(false)} />}

      {open && gen && (
        <ul className="divide-y divide-line border-t border-line">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-fg">{s.spec.titulo ?? s.spec.tipo}</span>
              <span className="hidden truncate text-fg-subtle sm:block">{s.detalle}</span>
              <span className={s.estado === 'fallida' ? 'text-red-700 dark:text-red-400' : 'text-fg-muted'} title={s.error}>
                {LABEL[s.estado]}
              </span>
              {isRunnable(s) && (
                <button
                  type="button"
                  disabled={!!dm.busy}
                  onClick={() => void produce('generar', { escenaPagoId: s.id })}
                  className="btn-secondary h-6 px-2 text-[10.5px]"
                >
                  Generar
                </button>
              )}
              {(s.estado === 'lista' || s.estado === 'fallida') && (
                <button
                  type="button"
                  disabled={!!dm.busy}
                  onClick={() => void produce('rehacer_pago', { escenaPagoId: s.id })}
                  className="btn-secondary h-6 px-2 text-[10.5px]"
                >
                  Rehacer
                </button>
              )}
              <span className="w-14 text-right tabular-nums text-fg-muted">{usd(s.gastoUSD > 0 ? s.gastoUSD : s.estimadoUSD)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnimaticPlayer({ production, onClose }: { production: Production; onClose: () => void }) {
  const d = production.director!;
  const gen = d.produccion!;
  const scenes = d.guion?.escenas ?? [];
  const paidById = new Map(production.escenas.map((s) => [s.id, s]));
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const activeScene = scenes[idx] ?? scenes[0];
  const mapEntry = activeScene ? gen.mapa.find((m) => m.escenaId === activeScene.id) : undefined;
  const imgPaid = mapEntry?.imagen ? paidById.get(mapEntry.imagen) : undefined;
  const clipPaid = mapEntry?.clip ? paidById.get(mapEntry.clip) : undefined;
  const vozGeneralPaid = gen.vozGeneral ? paidById.get(gen.vozGeneral) : undefined;

  const clipUrl =
    clipPaid?.estado === 'lista'
      ? `/api/director-mode/${production.id}/produccion?escena=${clipPaid.id}&rol=clip&v=${Math.round(clipPaid.gastoUSD * 1e4)}`
      : null;
  const imgUrl =
    imgPaid?.estado === 'lista'
      ? `/api/director-mode/${production.id}/produccion?escena=${imgPaid.id}&rol=imagen&v=${Math.round(imgPaid.gastoUSD * 1e4)}`
      : null;
  const vozGeneralUrl =
    vozGeneralPaid?.estado === 'lista'
      ? `/api/director-mode/${production.id}/produccion?escena=${vozGeneralPaid.id}&rol=voz&v=${Math.round(vozGeneralPaid.gastoUSD * 1e4)}`
      : null;

  useEffect(() => {
    if (!playing || !activeScene) return;
    const ms = Math.max(1500, (activeScene.duracionSeg || 4) * 1000);
    const timer = setTimeout(() => {
      if (idx < scenes.length - 1) {
        setIdx((cur) => cur + 1);
      } else {
        setPlaying(false);
        audioRef.current?.pause();
      }
    }, ms);
    return () => clearTimeout(timer);
  }, [playing, idx, activeScene, scenes.length]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
    } else {
      if (idx >= scenes.length - 1) {
        setIdx(0);
        if (audioRef.current) audioRef.current.currentTime = 0;
      }
      setPlaying(true);
      if (vozGeneralUrl && audioRef.current) {
        void audioRef.current.play().catch(() => undefined);
      }
    }
  };

  if (!activeScene) return null;

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface-2/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-fg">
          Previsualizador Storyboard / Animatic · Escena {activeScene.orden} de {scenes.length} ({activeScene.duracionSeg} s)
        </span>
        <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg cursor-pointer" aria-label="Cerrar previsualizador">
          <X className="h-4 w-4" />
        </button>
      </div>

      {vozGeneralUrl && <audio ref={audioRef} src={vozGeneralUrl} className="hidden" />}

      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <div className="relative flex aspect-[9/16] max-h-72 w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-black mx-auto">
          {clipUrl ? (
            <video src={clipUrl} autoPlay loop muted playsInline className="h-full w-full object-cover" />
          ) : imgUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={imgUrl} alt={`Escena ${activeScene.orden}`} className="h-full w-full object-cover" />
          ) : (
            <p className="px-4 text-center text-[11px] text-white/70">Aún sin imagen generada para la Escena {activeScene.orden}</p>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Escena {activeScene.orden} · {clipUrl ? 'Clip listo' : imgUrl ? 'Storyboard IA' : 'Pendiente'}
          </span>
        </div>

        <div className="flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">Qué se ve</p>
              <p className="text-[12.5px] text-fg">{activeScene.queSeVe || '—'}</p>
            </div>
            {activeScene.dialogo && (
              <div className="rounded-lg border border-line bg-surface p-2.5">
                <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">Diálogo / Locución</p>
                <p className="mt-0.5 text-[13px] font-medium text-fg">«{activeScene.dialogo}»</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex gap-1">
              {scenes.map((s, i) => {
                const m = gen.mapa.find((x) => x.escenaId === s.id);
                const hasImg = m?.imagen && paidById.get(m.imagen)?.estado === 'lista';
                const hasClip = m?.clip && paidById.get(m.clip)?.estado === 'lista';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setIdx(i);
                    }}
                    className={`h-2 flex-1 rounded-full transition-colors cursor-pointer ${
                      i === idx ? 'bg-accent' : hasClip || hasImg ? 'bg-emerald-500/50' : 'bg-line-strong'
                    }`}
                    title={`Ir a Escena ${s.orden}`}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setIdx((cur) => Math.max(0, cur - 1));
                }}
                disabled={idx === 0}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                <SkipBack className="h-3 w-3" /> Anterior
              </button>
              <button type="button" onClick={togglePlay} className="btn-primary h-7 px-3 text-[11.5px]">
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? 'Pausar' : 'Reproducir Animatic'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setIdx((cur) => Math.min(scenes.length - 1, cur + 1));
                }}
                disabled={idx === scenes.length - 1}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                Siguiente <SkipForward className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
