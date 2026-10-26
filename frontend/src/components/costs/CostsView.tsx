'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Pencil, Check, X, AlertCircle } from 'lucide-react';
import { TOOLS, normalizeToolId } from '@/config/tools.config';
import { errorMessage } from '@/lib/errors';

interface UsageRow {
  id: string;
  createdAt: string;
  person: string;
  tool: string;
  kind: 'video' | 'audio' | 'script' | 'image' | 'voice_clone';
  provider: string;
  model: string;
  description: string;
  units: number;
  unit: string;
  costUSD: number;
  estimated: boolean;
  filePath?: string;
  status: 'ok' | 'failed';
}

interface UsageResponse {
  rows: UsageRow[];
  months: string[];
  person: string;
  dailyLimitUSD: number;
  dataDir: string;
}

const KIND_LABEL: Record<UsageRow['kind'], string> = {
  video: 'Video',
  audio: 'Voz',
  script: 'Guion',
  image: 'Imagen',
  voice_clone: 'Clonación',
};

const PROVIDER_LABEL: Record<string, string> = {
  openrouter: 'OpenRouter',
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  apimart: 'APIMart',
  heygen: 'HeyGen',
  fal: 'fal',
  buzzy: 'Buzzy',
};

const usd = (n: number) =>
  n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

const toolName = (id: string) => {
  const t = normalizeToolId(id);
  return t ? TOOLS[t].title : id;
};

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const monthLabel = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return capFirst(new Date(y, mm - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }));
};

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return capFirst(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
};

const dirOf = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

