'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleDashed, Clock, Download, Loader2, Plus, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { ClaudeAgentChat } from '@/components/claude/ClaudeAgentChat';
import { agentApi } from '@/components/claude/agent-api';
import { useOrchestratorMode } from '@/components/claude/useOrchestratorMode';
import { STUDIO_SERVICES, type ServiceStatus } from '@/lib/studio/services';
import type { ClaudeChatState } from '@/lib/ai/claude-code/agent-types';

/**
 * Estudio Claude: chat a pantalla completa donde Claude hace el video usando las herramientas de
 * la app (UGC Studio, Edición de video…). Las decisiones, los costos (con tarjeta para aprobar) y
 * los videos aparecen en el mismo chat. Las herramientas siguen funcionando por separado.
 */

interface ProjectRow {
  id: string;
  titulo: string;
  actualizado: string;
  mensajes: number;
  gastoUSD: number;
}

interface Approval {
  id: string;
  concepto: string;
  montoUSD: number;
  usadoUSD: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
}

interface Media {
  id: string;
  tipo: 'video' | 'imagen' | 'audio';
  titulo: string;
  nombre: string;
}

interface Project {
  id: string;
  titulo: string;
  carpeta: string;
  chat?: ClaudeChatState;
  aprobaciones: Approval[];
  medios: Media[];
  gastoUSD: number;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Algo salió mal.');
  return d as T;
}

const STATUS: Record<ServiceStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  listo: { label: 'Listo', icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: 'text-emerald-600 dark:text-emerald-400' },
  en_pruebas: { label: 'En pruebas', icon: <Clock className="h-3.5 w-3.5" />, cls: 'text-amber-600 dark:text-amber-400' },
  en_construccion: { label: 'En construcción', icon: <CircleDashed className="h-3.5 w-3.5" />, cls: 'text-fg-subtle' },
};

const STEP_NAMES: Record<string, string> = {
  'lulo: servicios': 'Revisando qué herramientas hay',
  'lulo: ver_proyecto': 'Mirando el proyecto',
  'lulo: pedir_aprobacion': 'Pidiendo tu aprobación',
  'lulo: mostrar': 'Preparando el resultado',
  'lulo: ver_fotogramas': 'Mirando el video',
  'lulo: ugc_storyboard': 'UGC: el equipo arma el storyboard',
  'lulo: ugc_cambiar_escena': 'UGC: rehaciendo una escena',
  'lulo: ugc_costo': 'UGC: calculando el costo',
  'lulo: ugc_renderizar': 'UGC: renderizando con HeyGen',
  'lulo: ugc_montar': 'UGC: montando el video',
  'lulo: editar_video': 'Edición: el editor trabaja el video',
  'lulo: editar_mas': 'Edición: aplicando cambios',
  'lulo: avatares_y_voces': 'Avatar: mirando avatares y voces',
  'lulo: avatar_costo': 'Avatar: calculando el costo',
  'lulo: avatar_video': 'Avatar: generando la voz y el video',
  'lulo: voz_costo': 'Voz: calculando el costo',
  'lulo: voz_generar': 'Voz: generando el audio con ElevenLabs',
  'lulo: imagen_costo': 'Imágenes: calculando el costo',
  'lulo: imagen_crear': 'Imágenes: generando las imágenes',
  'lulo: clonacion_costo': 'Clonación: calculando el costo',
  'lulo: clonacion_video': 'Clonación: Seedance está reemplazando la persona',
};

const SUGGESTIONS = [
  'Hazme un anuncio UGC de 15 s de mi producto y edítalo para Reels',
  'Edita este video para TikTok con subtítulos y efectos',
  '¿Qué tipo de videos puedes hacer y cuánto cuestan?',
];

