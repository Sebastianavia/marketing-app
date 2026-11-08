'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, Clapperboard, Film, Loader2, Play, RefreshCw, Wallet } from 'lucide-react';
import type { Production } from '@/lib/director/production-store';
import type { useDirectorMode } from './useDirectorMode';

/**
 * Generación del modo Director desde la app (lo mismo que hacen las herramientas de Claude · director):
 * Preparar presupuesto ($0) → aprobar en el aviso amarillo de la barra superior → Generar lo aprobado →
 * Montar el video ($0). Muestra el estimado por escena y el total. Nunca aprueba: eso es solo del aviso.
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

export function ProductionBar({ dm, production, pulirConClaude }: { dm: DM; production: Production; pulirConClaude: boolean }) {
  const d = production.director!;
  const gen = d.produccion;
  const [open, setOpen] = useState(false);
  const busy = dm.busy?.startsWith('produccion:') ? dm.busy.slice('produccion:'.length) : null;
  const ids = new Set(gen ? gen.mapa.flatMap((m) => [m.clip, m.voz, m.imagen].filter(Boolean) as string[]).concat(gen.vozGeneral ? [gen.vozGeneral] : []) : []);
  const mine = production.escenas.filter((s) => ids.has(s.id));
  const generating = mine.some((s) => s.estado === 'generando');
  const produce = dm.produce;

  // Mientras algo se genera, se consulta el estado cada 10 s (el lienzo se actualiza solo)
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => void produce('estado'), 10_000);
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
  const runnable = mine.some((s) => s.estado === 'aprobada' || (s.estado === 'fallida' && !s.falloConCobro && !s.reintentoUsado && s.aprobadaUSD !== null));
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
          {gen && runnable && (
            <button type="button" disabled={!!dm.busy} onClick={() => void produce('generar')} className="btn-primary h-7 px-2.5 text-[11.5px]">
              {busy === 'generar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Generar lo aprobado
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
      {busy === 'generar' && <p className="text-[11px] text-fg-subtle">Creando las imágenes iniciales (≈ 1 min) y lanzando los clips…</p>}
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
      {open && gen && (
        <ul className="divide-y divide-line border-t border-line">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-fg">{s.spec.titulo ?? s.spec.tipo}</span>
              <span className="hidden truncate text-fg-subtle sm:block">{s.detalle}</span>
              <span className={s.estado === 'fallida' ? 'text-red-700 dark:text-red-400' : 'text-fg-muted'} title={s.error}>
                {LABEL[s.estado]}
              </span>
              <span className="w-14 text-right tabular-nums text-fg-muted">{usd(s.gastoUSD > 0 ? s.gastoUSD : s.estimadoUSD)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
