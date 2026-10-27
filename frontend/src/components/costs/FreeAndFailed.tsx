'use client';

import React, { useMemo } from 'react';
import { freeAndFailed, usd } from '@/lib/usage/usage-stats';
import type { UsageEvent } from '@/lib/usage/usage-store';

/** Lo que no costó: tareas gratis (Gemini) e intentos fallidos sin cobro, con sus motivos. */

export function FreeAndFailed({ rows, onShowFailed }: { rows: UsageEvent[]; onShowFailed: () => void }) {
  const f = useMemo(() => freeAndFailed(rows), [rows]);
  if (!f.freeCount && !f.failedCount) return null;
  const sinCobro = f.failedCount - f.failedCharged.count;

  return (
    <section className="surface-card p-5" aria-label="Gratis y sin cobrar">
      <h3 className="text-[13.5px] font-medium text-fg">
        {f.freeCount} {f.freeCount === 1 ? 'tarea gratis' : 'tareas gratis'} y {sinCobro} {sinCobro === 1 ? 'intento fallido' : 'intentos fallidos'} sin cobro
      </h3>
      <div className="mt-3 grid gap-4 text-[12px] md:grid-cols-2">
        <p className="text-fg-muted">
          Guiones, preguntas y textos con Gemini gratis: {f.freeTokens.toLocaleString('es')} tokens a $0.
        </p>
        {f.failedCount > 0 && (
          <div>
            <ul className="space-y-1">
              {f.reasons.map((r) => (
                <li key={r.reason} className="flex justify-between gap-3 text-fg-muted">
                  <span className="truncate" title={r.reason}>
                    {r.reason}
                  </span>
                  <span className="tabular-nums text-fg">{r.count}</span>
                </li>
              ))}
            </ul>
            {f.failedCharged.count > 0 && (
              <p className="mt-1.5 text-[var(--chart-alert)]">
                {f.failedCharged.count} {f.failedCharged.count === 1 ? 'fallo cobró' : 'fallos cobraron'} {usd(f.failedCharged.costUSD)}
              </p>
            )}
            <button type="button" onClick={onShowFailed} className="mt-2 text-[11.5px] text-fg-muted underline-offset-2 hover:text-fg hover:underline">
              Ver los fallidos en el registro
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
