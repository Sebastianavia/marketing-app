'use client';

import React, { useMemo, useState } from 'react';
import { breakdown, pct, usd, type BreakdownBy } from '@/lib/usage/usage-stats';
import type { UsageEvent } from '@/lib/usage/usage-store';

/** En qué se va el dinero: barras ordenadas con % del total. Color solo por herramienta. */

const OPTIONS: Array<{ id: BreakdownBy; label: string }> = [
  { id: 'tool', label: 'Herramienta' },
  { id: 'provider', label: 'Proveedor' },
  { id: 'model', label: 'Modelo' },
];

export function SpendBreakdown({ rows }: { rows: UsageEvent[] }) {
  const [by, setBy] = useState<BreakdownBy>('tool');
  const items = useMemo(() => breakdown(rows, by).filter((x) => x.costUSD > 0), [rows, by]);
  const top = items[0];
  const max = top?.costUSD ?? 0;

  return (
    <section className="surface-card p-5" aria-label="En qué se va el dinero">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-medium text-fg">
          {top ? `En qué se va: ${top.label}, ${pct(top.pct)} del mes` : 'En qué se va'}
        </h3>
        <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Agrupar por">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={by === o.id}
              onClick={() => setBy(o.id)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition-colors cursor-pointer ${
                by === o.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-[12.5px] text-fg-muted">Nada con costo este mes.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {items.map((x) => (
            <li key={x.key} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 text-[12.5px]" title={`${x.label}: ${usd(x.costUSD)} (${pct(x.pct)})`}>
              <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                {x.series && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.series.color }} aria-hidden />}
                <span className="truncate">{x.label}</span>
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(1.5, (x.costUSD / max) * 100)}%`, background: x.series?.color ?? 'var(--fg-subtle)' }}
                />
              </div>
              <span className="whitespace-nowrap text-right tabular-nums">
                <span className="text-fg">{usd(x.costUSD)}</span>
                <span className="ml-2 inline-block w-10 text-fg-subtle">{pct(x.pct)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
