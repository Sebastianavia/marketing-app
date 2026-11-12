'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Check, Download, Loader2, Pencil, Plus, RotateCcw, X } from 'lucide-react';

/** Mismos datos que lib/editor/manual.ts (sin importar el módulo de servidor). */
type Area = 'ritmo' | 'cortes' | 'gancho' | 'subtitulos' | 'camara' | 'graficos' | 'sonido' | 'musica' | 'color' | 'cierre' | 'general';
const AREAS: Array<[Area, string]> = [
  ['ritmo', 'Ritmo y equilibrio'],
  ['cortes', 'Cortes'],
  ['gancho', 'Gancho'],
  ['subtitulos', 'Subtítulos'],
  ['camara', 'Cámara'],
  ['graficos', 'Gráficos y ayudas visuales'],
  ['sonido', 'Efectos de sonido'],
  ['musica', 'Música'],
  ['color', 'Color y estilo'],
  ['cierre', 'Cierre y CTA'],
  ['general', 'General'],
];
interface Rule {
  id: string;
  area: Area;
  regla: string;
  porQue?: string;
  estado: 'activa' | 'retirada';
  confirmaciones: number;
  fuentes: Array<{ video: string; nota?: string; fecha: string; quien: string }>;
  actualizada: string;
}
interface Manual {
  version: number;
  actualizado: string;
  reglas: Rule[];
}

