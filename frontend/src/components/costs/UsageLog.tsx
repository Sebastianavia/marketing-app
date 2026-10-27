'use client';

import React, { useMemo } from 'react';
import { FolderOpen, Search, X } from 'lucide-react';
import { toolLabel, toolSeries } from '@/config/tool-colors';
import {
  EMPTY_FILTERS,
  KIND_LABEL,
  PROVIDER_LABEL,
  dayLabel,
  filterRows,
  groupByDay,
  shortDay,
  usd,
  type LogFilters,
} from '@/lib/usage/usage-stats';
import type { UsageEvent } from '@/lib/usage/usage-store';

/** Registro del mes agrupado por día, con búsqueda y filtros (herramienta, proveedor, tipo, estado, día). */

interface Props {
  rows: UsageEvent[];
  filters: LogFilters;
  onChange: (f: LogFilters) => void;
  onOpenFolder: (dir: string) => void;
}

const dirOf = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

export const LOG_SECTION_ID = 'costos-registro';

export function UsageLog({ rows, filters, onChange, onOpenFolder }: Props) {
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const tools = useMemo(() => [...new Set(rows.map((r) => toolLabel(r.tool)))].sort(), [rows]);
  const providers = useMemo(() => [...new Set(rows.map((r) => r.provider))].sort(), [rows]);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))], [rows]);
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const set = (patch: Partial<LogFilters>) => onChange({ ...filters, ...patch });

  return (
    <section id={LOG_SECTION_ID} className="surface-card scroll-mt-4 overflow-hidden" aria-label="Registro de generaciones">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h3 className="mr-auto text-[13.5px] font-medium text-fg">
          Registro{active && <span className="font-normal text-fg-muted"> · {filtered.length} de {rows.length}</span>}
        </h3>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-fg-subtle" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Buscar…"
            className="input-clean h-8 w-44 pl-7 pr-2 text-[12px]"
            aria-label="Buscar en el registro"
          />
        </label>
        <select value={filters.tool} onChange={(e) => set({ tool: e.target.value })} className="input-clean h-8 px-2 text-[12px]" aria-label="Herramienta">
          <option value="">Todas las herramientas</option>
          {tools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={filters.provider} onChange={(e) => set({ provider: e.target.value })} className="input-clean h-8 px-2 text-[12px]" aria-label="Proveedor">
          <option value="">Todos los proveedores</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p] ?? p}
            </option>
          ))}
        </select>
        <select value={filters.kind} onChange={(e) => set({ kind: e.target.value })} className="input-clean h-8 px-2 text-[12px]" aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => set({ status: e.target.value as LogFilters['status'] })} className="input-clean h-8 px-2 text-[12px]" aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="ok">Correctos</option>
          <option value="failed">Fallidos</option>
          <option value="estimated">Estimados</option>
        </select>
        {filters.day && (
          <button type="button" onClick={() => set({ day: '' })} className="btn-secondary h-8 px-2 text-[12px]" aria-label="Quitar el filtro de día">
            {shortDay(filters.day)} <X className="h-3 w-3" />
          </button>
        )}
        {active && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="h-8 px-1 text-[12px] text-fg-muted hover:text-fg">
            Limpiar
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="text-sm font-medium text-fg">Todavía no hay gastos en este mes</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-fg-muted">Cada voz, guion y video que generes aparecerá aquí con su fecha, hora y costo.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-fg-muted">
          Nada coincide con estos filtros.{' '}
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-fg underline-offset-2 hover:underline">
            Quitar filtros
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[12px] text-fg-subtle">
                <th className="px-5 py-2.5 font-medium">Hora</th>
                <th className="px-3 py-2.5 font-medium">Persona</th>
                <th className="px-3 py-2.5 font-medium">Herramienta</th>
                <th className="px-3 py-2.5 font-medium">Qué se generó</th>
                <th className="px-3 py-2.5 font-medium">Proveedor · modelo</th>
                <th className="px-3 py-2.5 text-right font-medium">Cantidad</th>
                <th className="px-3 py-2.5 text-right font-medium">Costo</th>
                <th className="w-10 px-3 py-2.5" aria-label="Archivo" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.day}>
                  <tr className="bg-surface-2/60">
                    <td colSpan={6} className="px-5 py-2 text-[12px] font-medium text-fg-muted">
                      {dayLabel(g.day)}
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] font-medium tabular-nums text-fg">{usd(g.total)}</td>
                    <td />
                  </tr>
                  {g.rows.map((r) => {
                    const t = new Date(r.createdAt);
                    const failed = r.status === 'failed';
                    return (
                      <tr key={r.id} className="border-t border-line align-top transition-colors hover:bg-surface-2/40">
                        <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-fg-muted">
                          {t.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-2.5 text-fg-muted">{r.person}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: toolSeries(r.tool).color }} aria-hidden />
                          {toolLabel(r.tool)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="mr-2 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">{KIND_LABEL[r.kind] ?? r.kind}</span>
                          <span className={failed ? 'text-fg-subtle line-through' : 'text-fg'}>{r.description}</span>
                          {failed && (
                            <span className="ml-2 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-600 dark:text-rose-400">Falló</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                          {PROVIDER_LABEL[r.provider] ?? r.provider}
                          <span className="text-fg-subtle"> · {r.model}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-fg-muted">
                          {r.units.toLocaleString('es')} {r.unit}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-fg">
                          {usd(r.costUSD)}
                          {r.estimated && r.costUSD > 0 && (
                            <span className="ml-1.5 rounded border border-line px-1 py-px text-[10px] text-fg-subtle" title="Estimado con la tarifa de catálogo del proveedor">
                              estimado
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.filePath && (
                            <button
                              type="button"
                              onClick={() => onOpenFolder(dirOf(r.filePath!))}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                              title="Abrir la carpeta del archivo"
                              aria-label="Abrir la carpeta del archivo"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
