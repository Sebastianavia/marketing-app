'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, Pencil, X } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import {
  EMPTY_FILTERS,
  dailySpend,
  headline,
  monthLabel,
  summarize,
  type LogFilters,
  type UsageGroupInfo,
  type UsageRowWithGroup,
} from '@/lib/usage/usage-stats';
import { KpiCards } from './KpiCards';
import { DailySpendChart } from './DailySpendChart';
import { SpendBreakdown } from './SpendBreakdown';
import { TopVideos } from './TopVideos';
import { FreeAndFailed } from './FreeAndFailed';
import { LOG_SECTION_ID, UsageLog } from './UsageLog';

/**
 * Costos: ¿cómo voy este mes?, ¿en qué se va el dinero?, ¿cuánto costó cada video?
 * Solo pantalla: el registro (usage-store) no cambia. Datos de GET /api/usage (mes elegido + anterior).
 */

interface UsageResponse {
  month: string;
  rows: UsageRowWithGroup[];
  prevMonth: string;
  prevRows: UsageRowWithGroup[];
  groups: Record<string, UsageGroupInfo>;
  months: string[];
  person: string;
  todayUSD: number;
  dailyLimitUSD: number;
  dataDir: string;
  generatedAt: string;
}

export function CostsView() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage${month ? `?month=${month}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo leer el registro.');
      setData(json);
      setError(null);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }, [month]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 15_000);
    window.addEventListener('focus', load);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const currentMonth = data?.month ?? month ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const groups = useMemo(() => data?.groups ?? {}, [data]);
  const summary = useMemo(
    () => (data ? summarize({ rows: data.rows, prevRows: data.prevRows, groups: data.groups, month: data.month }) : null),
    [data]
  );
  const daily = useMemo(() => dailySpend(rows, currentMonth), [rows, currentMonth]);
  const limit = data?.dailyLimitUSD ?? 0;

  const saveProfile = async (patch: { personName?: string; dailyLimitUSD?: number }) => {
    const res = await fetch('/api/settings/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'No se pudo guardar.');
      return false;
    }
    setEditingName(false);
    load();
    return true;
  };

  const openFolder = (dir: string) => {
    fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    }).catch(() => {});
  };

  const goToLog = (patch: Partial<LogFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    requestAnimationFrame(() => document.getElementById(LOG_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span>Registrando como</span>
          {editingName ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile({ personName: nameDraft });
              }}
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="input-clean h-8 w-40 px-2 text-[13px]"
                aria-label="Tu nombre"
              />
              <button type="submit" className="btn-secondary h-8 w-8" aria-label="Guardar nombre">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="btn-secondary h-8 w-8" aria-label="Cancelar">
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameDraft(data?.person ?? '');
                setEditingName(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-medium text-fg hover:bg-surface-2"
            >
              {data?.person ?? '…'}
              <Pencil className="h-3 w-3 text-fg-subtle" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={currentMonth}
            onChange={(e) => {
              setMonth(e.target.value);
              setFilters(EMPTY_FILTERS);
            }}
            className="input-clean h-9 px-2.5 text-[13px]"
            aria-label="Mes"
          >
            {(data?.months ?? [currentMonth]).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <a href={`/api/usage/export?month=${currentMonth}`} className="btn-secondary h-9 px-3 text-[13px]">
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[13px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {summary && data && (
        <>
          <h2 className="font-display text-[19px] leading-snug text-fg">{headline(summary)}</h2>

          <KpiCards summary={summary} todayUSD={data.todayUSD} limitUSD={limit} onSaveLimit={(v) => saveProfile({ dailyLimitUSD: v })} />

          <DailySpendChart
            days={daily.days}
            series={daily.series}
            limitUSD={limit}
            selectedDay={filters.day}
            onSelectDay={(day) => goToLog({ day })}
          />

          <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <SpendBreakdown rows={rows} />
            </div>
            <div className="lg:col-span-2">
              <TopVideos rows={rows} groups={groups} onOpenFolder={openFolder} />
            </div>
          </div>

          <FreeAndFailed rows={rows} onShowFailed={() => goToLog({ status: 'failed' })} />

          <UsageLog rows={rows} filters={filters} onChange={setFilters} onOpenFolder={openFolder} />
        </>
      )}

      <p className="text-[12px] leading-relaxed text-fg-subtle">
        {data && (
          <>
            Actualizado a las {new Date(data.generatedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}; se refresca cada 15 s.{' '}
          </>
        )}
        «Estimado» = costo calculado con la tarifa oficial del proveedor; el valor exacto depende de tu plan. Solo suman los registros
        correctos; los fallidos sin cobro cuentan $0. Datos de este PC en{' '}
        <span className="allow-select text-fg-muted">{data?.dataDir ?? '…'}</span> (carpeta <code>usage</code>), que no se borra al actualizar la app.
      </p>
    </div>
  );
}