async function call(method: 'GET' | 'PUT', body?: unknown) {
  const r = await fetch('/api/editor/manual', {
    method,
    cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo usar el manual.');
  return d as { manual: Manual; compartido: boolean; aviso?: string; skill: string };
}

/**
 * Manual de edición vivo: las reglas que Claude sigue en cada edición, aprendidas del feedback del
 * equipo. Compartido por todos (R2). Aquí se ven, se editan, se retiran o se añaden a mano.
 */
export function ManualPanel() {
  const [data, setData] = useState<{ manual: Manual; compartido: boolean; aviso?: string; skill: string } | null>(null);
  const [view, setView] = useState<'reglas' | 'skill'>('reglas');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; area: Area; regla: string; porQue: string } | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call('GET'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el manual.');
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (key: string, body: unknown) => {
    setBusy(key);
    setError(null);
    try {
      const d = await call('PUT', body);
      setData((cur) => ({ ...(cur ?? d), manual: d.manual, skill: d.skill }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!editing) return;
    const body = editing.id
      ? { accion: 'editar', id: editing.id, area: editing.area, regla: editing.regla, porQue: editing.porQue || undefined }
      : { accion: 'crear', area: editing.area, regla: editing.regla, porQue: editing.porQue || undefined };
    if (await act('guardar', body)) setEditing(null);
  };

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando el manual…
      </div>
    );
  }
  const reglas = data?.manual.reglas ?? [];
  const activas = reglas.filter((r) => r.estado === 'activa');
  const retiradas = reglas.filter((r) => r.estado === 'retirada');

  const editor = editing && (
    <div className="space-y-2 rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex flex-wrap gap-2">
        <select value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value as Area })} className="input-clean h-9 px-2 text-[12px]" aria-label="Área">
          {AREAS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea value={editing.regla} onChange={(e) => setEditing({ ...editing, regla: e.target.value })} rows={2} maxLength={300} placeholder="La regla, general y accionable. Ej.: nunca más de 2 efectos en el mismo segundo." className="input-clean w-full resize-y px-3 py-2 text-[13px]" />
      <input value={editing.porQue} onChange={(e) => setEditing({ ...editing, porQue: e.target.value })} maxLength={300} placeholder="Por qué (opcional)" className="input-clean h-9 w-full px-3 text-[12px]" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(null)} className="btn-secondary h-8 px-3 text-[12px]">
          Cancelar
        </button>
        <button type="button" onClick={() => void save()} disabled={editing.regla.trim().length < 10 || busy === 'guardar'} className="btn-primary h-8 px-3 text-[12px]">
          {busy === 'guardar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar
        </button>
      </div>
    </div>
  );

  const card = (r: Rule) => (
    <li key={r.id} className={`space-y-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 ${r.estado === 'retirada' ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] text-fg">{r.regla}</p>
        {r.confirmaciones > 1 && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted" title="Veces que el feedback la confirmó">
            ×{r.confirmaciones}
          </span>
        )}
        <button type="button" onClick={() => setEditing({ id: r.id, area: r.area, regla: r.regla, porQue: r.porQue ?? '' })} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Editar regla">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {r.estado === 'activa' ? (
          <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, { accion: 'retirar', id: r.id })} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Retirar regla" title="Retirar (Claude dejará de seguirla)">
            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, { accion: 'reactivar', id: r.id })} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Reactivar regla" title="Reactivar">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {r.porQue && <p className="text-[11px] text-fg-muted">{r.porQue}</p>}
      <details className="text-[11px] text-fg-subtle">
        <summary className="cursor-pointer hover:text-fg-muted">De dónde salió ({r.fuentes.length})</summary>
        <ul className="mt-1 space-y-0.5">
          {r.fuentes
            .slice()
            .reverse()
            .map((f, i) => (
              <li key={i}>
                {new Date(f.fecha).toLocaleDateString('es')} · {f.video} · {f.quien}
                {f.nota ? ` — «${f.nota}»` : ''}
              </li>
            ))}
        </ul>
      </details>
    </li>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[75ch] space-y-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <BookOpen className="h-4 w-4 text-accent" /> Manual de edición
          </h2>
          <p className="text-[12px] text-fg-muted">
            El formato Lulo: las reglas que Claude sigue en cada edición. Se alimenta solo con el feedback del equipo (cuando Claude responde unas notas,
            guarda lo que sirve para futuros videos) y con lo que le pidas en el chat. {data?.compartido ? 'Compartido por todo el equipo.' : ''}
          </p>
          <p className="text-[11px] text-fg-subtle">
            Versión {data?.manual.version ?? '—'} · {activas.length} reglas activas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-[12px]" role="tablist" aria-label="Vista del manual">
            {(['reglas', 'skill'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 ${view === v ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}
              >
                {v === 'reglas' ? 'Reglas' : 'Ver como skill'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setEditing({ id: null, area: 'general', regla: '', porQue: '' })} className="btn-secondary h-9 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Añadir regla
          </button>
        </div>
      </div>

      {view === 'skill' && data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-fg-muted">Así lee Claude el manual en cada edición (las reglas activas, las más confirmadas primero).</p>
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(data.skill)}`}
              download="SKILL.md"
              className="btn-secondary h-8 px-3 text-[12px]"
            >
              <Download className="h-3.5 w-3.5" /> Descargar SKILL.md
            </a>
          </div>
          <pre className="desktop-scroll max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed text-fg">{data.skill}</pre>
        </div>
      )}

      {(error || data?.aviso) && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error ?? data?.aviso}
        </p>
      )}

      {editing && !editing.id && editor}

      {view === 'reglas' && (<>
      <div className="grid gap-5 lg:grid-cols-2">
        {AREAS.map(([area, label]) => {
          const rs = activas.filter((r) => r.area === area).sort((a, b) => b.confirmaciones - a.confirmaciones);
          if (!rs.length) return null;
          return (
            <div key={area} className="space-y-2">
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-fg-muted">{label}</h3>
              <ul className="space-y-2">{rs.map((r) => (editing?.id === r.id ? <li key={r.id}>{editor}</li> : card(r)))}</ul>
            </div>
          );
        })}
      </div>

      {retiradas.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowRetired((v) => !v)} className="text-[12px] text-fg-muted hover:text-fg">
            {showRetired ? 'Ocultar' : 'Ver'} reglas retiradas ({retiradas.length})
          </button>
          {showRetired && <ul className="grid gap-2 lg:grid-cols-2">{retiradas.map((r) => (editing?.id === r.id ? <li key={r.id}>{editor}</li> : card(r)))}</ul>}
        </div>
      )}
      </>)}
    </section>
  );
}