export function CostsView() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState('');

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

  const currentMonth = month ?? data?.months[0] ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => toolFilter === 'all' || toolName(r.tool) === toolFilter),
    [data, toolFilter],
  );

  const stats = useMemo(() => {
    const ok = (data?.rows ?? []).filter((r) => r.status === 'ok');
    const today = new Date().toDateString();
    const todayCost = ok.filter((r) => dayKey(r.createdAt) === today).reduce((s, r) => s + r.costUSD, 0);
    const monthCost = ok.reduce((s, r) => s + r.costUSD, 0);
    const videos = ok.filter((r) => r.kind === 'video');
    const videoCost = videos.reduce((s, r) => s + r.costUSD, 0);
    const byTool = new Map<string, number>();
    for (const r of ok) byTool.set(toolName(r.tool), (byTool.get(toolName(r.tool)) ?? 0) + r.costUSD);
    const tools = [...byTool.entries()].sort((a, b) => b[1] - a[1]);
    return {
      todayCost,
      monthCost,
      count: ok.length,
      videoCount: videos.length,
      avgVideo: videos.length ? videoCost / videos.length : 0,
      tools,
      failed: (data?.rows ?? []).length - ok.length,
    };
  }, [data]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; total: number; rows: UsageRow[] }[] = [];
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      let g = out.at(-1);
      if (!g || g.key !== k) {
        g = { key: k, label: dayLabel(r.createdAt), total: 0, rows: [] };
        out.push(g);
      }
      g.rows.push(r);
      if (r.status === 'ok') g.total += r.costUSD;
    }
    return out;
  }, [rows]);

  const saveProfile = async (patch: { personName?: string; dailyLimitUSD?: number }) => {
    const res = await fetch('/api/settings/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || 'No se pudo guardar.');
      return;
    }
    setEditingName(false);
    setEditingLimit(false);
    load();
  };

  const openFolder = (filePath: string) => {
    fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirOf(filePath) }),
    }).catch(() => {});
  };

  const limit = data?.dailyLimitUSD ?? 0;
  const limitPct = limit > 0 ? Math.min(100, (stats.todayCost / limit) * 100) : 0;
  const toolOptions = [...new Set((data?.rows ?? []).map((r) => toolName(r.tool)))];

  return (
    <div className="space-y-6">
      {/* Barra de controles */}
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
            onChange={(e) => setMonth(e.target.value)}
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

      {/* Resumen */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen">
        <div className="surface-card p-4">
          <p className="text-[12px] text-fg-muted">Hoy</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{usd(stats.todayCost)}</p>
          {limit > 0 && (
            <div className="mt-2">
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${limitPct >= 90 ? 'bg-rose-500' : 'bg-accent'}`}
                  style={{ width: `${limitPct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">de {usd(limit)} de límite diario</p>
            </div>
          )}
        </div>
        <div className="surface-card p-4">
          <p className="text-[12px] text-fg-muted">{monthLabel(currentMonth)}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{usd(stats.monthCost)}</p>
          <p className="mt-1 text-[11px] text-fg-subtle">{stats.count} generaciones</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-[12px] text-fg-muted">Videos del mes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{stats.videoCount}</p>
          <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">
            {stats.videoCount ? `${usd(stats.avgVideo)} de media por video` : 'Aún no hay videos'}
          </p>
        </div>
        <div className="surface-card p-4">
          <p className="text-[12px] text-fg-muted">Límite diario</p>
          {editingLimit ? (
            <form
              className="mt-1 flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile({ dailyLimitUSD: Number(limitDraft || 0) });
              }}
            >
              <span className="text-fg-muted">$</span>
              <input
                autoFocus
                inputMode="decimal"
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value.replace(',', '.'))}
                className="input-clean h-8 w-20 px-2 text-[13px] tabular-nums"
                aria-label="Límite diario en dólares"
              />
              <button type="submit" className="btn-secondary h-8 w-8" aria-label="Guardar límite">
                <Check className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setLimitDraft(limit ? String(limit) : '');
                setEditingLimit(true);
              }}
              className="mt-1 inline-flex items-center gap-1.5 text-2xl font-semibold tabular-nums text-fg"
            >
              {limit > 0 ? usd(limit) : 'Sin límite'}
              <Pencil className="h-3.5 w-3.5 text-fg-subtle" />
            </button>
          )}
          <p className="mt-1 text-[11px] text-fg-subtle">0 = sin límite</p>
        </div>
      </section>

      {/* Desglose por herramienta */}
      {stats.tools.length > 0 && (
        <section className="surface-card p-5" aria-label="Gasto por herramienta">
          <h3 className="text-[13px] font-medium text-fg">Gasto por herramienta</h3>
          <ul className="mt-3 space-y-2.5">
            {stats.tools.map(([name, cost]) => (
              <li key={name} className="grid grid-cols-[140px_1fr_72px] items-center gap-3 text-[13px]">
                <span className="truncate text-fg-muted">{name}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-fg/70"
                    style={{ width: `${stats.monthCost ? Math.max(2, (cost / stats.monthCost) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-right tabular-nums text-fg">{usd(cost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tabla de registro */}
      <section className="surface-card overflow-hidden" aria-label="Registro de generaciones">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h3 className="text-[13px] font-medium text-fg">Registro</h3>
          {toolOptions.length > 1 && (
            <select
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="input-clean h-8 px-2 text-[12px]"
              aria-label="Filtrar por herramienta"
            >
              <option value="all">Todas las herramientas</option>
              {toolOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium text-fg">Todavía no hay gastos en este mes</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-fg-muted">
              Cada voz, guion y video que generes aparecerá aquí con su fecha, hora y costo.
            </p>
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
                  <React.Fragment key={g.key}>
                    <tr className="bg-surface-2/60">
                      <td colSpan={6} className="px-5 py-2 text-[12px] font-medium text-fg-muted">
                        {g.label}
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
                          <td className="whitespace-nowrap px-3 py-2.5 text-fg">{toolName(r.tool)}</td>
                          <td className="px-3 py-2.5">
                            <span className="mr-2 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">
                              {KIND_LABEL[r.kind] ?? r.kind}
                            </span>
                            <span className={failed ? 'text-fg-subtle line-through' : 'text-fg'}>{r.description}</span>
                            {failed && (
                              <span className="ml-2 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                                Falló
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                            {PROVIDER_LABEL[r.provider] ?? r.provider}
                            <span className="text-fg-subtle"> · {r.model}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-fg-muted">
                            {r.units.toLocaleString('es')} {r.unit}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-fg" title={r.estimated ? 'Estimado con la tarifa de catálogo' : undefined}>
                            {r.estimated && r.costUSD > 0 ? '≈ ' : ''}
                            {usd(r.costUSD)}
                          </td>
                          <td className="px-3 py-2">
                            {r.filePath && (
                              <button
                                type="button"
                                onClick={() => openFolder(r.filePath!)}
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

      <p className="text-[12px] leading-relaxed text-fg-subtle">
        ≈ costo estimado con la tarifa oficial del proveedor; el valor exacto depende de tu plan.
        {stats.failed > 0 && ` ${stats.failed} intento(s) fallido(s) este mes, sin costo.`} El registro se guarda en{' '}
        <span className="allow-select text-fg-muted">{data?.dataDir ?? '…'}</span> y no se borra al actualizar la app.
      </p>
    </div>
  );
}
