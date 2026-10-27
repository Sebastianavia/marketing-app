'use client';

import React, { useState } from 'react';
import { AlertTriangle, Check, Pencil, X } from 'lucide-react';
import { monthName, pct, usd, type Summary } from '@/lib/usage/usage-stats';

/** Las 4 tarjetas de arriba. Cada número lleva su comparación. */

interface Props {
  summary: Summary;
  todayUSD: number;
  limitUSD: number;
  onSaveLimit: (value: number) => Promise<boolean>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface-card flex flex-col p-4">
      <p className="text-[12px] text-fg-muted">{title}</p>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[26px] font-semibold leading-tight tabular-nums tracking-tight text-fg">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11.5px] leading-snug tabular-nums text-fg-subtle">{children}</p>;
}

/** "+18 % vs septiembre" con flecha; más gasto no es "malo" por sí solo: va en texto neutro. */
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (before <= 0) return <>Sin gasto en {label} para comparar</>;
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 1) return <>Igual que {label} ({usd(before)})</>;
  return (
    <>
      <span className="text-fg-muted">
        {d > 0 ? '▲' : '▼'} {pct(Math.abs(d))}
      </span>{' '}
      vs {label} ({usd(before)})
    </>
  );
}

export function KpiCards({ summary: s, todayUSD, limitUSD, onSaveLimit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const prev = monthName(s.prevMonth);

  const ratio = limitUSD > 0 ? todayUSD / limitUSD : 0;
  const over = limitUSD > 0 && todayUSD > limitUSD;
  const barColor = over ? 'bg-[var(--chart-alert)]' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-accent';

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen del gasto">
      <Card title="Hoy">
        <Value>{usd(todayUSD)}</Value>
        {limitUSD > 0 ? (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={limitUSD} aria-valuenow={todayUSD} aria-label="Gasto de hoy contra el límite diario">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </div>
            <Note>
              {over ? (
                <span className="inline-flex items-center gap-1 text-[var(--chart-alert)]">
                  <AlertTriangle className="h-3 w-3" /> Pasaste el límite por {usd(todayUSD - limitUSD)}
                </span>
              ) : (
                <>Te quedan {usd(limitUSD - todayUSD)} de {usd(limitUSD)}</>
              )}
            </Note>
          </>
        ) : (
          <Note>Sin límite diario</Note>
        )}
        <div className="mt-auto pt-2">
          {editing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await onSaveLimit(Number(draft || 0))) setEditing(false);
              }}
            >
              <span className="text-[12px] text-fg-muted">Límite $</span>
              <input
                autoFocus
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(',', '.'))}
                className="input-clean h-7 w-16 px-2 text-[12px] tabular-nums"
                aria-label="Límite diario en dólares (0 = sin límite)"
              />
              <button type="submit" className="btn-secondary h-7 w-7" aria-label="Guardar límite">
                <Check className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary h-7 w-7" aria-label="Cancelar">
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(limitUSD ? String(limitUSD) : '');
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <Pencil className="h-3 w-3" /> {limitUSD > 0 ? 'Cambiar límite diario' : 'Poner límite diario'}
            </button>
          )}
        </div>
      </Card>

      <Card title={s.isCurrentMonth ? 'Este mes' : 'Total del mes'}>
        <Value>{usd(s.monthTotal)}</Value>
        <Note>
          <Delta now={s.monthTotal} before={s.prevComparable} label={s.isCurrentMonth ? `${prev} al día ${s.dayOfMonth}` : prev} />
        </Note>
        <Note>{s.okCount} generaciones</Note>
      </Card>

      <Card title={s.closingIsEstimate ? 'Cierre estimado' : 'Cierre del mes'}>
        <Value>
          {s.closingIsEstimate ? '≈ ' : ''}
          {usd(s.closing)}
        </Value>
        <Note>
          <Delta now={s.closing} before={s.prevTotal} label={prev} />
        </Note>
        {s.closingIsEstimate && (
          <Note>
            Estimación: {usd(s.monthTotal / s.dayOfMonth)} por día × {s.days} días
          </Note>
        )}
      </Card>

      <Card title="Costo por video">
        <Value>{s.video.count ? usd(s.video.avg) : '—'}</Value>
        <Note>
          {s.video.count ? (
            <Delta now={s.video.avg} before={s.prevVideo.avg} label={prev} />
          ) : (
            'Aún no hay videos terminados'
          )}
        </Note>
        <Note>
          {s.video.count} {s.video.count === 1 ? 'video' : 'videos'} · incluye imagen, voz y clips de cada producción
        </Note>
      </Card>
    </section>
  );
}
