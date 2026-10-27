'use client';

import React, { useMemo, useState } from 'react';
import { shortDay, usd, type DaySpend } from '@/lib/usage/usage-stats';
import type { ToolSeries } from '@/config/tool-colors';

/**
 * Gasto por día: barras apiladas por herramienta (color fijo), línea del límite diario
 * y marca roja solo en los días que lo pasaron. Clic en un día → filtra el Registro.
 * HTML puro, sin librerías de gráficos.
 */

interface Props {
  days: DaySpend[];
  series: ToolSeries[];
  limitUSD: number;
  selectedDay: string;
  onSelectDay: (day: string) => void;
}

const HEIGHT = 168;

/** Escala "redonda" para el eje: 1, 2, 5 × 10^n. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function title(days: DaySpend[], limitUSD: number) {
  const spent = days.filter((d) => d.total > 0);
  if (!spent.length) return 'Sin gastos en este mes';
  const top = spent.reduce((a, b) => (b.total > a.total ? b : a));
  const over = limitUSD > 0 ? spent.filter((d) => d.total > limitUSD).length : 0;
  const base = `Tu día más caro fue el ${shortDay(top.day)} (${usd(top.total)})`;
  if (limitUSD <= 0) return base;
  if (over === 0) return `${base}. Ningún día pasó el límite de ${usd(limitUSD)}`;
  return `${base}. ${over} ${over === 1 ? 'día pasó' : 'días pasaron'} el límite de ${usd(limitUSD)}`;
}

export function DailySpendChart({ days, series, limitUSD, selectedDay, onSelectDay }: Props) {
  const [hover, setHover] = useState<DaySpend | null>(null);
  const max = useMemo(() => niceMax(Math.max(limitUSD, ...days.map((d) => d.total)) * 1.05), [days, limitUSD]);
  const ticks = [0, max / 2, max];
  const shown = hover;

  return (
    <section className="surface-card p-5" aria-label="Gasto por día">
      <h3 className="text-[13.5px] font-medium text-fg">{title(days, limitUSD)}</h3>

      {/* Leyenda: siempre visible, la identidad nunca depende solo del color */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-muted">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
        {limitUSD > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-fg-subtle" aria-hidden />
            Límite diario
          </li>
        )}
      </ul>

      <div className="mt-4 grid grid-cols-[40px_1fr] gap-2">
        {/* Eje Y recesivo */}
        <div className="relative" style={{ height: HEIGHT }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-fg-subtle" style={{ bottom: `${(t / max) * 100}%` }}>
              ${t < 1 && t > 0 ? t.toFixed(2) : Math.round(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0">
          <div className="relative" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden />
            ))}
            {limitUSD > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-fg-subtle"
                style={{ bottom: `${(limitUSD / max) * 100}%` }}
                aria-hidden
              />
            )}

            <div className="absolute inset-0 flex items-end gap-[2px]">
              {days.map((d) => {
                const over = limitUSD > 0 && d.total > limitUSD;
                const selected = d.day === selectedDay;
                return (
                  <button
                    key={d.day}
                    type="button"
                    onMouseEnter={() => setHover(d)}
                    onFocus={() => setHover(d)}
                    onBlur={() => setHover(null)}
                    onClick={() => d.total > 0 && onSelectDay(selected ? '' : d.day)}
                    aria-label={`${shortDay(d.day)}: ${usd(d.total)}`}
                    aria-pressed={selected}
                    className={`group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      d.total > 0 ? 'cursor-pointer' : 'cursor-default'
                    } ${selected ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                  >
                    {over && (
                      <span
                        className="absolute left-1/2 -translate-x-1/2 text-[9px] leading-none text-[var(--chart-alert)]"
                        style={{ bottom: `calc(${(d.total / max) * 100}% + 3px)` }}
                        aria-hidden
                      >
                        ▲
                      </span>
                    )}
                    {/* Segmentos de abajo hacia arriba en el orden fijo; 2 px de separación */}
                    <span className="flex flex-col-reverse gap-[2px]" style={{ height: `${(d.total / max) * 100}%` }}>
                      {d.parts.map((p, i) => (
                        <span
                          key={p.series.id}
                          className={i === d.parts.length - 1 ? 'rounded-t-[3px]' : ''}
                          style={{ background: p.series.color, flexGrow: p.cost, flexBasis: 0, minHeight: 2 }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detalle del día bajo el ratón */}
            {shown && shown.total > 0 && (
              <div
                className="pointer-events-none absolute top-0 z-20 w-56 rounded-lg border border-line bg-surface p-2.5 text-[11.5px] shadow-[var(--shadow-lift)]"
                style={{
                  left: `clamp(0px, calc(${((shown.n - 0.5) / days.length) * 100}% - 112px), calc(100% - 224px))`,
                }}
                role="status"
              >
                <p className="flex justify-between font-medium text-fg">
                  <span>{shortDay(shown.day)}</span>
                  <span className="tabular-nums">{usd(shown.total)}</span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {[...shown.parts].reverse().map((p) => (
                    <li key={p.series.id} className="flex items-center justify-between gap-2 text-fg-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: p.series.color }} />
                        {p.series.label}
                      </span>
                      <span className="tabular-nums">{usd(p.cost)}</span>
                    </li>
                  ))}
                </ul>
                {limitUSD > 0 && shown.total > limitUSD && (
                  <p className="mt-1 text-[var(--chart-alert)]">Pasó el límite por {usd(shown.total - limitUSD)}</p>
                )}
                <p className="mt-1 text-fg-subtle">{shown.day === selectedDay ? 'Clic para quitar el filtro' : 'Clic para ver sus registros'}</p>
              </div>
            )}
          </div>

          {/* Eje X: un número cada 5 días */}
          <div className="mt-1 flex gap-[2px]" aria-hidden>
            {days.map((d) => (
              <span key={d.day} className="min-w-0 flex-1 text-center text-[10px] tabular-nums text-fg-subtle">
                {d.n === 1 || d.n % 5 === 0 ? d.n : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
