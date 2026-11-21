'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Coffee, FolderOpen, Layers, Loader2, Moon, Pause, Play, RotateCcw, Square, Cpu } from 'lucide-react';
import type { EditProfile } from '@/config/editor-looks';
import type { Batch, BatchItemState, BatchPreview } from '@/lib/editor/batch';
import { FolderPickerModal } from '@/components/material/FolderPickerModal';

/**
 * Lotes nocturnos: una instrucción + una carpeta de videos → Claude edita varios a la vez y por
 * turnos (round robin) mientras nadie mira. Lo pesado hace cola en el PC.
 */

interface HeavyStatus {
  capacidad: number;
  enCurso: Array<{ trabajo: string; seg: number }>;
  enEspera: Array<{ trabajo: string; seg: number }>;
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Algo salió mal.');
  return d as T;
}

const ITEM_LABEL: Record<BatchItemState, string> = {
  pendiente: 'En cola',
  preparando: 'Preparando (copia y transcripción)',
  esperando: 'Esperando turno',
  trabajando: 'Claude trabajando',
  listo: 'Listo',
  sin_terminar: 'Sin terminar',
  error: 'Error',
};

const STATE_LABEL: Record<Batch['estado'], string> = {
  activo: 'En marcha',
  pausado: 'Pausado',
  sin_cupo: 'Esperando cupo de Claude',
  terminado: 'Terminado',
  cancelado: 'Cancelado',
};

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function BatchesPanel({ perfiles, onOpenEdit }: { perfiles: EditProfile[]; onOpenEdit: (id: string) => void }) {
  const [lotes, setLotes] = useState<Batch[] | null>(null);
  const [pesado, setPesado] = useState<HeavyStatus | null>(null);
  const [despierto, setDespierto] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await call<{ lotes: Batch[]; pesado: HeavyStatus; despierto: boolean }>('/api/editor/batches');
      setLotes(d.lotes);
      setPesado(d.pesado);
      setDespierto(d.despierto);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer los lotes.');
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const act = async (id: string, accion: string) => {
    if (accion === 'cancelar' && !window.confirm('¿Cancelar el lote? Los turnos en curso terminan y no empiezan otros.')) return;
    try {
      await call(`/api/editor/batches/${id}`, { accion });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo.');
    }
  };

  if (!lotes) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Moon className="h-4 w-4 text-accent" /> Lotes nocturnos
          </h2>
          <p className="text-[12px] text-fg-subtle">
            Una instrucción y una carpeta de videos: Claude edita varios a la vez y por turnos. Primero da una versión a todos y luego mejora las que no llegan a la nota.
            Los renders y lo pesado hacen cola para no ahogar el PC. Deja la app abierta y el equipo enchufado: no se dormirá mientras haya un lote en marcha.
          </p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="btn-primary h-9 px-3 text-[13px]">
            <Layers className="h-4 w-4" /> Nuevo lote
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button type="button" className="ml-auto text-fg-subtle hover:text-fg" onClick={() => setError(null)}>
            Cerrar
          </button>
        </p>
      )}

      {pesado && (pesado.enCurso.length > 0 || pesado.enEspera.length > 0 || despierto) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Trabajo pesado:{' '}
            {pesado.enCurso.length ? pesado.enCurso.map((r) => `${r.trabajo} (${mmss(r.seg)})`).join(', ') : 'nada ahora'}
            {pesado.enEspera.length ? ` · ${pesado.enEspera.length} en cola` : ''}
          </span>
          {despierto && (
            <span className="flex items-center gap-1.5">
              <Coffee className="h-3.5 w-3.5" /> El PC se mantiene despierto
            </span>
          )}
        </div>
      )}

      {creating && (
        <NewBatch
          perfiles={perfiles}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}

      {lotes.length === 0 && !creating && <p className="text-[13px] text-fg-subtle">Todavía no hay lotes.</p>}

      {lotes.map((b) => (
        <BatchCard key={b.id} b={b} onAction={(a) => void act(b.id, a)} onOpenEdit={onOpenEdit} />
      ))}
    </div>
  );
}

