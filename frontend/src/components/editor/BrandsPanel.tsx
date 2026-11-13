'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, Pencil, Plus, RotateCcw, Stamp, Upload, X } from 'lucide-react';

/** Mismos datos que lib/editor/kit/brands.ts (sin importar el módulo de servidor). */
const FONTS = ['Archivo Black', 'Montserrat', 'Oswald', 'League Gothic', 'Poppins', 'Inter', 'Outfit', 'Nunito', 'Playfair Display', 'EB Garamond', 'Space Mono', 'Roboto', 'Lato', 'Open Sans'];
interface Brand {
  id: string;
  nombre: string;
  colores: { primario: string; acento: string; texto: string };
  fuente: string;
  lema?: string;
  usuario?: string;
  cta?: string;
  nota?: string;
  estandar?: string;
  logoExt?: string;
  actualizada: string;
  quien: string;
  estado: 'activa' | 'retirada';
}
type Data = { marcas: Brand[]; compartidas: boolean; aviso?: string };

const API = '/api/editor/brands';

async function readJson(r: Response): Promise<Data> {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudieron usar las marcas.');
  return d as Data;
}

interface Draft {
  id?: string;
  nombre: string;
  primario: string;
  acento: string;
  texto: string;
  fuente: string;
  lema: string;
  usuario: string;
  cta: string;
  nota: string;
  estandar: string;
  logo: File | null;
}
const emptyDraft = (): Draft => ({ nombre: '', primario: '#0B0B0B', acento: '#C6FF3D', texto: '#FFFFFF', fuente: 'Archivo Black', lema: '', usuario: '', cta: '', nota: '', estandar: '', logo: null });

/**
 * Marcas del equipo: logo, colores, tipografía, lema y CTA. Claude las usa para la intro y el cierre
 * de los videos de cada marca (kit de gráficos). Compartidas por todos en R2.
 */