export function ClaudeStudioView({ onExit }: { onExit: () => void }) {
  const mode = useOrchestratorMode();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [current, setCurrent] = useState<Project | null>(null);
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const d = await api<{ proyectos: ProjectRow[] }>('/api/studio').catch(() => null);
    if (d) setProjects(d.proyectos);
  }, []);

  const open = useCallback(async (id: string, opts: { silent?: boolean } = {}) => {
    try {
      const d = await api<{ proyecto: Project }>(`/api/studio/${id}`);
      setCurrent(d.proyecto);
      try {
        localStorage.setItem('lulo_studio_activo', id);
      } catch {
        // solo no se recuerda
      }
    } catch (err) {
      // El proyecto recordado ya no existe: se olvida sin mostrar error
      if (opts.silent) {
        try {
          localStorage.removeItem('lulo_studio_activo');
        } catch {
          // nada que olvidar
        }
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo abrir.');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadList();
      let last: string | null = null;
      try {
        last = localStorage.getItem('lulo_studio_activo');
      } catch {
        last = null;
      }
      if (last) void open(last, { silent: true });
    }, 0);
    return () => clearTimeout(t);
  }, [loadList, open]);

  const reload = useCallback(() => {
    if (current) void open(current.id);
    void loadList();
  }, [current, open, loadList]);

  /** Proyecto nuevo con el primer mensaje: el título sale de sus primeras palabras. */
  const start = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setBusy('crear');
    setError(null);
    try {
      const { proyecto } = await api<{ proyecto: Project }>('/api/studio', json({ titulo: t.split(/\s+/).slice(0, 7).join(' ') }));
      await agentApi.send(`/api/studio/${proyecto.id}/claude`, t);
      setFirst('');
      await open(proyecto.id);
      void loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar.');
    } finally {
      setBusy(null);
    }
  };

  const decide = async (a: Approval, accion: 'aprobar' | 'rechazar') => {
    if (!current) return;
    setBusy(a.id);
    setError(null);
    try {
      await api(`/api/studio/${current.id}/approvals`, json({ accion, aprobacionId: a.id, montoUSD: a.montoUSD }));
      // Claude estaba esperando: se le avisa para que siga
      await agentApi.send(
        `/api/studio/${current.id}/claude`,
        accion === 'aprobar'
          ? `✅ Aprobé «${a.concepto}» por $${a.montoUSD.toFixed(2)} (id ${a.id}). Sigue.`
          : `❌ No apruebo «${a.concepto}». Propón otra opción más barata o sin ese paso.`
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la decisión.');
    } finally {
      setBusy(null);
    }
  };

  const attach = async (files: File[]) => {
    if (!current) return [];
    const form = new FormData();
    files.forEach((f) => form.append('archivos', f, f.name));
    const r = await fetch(`/api/studio/${current.id}/files`, { method: 'POST', body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudieron adjuntar.');
    return d.archivos as string[];
  };

  const renderMedia = (id: string) => {
    const m = current?.medios.find((x) => x.id === id);
    if (!current || !m) return <p className="text-[12px] text-fg-subtle">(Resultado no disponible)</p>;
    const src = `/api/studio/${current.id}/media?m=${m.id}`;
    return (
      <figure className="my-1 max-w-sm space-y-1.5 rounded-xl border border-line bg-surface-2 p-2">
        {m.tipo === 'video' ? (
          <video src={src} controls playsInline className="max-h-[520px] w-full rounded-lg bg-black" />
        ) : m.tipo === 'audio' ? (
          <audio src={src} controls className="w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={m.titulo} className="w-full rounded-lg" />
        )}
        <figcaption className="flex items-center justify-between gap-2 px-1 text-[11px] text-fg-muted">
          <span className="truncate">{m.titulo}</span>
          <a href={`${src}&descargar=1`} className="inline-flex shrink-0 items-center gap-1 hover:text-fg">
            <Download className="h-3 w-3" /> Descargar
          </a>
        </figcaption>
      </figure>
    );
  };

  const pending = current?.aprobaciones.filter((a) => a.estado === 'pendiente') ?? [];
  const approvalCards = pending.length ? (
    <div className="space-y-2">
      {pending.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/50 bg-accent/5 px-4 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-fg">Claude pide aprobar ${a.montoUSD.toFixed(2)}</p>
            <p className="text-[12px] text-fg-muted">{a.concepto}</p>
          </div>
          <button type="button" disabled={!!busy} onClick={() => void decide(a, 'rechazar')} className="btn-secondary h-9 px-3 text-[12px]">
            <XCircle className="h-3.5 w-3.5" /> No
          </button>
          <button type="button" disabled={!!busy} onClick={() => void decide(a, 'aprobar')} className="btn-primary h-9 px-4 text-[12px]">
            {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Aprobar ${a.montoUSD.toFixed(2)}
          </button>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0">
      {/* Columna izquierda: proyectos y servicios */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4 lg:flex">
        <button type="button" onClick={onExit} className="-ml-1 inline-flex items-center gap-1.5 text-[12px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al dashboard
        </button>
        <button type="button" onClick={() => setCurrent(null)} className="btn-primary h-9 w-full text-[13px]">
          <Plus className="h-4 w-4" /> Nuevo video
        </button>
        <div className="space-y-1">
          <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Tus videos con Claude</p>
          {projects.length === 0 && <p className="px-1 text-[12px] text-fg-subtle">Todavía ninguno.</p>}
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => void open(p.id)}
              className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${current?.id === p.id ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
            >
              <span className="block truncate text-[12.5px] text-fg">{p.titulo}</span>
              <span className="block text-[11px] text-fg-subtle">
                {new Date(p.actualizado).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {p.gastoUSD > 0 ? ` · $${p.gastoUSD.toFixed(2)}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Servicios para Claude</p>
          {STUDIO_SERVICES.map((s) => {
            const st = STATUS[s.estado];
            return (
              <div key={s.id} className="rounded-lg border border-line px-2.5 py-2" title={`${s.hace} · ${s.costo}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-fg">{s.nombre}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-[10.5px] ${st.cls}`}>
                    {st.icon} {st.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-snug text-fg-subtle">{s.costo}</p>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Ventana estrecha: la columna izquierda se oculta, así que aquí van volver, nuevo y la lista */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 lg:hidden">
          <button type="button" onClick={onExit} className="btn-secondary h-8 w-8 shrink-0 px-0" aria-label="Volver al dashboard">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <select
            value={current?.id ?? ''}
            onChange={(e) => (e.target.value ? void open(e.target.value) : setCurrent(null))}
            className="input-clean h-8 min-w-0 flex-1 px-2 text-[12px]"
            aria-label="Tus videos con Claude"
          >
            <option value="">Nuevo video…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setCurrent(null)} className="btn-primary h-8 shrink-0 px-3 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </button>
        </div>
        {mode && mode !== 'claude-subscription' && (
          <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-800 dark:text-amber-200">
            El Estudio Claude usa tu suscripción de Claude. En el selector «IA» de arriba elige «Claude · mi suscripción» para que las herramientas también usen a Claude.
          </p>
        )}
        {error && <p className="border-b border-rose-500/30 px-4 py-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
        {current ? (
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
            <ClaudeAgentChat
              key={current.id}
              endpoint={`/api/studio/${current.id}/claude`}
              mensajes={current.chat?.mensajes ?? []}
              onChanged={reload}
              title={current.titulo}
              intro={`Gastado en este video: $${current.gastoUSD.toFixed(2)} · carpeta ${current.carpeta.split(/[\\/]/).slice(-2).join('/')}`}
              placeholder="Pídele cambios, otro video o adjunta material…"
              stepNames={STEP_NAMES}
              refreshOnStep
              fill
              renderMedia={renderMedia}
              topSlot={approvalCards}
              onAttach={attach}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-accent" />
              <h2 className="font-display text-3xl text-fg">¿Qué video hacemos?</h2>
            </div>
            <p className="max-w-xl text-center text-[13px] text-fg-muted">
              Pídeselo a Claude como a un productor. Él elige las herramientas de Lulo Studio, te muestra el plan y los costos, te pide aprobación antes de gastar y
              te entrega el video aquí mismo.
            </p>
            <div className="w-full max-w-2xl space-y-3">
              <textarea
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void start(first);
                  }
                }}
                rows={4}
                placeholder="Ej.: un anuncio UGC de 15 s para mi app Lulo Studio, para jóvenes emprendedores, editado para Reels con efectos virales"
                className="input-clean w-full resize-y px-4 py-3 text-[14px]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => setFirst(s)} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg">
                      {s}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => void start(first)} disabled={!first.trim() || busy === 'crear'} className="btn-primary h-10 px-5 text-[13px]">
                  {busy === 'crear' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Empezar
                </button>
              </div>
              <p className="text-center text-[11px] text-fg-subtle">Podrás adjuntar fotos o videos en cuanto empiece la conversación.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