function BatchCard({ b, onAction, onOpenEdit }: { b: Batch; onAction: (a: string) => void; onOpenEdit: (id: string) => void }) {
  const [verRegistro, setVerRegistro] = useState(false);
  const listos = b.items.filter((it) => it.estado === 'listo').length;
  const validos = b.items.filter((it) => !it.error?.startsWith('Se omite')).length;
  const notas = b.items.map((it) => it.nota).filter((n): n is number => n != null);
  const media = notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null;
  const running = b.estado === 'activo' || b.estado === 'sin_cupo';
  const errores = b.items.filter((it) => it.estado === 'error' && !it.error?.startsWith('Se omite')).length;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-fg">{b.titulo}</h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            b.estado === 'sin_cupo' ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : running ? 'border-accent/40 text-accent' : 'border-line text-fg-muted'
          }`}
        >
          {STATE_LABEL[b.estado]}
          {b.estado === 'sin_cupo' && b.pausaHasta ? ` · sigue hacia las ${hhmm(b.pausaHasta)}` : ''}
        </span>
        <span className="text-[12px] text-fg-subtle">
          {listos}/{validos} listos{media != null ? ` · nota media ${media}` : ''} · {b.espacios} a la vez · hasta {b.pasadasMax} pasadas · objetivo {b.notaObjetivo}
          {b.horaLimite ? ` · hasta las ${hhmm(b.horaLimite)}` : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          {running && (
            <button type="button" onClick={() => onAction('pausar')} className="btn-secondary h-7 px-2.5 text-[11px]">
              <Pause className="h-3 w-3" /> Pausar
            </button>
          )}
          {(b.estado === 'pausado' || (b.estado === 'terminado' && b.items.some((it) => it.estado === 'sin_terminar'))) && (
            <button type="button" onClick={() => onAction('seguir')} className="btn-secondary h-7 px-2.5 text-[11px]">
              <Play className="h-3 w-3" /> Seguir
            </button>
          )}
          {errores > 0 && b.estado !== 'cancelado' && (
            <button type="button" onClick={() => onAction('reintentar')} className="btn-secondary h-7 px-2.5 text-[11px]">
              <RotateCcw className="h-3 w-3" /> Reintentar errores
            </button>
          )}
          {(running || b.estado === 'pausado') && (
            <button type="button" onClick={() => onAction('cancelar')} className="btn-secondary h-7 px-2.5 text-[11px]">
              <Square className="h-3 w-3" /> Cancelar
            </button>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-[12px] text-fg-muted" title={b.instruccion}>
        {b.instruccion}
      </p>

      <div className="divide-y divide-line rounded-lg border border-line">
        {b.items.map((it) => (
          <div key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-fg" title={it.ruta}>
              {it.nombre}
            </span>
            <span className="tabular-nums text-fg-subtle">{mmss(it.duracion)}</span>
            <span
              className={`flex items-center gap-1 ${
                it.estado === 'listo' ? 'text-emerald-600 dark:text-emerald-400' : it.estado === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-fg-muted'
              }`}
              title={it.error}
            >
              {it.estado === 'trabajando' || it.estado === 'preparando' ? <Loader2 className="h-3 w-3 animate-spin" /> : it.estado === 'listo' ? <CheckCircle2 className="h-3 w-3" /> : null}
              {ITEM_LABEL[it.estado]}
              {it.error ? `: ${it.error}` : ''}
            </span>
            <span className="tabular-nums text-fg-subtle">
              {it.pasadas ? `${it.pasadas} pasada${it.pasadas > 1 ? 's' : ''}` : ''}
              {it.nota != null ? ` · nota ${it.nota}` : ''}
            </span>
            {it.editId && (
              <button type="button" onClick={() => onOpenEdit(it.editId!)} className="text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                Abrir edición
              </button>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setVerRegistro((v) => !v)} className="text-[11px] text-fg-subtle hover:text-fg">
        {verRegistro ? 'Ocultar registro' : `Ver registro (${b.registro.length})`}
      </button>
      {verRegistro && (
        <ol className="desktop-scroll max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11px] text-fg-subtle">
          {[...b.registro].reverse().map((r, i) => (
            <li key={i}>
              {hhmm(r.t)} · {r.msg}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function NewBatch({ perfiles, onCancel, onCreated }: { perfiles: EditProfile[]; onCancel: () => void; onCreated: () => void }) {
  const [carpeta, setCarpeta] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [vista, setVista] = useState<BatchPreview | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [titulo, setTitulo] = useState('');
  const [instruccion, setInstruccion] = useState('');
  const [perfilId, setPerfilId] = useState(perfiles[0]?.id ?? '');
  const [marcas, setMarcas] = useState<Array<{ id: string; nombre: string; perfilId?: string; estado: string }>>([]);
  const [marcaId, setMarcaId] = useState('');
  const [espacios, setEspacios] = useState(2);
  const [pasadas, setPasadas] = useState(2);
  const [nota, setNota] = useState(75);
  const [limite, setLimite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/editor/brands', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { marcas: [] }))
      .then((d) => alive && setMarcas((d.marcas ?? []).filter((m: { estado: string }) => m.estado === 'activa')))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const preview = async (ruta: string, archivos?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const d = await call<{ vista: BatchPreview }>('/api/editor/batches', { accion: 'previsualizar', carpeta: ruta, ...(archivos ? { archivos } : {}) });
      if (!archivos) {
        setVista(d.vista);
        setElegidos(new Set(d.vista.videos.filter((v) => !v.problema).map((v) => v.nombre)));
      }
      return d.vista;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la carpeta.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggle = (n: string) => {
    const next = new Set(elegidos);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setElegidos(next);
  };

  const create = async () => {
    if (!vista || !elegidos.size) return;
    setBusy(true);
    setError(null);
    try {
      const archivos = [...elegidos];
      await call('/api/editor/batches', {
        accion: 'crear',
        titulo: titulo.trim(),
        instruccion: instruccion.trim(),
        carpeta: vista.carpeta,
        perfilId,
        ...(marcaId ? { marcaId } : {}),
        espacios,
        pasadasMax: pasadas,
        notaObjetivo: nota,
        ...(limite ? { horaLimite: limite } : {}),
        archivos,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el lote.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'input-clean h-9 px-2.5 text-[13px]';
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-fg">Instrucción para Claude (vale para todos los videos)</span>
            <textarea
              value={instruccion}
              onChange={(e) => setInstruccion(e.target.value)}
              rows={6}
              placeholder="Ej.: Reels de 30–45 s para Instagram, gancho fuerte en los 2 primeros segundos, subtítulos bajo el mentón y música suave. Quita repeticiones."
              className="input-clean w-full resize-y px-3 py-2 text-[13px]"
            />
            <span className="text-[11px] text-fg-subtle">Si un video necesita algo distinto, pon un .txt con el mismo nombre junto al video (p. ej. «video-3.txt»).</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPicking(true)} className="btn-secondary h-9 px-3 text-[13px]">
              <FolderOpen className="h-4 w-4" /> {carpeta ? 'Cambiar carpeta' : 'Elegir carpeta de videos'}
            </button>
            {carpeta && (
              <span className="truncate text-[12px] text-fg-muted" title={carpeta}>
                {carpeta}
              </span>
            )}
          </div>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="Nombre del lote (opcional)" className={`${field} w-full`} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <label className="col-span-2 space-y-1">
            <span className="text-fg-muted">Estilo</span>
            <select value={perfilId} onChange={(e) => setPerfilId(e.target.value)} className={`${field} w-full`}>
              {perfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          {marcas.length > 0 && (
            <label className="col-span-2 space-y-1">
              <span className="text-fg-muted">Marca</span>
              <select
                value={marcaId}
                onChange={(e) => {
                  setMarcaId(e.target.value);
                  const m = marcas.find((x) => x.id === e.target.value);
                  if (m?.perfilId && perfiles.some((x) => x.id === m.perfilId)) setPerfilId(m.perfilId);
                }}
                className={`${field} w-full`}
              >
                <option value="">Sin marca</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1" title="Cuántos videos edita Claude al mismo tiempo. Más espacios = más cupo de Claude a la vez; los renders igual hacen cola.">
            <span className="text-fg-muted">Videos a la vez</span>
            <select value={espacios} onChange={(e) => setEspacios(Number(e.target.value))} className={`${field} w-full`}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 2 ? ' (recomendado)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1" title="Pasada 1 = primera versión de cada video. Las siguientes solo para los que no llegan a la nota.">
            <span className="text-fg-muted">Pasadas máximas</span>
            <select value={pasadas} onChange={(e) => setPasadas(Number(e.target.value))} className={`${field} w-full`}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-fg-muted">Nota objetivo</span>
            <input type="number" min={0} max={100} value={nota} onChange={(e) => setNota(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className={`${field} w-full`} />
          </label>
          <label className="space-y-1" title="A partir de esta hora no empieza turnos nuevos (los que están en curso terminan).">
            <span className="text-fg-muted">Terminar antes de (opcional)</span>
            <input type="time" value={limite} onChange={(e) => setLimite(e.target.value)} className={`${field} w-full`} />
          </label>
        </div>
      </div>

      {vista && (
        <div className="space-y-2">
          <div className="text-[12px] text-fg-muted">
            {vista.videos.length} video(s) en la carpeta · elige cuáles entran
          </div>
          <div className="desktop-scroll max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {vista.videos.map((v) => (
              <label key={v.nombre} className={`flex items-center gap-3 px-3 py-1.5 text-[12px] ${v.problema ? 'opacity-60' : 'cursor-pointer'}`}>
                <input type="checkbox" disabled={!!v.problema} checked={elegidos.has(v.nombre)} onChange={() => toggle(v.nombre)} />
                <span className="min-w-0 flex-1 truncate text-fg">{v.nombre}</span>
                {v.instruccionPropia && <span className="text-[11px] text-accent">+ instrucción propia</span>}
                <span className="tabular-nums text-fg-subtle">{mmss(v.duracion)}</span>
                {v.problema && <span className="text-rose-600 dark:text-rose-400">{v.problema}</span>}
              </label>
            ))}
          </div>
          <p className="text-[12px] text-fg-muted">Las ediciones quedan como borrador: las apruebas tú.</p>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary h-9 px-3 text-[13px]">
          Cancelar
        </button>
        <button type="button" disabled={busy || !vista || !elegidos.size || instruccion.trim().length < 5 || !perfilId} onClick={() => void create()} className="btn-primary h-9 px-3 text-[13px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Moon className="h-4 w-4" />} Empezar lote ({elegidos.size})
        </button>
      </div>

      <FolderPickerModal
        open={picking}
        initial={carpeta}
        title="Carpeta de videos del lote"
        hint="Elige la carpeta con los videos en bruto (solo se toman los del primer nivel). Los originales no se tocan: cada edición trabaja sobre una copia. Claude también podrá ver el resto de la carpeta como material."
        onClose={() => setPicking(false)}
        onPick={async (ruta) => {
          setPicking(false);
          setCarpeta(ruta);
          await preview(ruta);
        }}
      />
    </section>
  );
}
