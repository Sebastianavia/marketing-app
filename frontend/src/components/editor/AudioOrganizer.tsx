'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, Sparkles, Tags, X } from 'lucide-react';

/**
 * Organizar la biblioteca de audio: «Ordenar etiquetas» (gratis, al instante) y «Organizar con
 * Claude» (propone nombre, tipo, etiquetas y nota de uso; la persona revisa y guarda lo que quiera).
 */

type Kind = 'efecto' | 'musica' | 'ambiente';
interface Fields {
  nombre: string;
  tipo: Kind;
  etiquetas: string[];
  nota?: string;
}
interface Proposal {
  id: string;
  antes: Fields;
  despues: Fields & { nota: string };
  medidas: string;
}
interface Job {
  id: string;
  estado: 'midiendo' | 'pensando' | 'listo' | 'error' | 'cancelado';
  total: number;
  hechos: number;
  propuestas: Proposal[];
  error?: string;
}
interface Row {
  id: string;
  sel: boolean;
  nombre: string;
  tipo: Kind;
  etiquetas: string;
  nota: string;
  antes: Fields;
  medidas: string;
}

const API = '/api/editor/audio-library/organize';
const KIND_LABEL: Record<Kind, string> = { efecto: 'Efecto', musica: 'Música', ambiente: 'Ambiente' };

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo organizar la biblioteca.');
  return d as T;
}