export function BrandsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await readJson(await fetch(API, { cache: 'no-store' })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer las marcas.');
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy('guardar');
    setError(null);
    try {
      const fd = new FormData();
      if (draft.id) fd.append('id', draft.id);
      if (draft.logo) fd.append('logo', draft.logo);
      fd.append(
        'datos',
        JSON.stringify({
          nombre: draft.nombre.trim(),
          colores: { primario: draft.primario, acento: draft.acento, texto: draft.texto },
          fuente: draft.fuente,
          lema: draft.lema.trim() || undefined,
          usuario: draft.usuario.trim() || undefined,
          cta: draft.cta.trim() || undefined,
          nota: draft.nota.trim() || undefined,
          estandar: draft.estandar.trim() || undefined,
        })
      );
      setData(await readJson(await fetch(API, { method: 'POST', body: fd })));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(null);
    }
  };

  const setState = async (id: string, accion: 'retirar' | 'reactivar') => {
    setBusy(id);
    setError(null);
    try {
      setData(await readJson(await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, id }) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(null);
    }
  };

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando las marcas…
      </div>
    );
  }
  const marcas = (data?.marcas ?? []).filter((m) => (showRetired ? m.estado === 'retirada' : m.estado === 'activa'));
  const color = (key: 'primario' | 'acento' | 'texto', label: string) =>
    draft && (
      <label className="flex items-center gap-2 text-[12px] text-fg-muted">
        <input type="color" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value.toUpperCase() })} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" aria-label={label} />
        {label}
      </label>
    );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[75ch] space-y-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Stamp className="h-4 w-4 text-accent" /> Marcas
          </h2>
          <p className="text-[12px] text-fg-muted">
            Logo, colores, tipografía y llamada a la acción de cada marca o cliente. Cuando un video es de una marca, Claude hace su intro y su cierre con estos datos (kit de gráficos).
            {data?.compartidas ? ' Compartidas por todo el equipo.' : ''}
          </p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft(emptyDraft())} className="btn-primary h-9 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nueva marca
          </button>
        )}
      </div>

      {data?.aviso && <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-fg-muted">{data.aviso}</p>}
      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} maxLength={60} placeholder="Nombre de la marca" className="input-clean h-9 px-3 text-[13px]" />
            <select value={draft.fuente} onChange={(e) => setDraft({ ...draft, fuente: e.target.value })} className="input-clean h-9 px-2 text-[12px]" aria-label="Tipografía">
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-4">
            {color('primario', 'Primario')}
            {color('acento', 'Acento')}
            {color('texto', 'Texto')}
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-fg-muted hover:border-accent/60">
            <Upload className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">{draft.logo ? draft.logo.name : draft.id ? 'Cambiar logo (opcional; mejor PNG o SVG con fondo transparente)' : 'Logo (opcional; mejor PNG o SVG con fondo transparente)'}</span>
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" className="sr-only" onChange={(e) => setDraft({ ...draft, logo: e.target.files?.[0] ?? null })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={draft.lema} onChange={(e) => setDraft({ ...draft, lema: e.target.value })} maxLength={80} placeholder="Lema (opcional)" className="input-clean h-9 px-3 text-[12px]" />
            <input value={draft.usuario} onChange={(e) => setDraft({ ...draft, usuario: e.target.value })} maxLength={40} placeholder="Usuario: @marca" className="input-clean h-9 px-3 text-[12px]" />
            <input value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} maxLength={60} placeholder="CTA del cierre: Síguenos" className="input-clean h-9 px-3 text-[12px]" />
          </div>
          <input value={draft.nota} onChange={(e) => setDraft({ ...draft, nota: e.target.value })} maxLength={300} placeholder="Nota para Claude (tono, cuándo usar intro o cierre…)" className="input-clean h-9 w-full px-3 text-[12px]" />
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-fg">Estándar de edición del cliente (opcional)</span>
            <span className="block text-[11px] text-fg-muted">Pega aquí las reglas de edición que entrega el cliente. En los videos de esta marca, Claude las sigue por encima del manual general y avisa de lo que el motor no pueda cumplir.</span>
            <textarea value={draft.estandar} onChange={(e) => setDraft({ ...draft, estandar: e.target.value })} maxLength={40000} rows={8} placeholder="ESTÁNDAR DE EDICIÓN … (formato, corte, subtítulos, colores, efectos, cierre…)" className="input-clean w-full resize-y px-3 py-2 font-mono text-[11px]" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn-secondary h-8 px-3 text-[12px]">
              Cancelar
            </button>
            <button type="button" onClick={() => void save()} disabled={draft.nombre.trim().length < 2 || busy === 'guardar'} className="btn-primary h-8 px-3 text-[12px]">
              {busy === 'guardar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end text-[12px]">
        <button type="button" onClick={() => setShowRetired((v) => !v)} className="text-fg-subtle hover:text-fg-muted">
          {showRetired ? 'Ver activas' : `Ver retiradas (${(data?.marcas ?? []).filter((m) => m.estado === 'retirada').length})`}
        </button>
      </div>

      {marcas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg-muted">{showRetired ? 'No hay marcas retiradas.' : 'Todavía no hay marcas. Crea la de Lulo o la de un cliente.'}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {marcas.map((m) => (
            <li key={m.id} className={`flex items-start gap-3 rounded-xl border border-line bg-surface p-3 ${m.estado === 'retirada' ? 'opacity-60' : ''}`}>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: m.colores.primario }}>
                {m.logoExt && m.estado === 'activa' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${API}?logo=${encodeURIComponent(m.id)}&v=${encodeURIComponent(m.actualizada)}`} alt={`Logo de ${m.nombre}`} className="h-12 w-12 object-contain" />
                ) : (
                  <span className="text-[18px] font-bold" style={{ color: m.colores.acento }}>
                    {m.nombre.slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[13px] font-medium text-fg">{m.nombre}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                  {[m.colores.primario, m.colores.acento, m.colores.texto].map((c, i) => (
                    <span key={i} className="inline-block h-3 w-3 rounded-full border border-line" style={{ background: c }} title={c} />
                  ))}
                  <span className="ml-1">{m.fuente}</span>
                </p>
                {(m.lema || m.usuario || m.cta) && <p className="truncate text-[11px] text-fg-muted">{[m.lema, m.cta, m.usuario].filter(Boolean).join(' · ')}</p>}
                {m.estandar?.trim() && <p className="text-[11px] font-medium text-accent">Con estándar de edición ({m.estandar.trim().split('\n').length} líneas)</p>}
              </div>
              {m.estado === 'activa' ? (
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({ id: m.id, nombre: m.nombre, primario: m.colores.primario, acento: m.colores.acento, texto: m.colores.texto, fuente: m.fuente, lema: m.lema ?? '', usuario: m.usuario ?? '', cta: m.cta ?? '', nota: m.nota ?? '', estandar: m.estandar ?? '', logo: null })
                    }
                    className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                    aria-label={`Editar ${m.nombre}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={busy === m.id} onClick={() => void setState(m.id, 'retirar')} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Retirar ${m.nombre}`}>
                    {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ) : (
                <button type="button" disabled={busy === m.id} onClick={() => void setState(m.id, 'reactivar')} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Reactivar ${m.nombre}`}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
