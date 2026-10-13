'use client';

import React, { useEffect, useState } from 'react';

interface TodaySpendProps {
  onClick?: () => void;
}

/** Indicador discreto del gasto de hoy; al pulsarlo abre Costos. */
export function TodaySpend({ onClick }: TodaySpendProps) {
  const [data, setData] = useState<{ todayUSD: number; dailyLimitUSD: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/usage/today', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, []);

  if (!data) return null;
  const over = data.dailyLimitUSD > 0 && data.todayUSD >= data.dailyLimitUSD * 0.9;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      title="Gasto de hoy en este PC · abrir Costos"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${over ? 'bg-rose-500' : 'bg-emerald-500'}`} />
      <span className="hidden sm:inline">Hoy</span>
      <span className="font-medium tabular-nums text-fg">${data.todayUSD.toFixed(2)}</span>
      {data.dailyLimitUSD > 0 && (
        <span className="hidden tabular-nums text-fg-subtle md:inline">/ ${data.dailyLimitUSD.toFixed(0)}</span>
      )}
    </button>
  );
}