export function AudioOrganizer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const running = !!job && (job.estado === 'midiendo' || job.estado === 'pensando');

  useEffect(() => {
    if (!running || !job) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${API}?id=${job.id}`, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Se perdió la organización.');
        const j: Job = d.organizacion;
        setJob(j);
        // Las filas nuevas se añaden según llegan (lo ya editado no se toca)
        setRows((prev) => {
          const have = new Set(prev.map((x) => x.id));
          const add = j.propuestas
            .filter((p) => !have.has(p.id))
            .map((p) => ({
              id: p.id,
              sel: p.despues.nombre !== p.antes.nombre || p.despues.tipo !== p.antes.tipo || p.despues.etiquetas.join('|') !== p.antes.etiquetas.join('|') || (!!p.despues.nota && p.despues.nota !== p.antes.nota),
              nombre: p.despues.nombre,
              tipo: p.despues.tipo,
              etiquetas: p.despues.etiquetas.join(', '),
              nota: p.despues.nota,
              antes: p.antes,
              medidas: p.medidas,
            }));
          return add.length ? [...prev, ...add] : prev;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Se perdió la organización.');
        setJob(null);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [running, job]);

  const tidy = async () => {
    setBusy('ordenar');
    setError(null);
    try {
      const r = await post<{ revisados: number; cambiados: number }>({ accion: 'ordenar' });
      setMsg(r.cambiados ? `Etiquetas ordenadas en ${r.cambiados} de ${r.revisados} audios (sin repetidas ni genéricas, y el tipo según la carpeta).` : `Los ${r.revisados} audios ya estaban en orden.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ordenar.');
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setBusy('proponer');
    setError(null);
    setRows([]);
    try {
      const d = await post<{ organizacion: Job }>({ accion: 'proponer', todos });
      setJob(d.organizacion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const cambios = rows
      .filter((r) => r.sel)
      .map((r) => ({ id: r.id, nombre: r.nombre.trim(), tipo: r.tipo, etiquetas: r.etiquetas.split(',').map((t) => t.trim()).filter(Boolean), nota: r.nota.trim() }));
    if (!cambios.length) return;
    setBusy('guardar');
    setError(null);
    try {
      const r = await post<{ aplicados: number }>({ accion: 'aplicar', cambios });
      setMsg(`Guardados ${r.aplicados} audios. Claude ya los ve con su nombre, etiquetas y nota nuevos.`);
      setRows([]);
      setJob(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(null);
    }
  };

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.sel).length;

  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-medium text-fg">Organizar la biblioteca</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-fg-muted">
        1) <b className="font-medium text-fg">Ordenar etiquetas</b>: gratis y al instante; quita etiquetas repetidas («epico» y «épico») o que no aportan, y corrige el tipo según la carpeta. 2){' '}
        <b className="font-medium text-fg">Organizar con Claude</b>: propone nombre, tipo, etiquetas y una nota de uso para cada audio (no los oye: decide por el nombre, la carpeta, la duración, el BPM y medidas del sonido). Revisas y guardas lo que quieras.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void tidy()} disabled={!!busy || running} className="btn-secondary h-8 px-3 text-[12px]">
          {busy === 'ordenar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tags className="h-3.5 w-3.5" />} Ordenar etiquetas
        </button>
        <button type="button" onClick={() => void start()} disabled={!!busy || running} className="btn-primary h-8 px-3 text-[12px]">
          {busy === 'proponer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Organizar con Claude
        </button>
        <label className="flex items-center gap-1.5 text-fg-muted" title="Sin marcar: solo los audios con nombre poco claro o sin etiquetas. Marcado: todos (también para añadirles una nota de uso).">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} disabled={running} /> Todos (añadir nota de uso)
        </label>
      </div>

      {msg && <p className="rounded-lg border border-line px-3 py-2 text-fg-muted">{msg}</p>}
      {error && (
        <p className="flex items-center gap-2 text-red-600 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {job && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-fg-muted">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : <Check className="h-3.5 w-3.5 text-accent" />}
            {job.estado === 'midiendo' ? 'Midiendo los audios' : job.estado === 'pensando' ? 'Claude está proponiendo' : job.estado === 'error' ? 'Error' : job.estado === 'cancelado' ? 'Detenido' : 'Propuestas listas'} · {job.hechos}/{job.total}
            {running && (
              <button type="button" onClick={() => void post({ accion: 'cancelar', id: job.id }).catch(() => undefined)} className="btn-secondary ml-2 h-6 px-2 text-[11px]">
                Detener
              </button>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${job.total ? Math.round((job.hechos / job.total) * 100) : 0}%` }} />
          </div>
          {job.error && <p className="text-red-600 dark:text-red-300">{job.error}</p>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="desktop-scroll max-h-[480px] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] text-left">
              <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="w-8 p-2">
                    <input type="checkbox" checked={selected === rows.length} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, sel: e.target.checked })))} aria-label="Elegir todos" />
                  </th>
                  <th className="p-2">Nombre</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Etiquetas (comas)</th>
                  <th className="p-2">Nota de uso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={r.sel ? '' : 'opacity-60'}>
                    <td className="p-2 align-top">
                      <input type="checkbox" checked={r.sel} onChange={(e) => set(r.id, { sel: e.target.checked })} aria-label={`Guardar ${r.nombre}`} />
                    </td>
                    <td className="p-2 align-top">
                      <input value={r.nombre} onChange={(e) => set(r.id, { nombre: e.target.value })} maxLength={80} className="input-clean h-8 w-full px-2 text-[12px]" />
                      <p className="mt-1 truncate text-[10px] text-fg-subtle" title={`${r.antes.nombre} · ${r.medidas}`}>
                        antes: {r.antes.nombre} · {r.medidas}
                      </p>
                    </td>
                    <td className="p-2 align-top">
                      <select value={r.tipo} onChange={(e) => set(r.id, { tipo: e.target.value as Kind })} className="input-clean h-8 px-2 text-[12px]">
                        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <input value={r.etiquetas} onChange={(e) => set(r.id, { etiquetas: e.target.value })} className="input-clean h-8 w-full px-2 text-[12px]" />
                    </td>
                    <td className="p-2 align-top">
                      <input value={r.nota} onChange={(e) => set(r.id, { nota: e.target.value })} maxLength={300} className="input-clean h-8 w-full px-2 text-[12px]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-fg-subtle">{selected} elegidos</span>
            <button type="button" onClick={() => void save()} disabled={!selected || busy === 'guardar'} className="btn-primary h-8 px-3 text-[12px]">
              {busy === 'guardar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar elegidos
            </button>
          </div>
        </>
      )}
    </div>
  );
}
