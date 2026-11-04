'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CircleHelp,
  ImageDown,
  XCircle,
  Check,
  CheckCircle2,
  Circle,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { EditProfile } from '@/config/editor-looks';
import { ORCHESTRATOR_OPTIONS } from '@/config/llm-models';
import { ACTIVE_STATUSES, type EditGraphic, type EditPhrase, type EditProject, type GraphicType } from '@/lib/editor/types';
import { formatClock, keptIntervals, phraseText, totalDuration } from '@/lib/editor/timeline';
import { downloadUrl, editorApi, mediaUrl } from './editor-api';
import { StatusBadge } from './EditsList';
import { LookDots } from './LookPreview';
import { ClaudeEditChat } from './ClaudeEditChat';

/**
 * Una edición de principio a fin: avance en vivo → revisar guion (cortes en rojo, textos,
 * gancho, palabras clave, perfil) → borrador → aprobar (queda en Proyectos → Ediciones).
 */

interface Props {
  id: string;
  perfiles: EditProfile[];
  onBack: () => void;
  onChanged: () => void;
}

export function EditDetail({ id, perfiles, onBack, onChanged }: Props) {
  const [edit, setEdit] = useState<EditProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEdit(await editorApi.edit(id));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la edición.');
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    editorApi
      .edit(id)
      .then((e) => {
        if (!alive) return;
        setEdit(e);
        setLoadError(null);
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la edición.'));
    return () => {
      alive = false;
    };
  }, [id]);

  // Mientras se procesa, se consulta el avance cada 1,5 s
  const working = !!edit && (ACTIVE_STATUSES.includes(edit.estado) || !!edit.tarea);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [working, load]);

  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      setEdit(await editorApi.action(id, body));
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <p className="flex items-center gap-2 text-[13px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4" /> {loadError}
        </p>
      </div>
    );
  }
  if (!edit) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  const rename = () => {
    const t = window.prompt('Nombre de la edición', edit.titulo);
    if (t && t.trim() && t.trim() !== edit.titulo) void run('renombrar', { accion: 'renombrar', titulo: t.trim() });
  };
  const remove = async () => {
    if (!window.confirm('¿Quitar esta edición de la lista? Los archivos se quedan en su carpeta.')) return;
    try {
      await editorApi.remove(id);
      onChanged();
      onBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo quitar.');
    }
  };

  const hasScript = edit.frases.length > 0 && !working;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <BackButton onBack={onBack} />
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold text-fg">{edit.titulo}</h2>
            <button type="button" onClick={rename} className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Cambiar nombre">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <StatusBadge estado={edit.estado} />
          </div>
          <p className="text-[12px] text-fg-subtle">
            {formatClock(edit.original.duracion)} en bruto · perfil {edit.perfil.nombre} · {edit.perfil.formato}
            {edit.costoUSD > 0 ? ` · gastado $${edit.costoUSD.toFixed(4)}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void editorApi.openFolder(id)} className="btn-secondary h-8 px-3 text-[12px]">
            <FolderOpen className="h-3.5 w-3.5" /> Carpeta
          </button>
          <button type="button" onClick={remove} disabled={working} className="btn-secondary h-8 px-3 text-[12px] text-rose-600 dark:text-rose-400">
            <Trash2 className="h-3.5 w-3.5" /> Quitar
          </button>
        </div>
      </div>

      <Stepper edit={edit} />

      {actionError && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {actionError}
        </p>
      )}

      {working && <ProgressCard edit={edit} />}
      {edit.estado === 'error' && edit.error && <ErrorCard edit={edit} busy={busy} run={run} />}

      {(edit.estado === 'borrador' || edit.estado === 'aprobado') && edit.borrador && (
        <DraftCard edit={edit} busy={busy} run={run} />
      )}

      {(edit.frases.length > 0 || edit.borrador) && (
        <ClaudeEditChat
          edit={edit}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}

      {hasScript && edit.estado !== 'error' && (
        <ScriptReview
          key={`${edit.id}-${edit.transcripcion?.creada}-${edit.borrador?.version ?? 0}-${edit.resumenIA ?? ''}-${edit.estado}-${(edit.graficos ?? []).map((g) => g.id).join(',')}`}
          edit={edit}
          perfiles={perfiles}
          busy={busy}
          run={run}
        />
      )}

      {edit.actividad.length > 0 && !working && <ActivityLog edit={edit} />}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> Mis ediciones
    </button>
  );
}

// ── Pasos ─────────────────────────────────────────────────────────────────────

const STEPS = ['Transcribir', 'Guion con IA', 'Revisar', 'Crear video', 'Aprobar'] as const;

function stepIndex(e: EditProject): number {
  switch (e.estado) {
    case 'en_cola':
      return e.tarea === 'renderizar' ? 3 : e.transcripcion ? 1 : 0;
    case 'transcribiendo':
      return 0;
    case 'analizando':
      return 1;
    case 'por_revisar':
      return 2;
    case 'renderizando':
      return 3;
    case 'borrador':
      return 4;
    case 'aprobado':
      return 5;
    case 'error':
      return e.error?.tarea === 'renderizar' ? 3 : e.transcripcion ? 1 : 0;
  }
}

function Stepper({ edit }: { edit: EditProject }) {
  const current = stepIndex(edit);
  return (
    <ol className="flex flex-wrap gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={s}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${
              now ? 'border-accent bg-surface font-medium text-fg' : done ? 'border-line text-fg-muted' : 'border-line text-fg-subtle'
            }`}
          >
            {done ? <Check className="h-3.5 w-3.5 text-accent" /> : <span className="tabular-nums">{i + 1}</span>}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

// ── En proceso ────────────────────────────────────────────────────────────────

function ProgressCard({ edit }: { edit: EditProject }) {
  const rendering = edit.tarea === 'renderizar' || edit.estado === 'renderizando';
  const items = rendering
    ? [
        { label: 'Cortar pausas y repeticiones', done: edit.estado === 'renderizando' && (edit.progreso ?? 0) > 5, active: edit.estado === 'renderizando' },
        { label: 'Subtítulos y gancho', done: (edit.progreso ?? 0) > 40, active: (edit.progreso ?? 0) > 5 },
        { label: 'Mezclar el sonido y exportar', done: false, active: (edit.progreso ?? 0) > 40 },
      ]
    : [
        { label: 'Transcribir el audio', done: !!edit.transcripcion, active: edit.estado === 'transcribiendo' },
        { label: 'Marcar errores y repeticiones', done: false, active: edit.estado === 'analizando' },
        { label: 'Proponer gancho y palabras clave', done: false, active: edit.estado === 'analizando' },
      ];
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        {edit.estado === 'en_cola' ? 'En cola…' : rendering ? 'Creando tu video…' : 'Preparando el guion…'}
      </div>
      {rendering && edit.progresoTexto && <p className="text-[12px] text-fg-muted">{edit.progresoTexto}</p>}
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] text-fg">
            {it.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
            ) : it.active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-fg-subtle" />
            )}
            {it.label}
          </li>
        ))}
      </ul>
      {rendering && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${edit.progreso ?? 2}%` }} />
          </div>
          <p className="tabular-nums text-[11px] text-fg-subtle">{edit.progreso ?? 0}% · depende de la potencia de tu PC</p>
        </div>
      )}
      <ActivityLog edit={edit} compact />
    </section>
  );
}

function ActivityLog({ edit, compact }: { edit: EditProject; compact?: boolean }) {
  const rows = [...edit.actividad].reverse().slice(0, compact ? 4 : 8);
  return (
    <details open={compact} className="rounded-xl border border-line bg-surface px-4 py-3 text-[12px]">
      <summary className="cursor-pointer text-fg-muted">Actividad</summary>
      <ul className="mt-2 space-y-1">
        {rows.map((a, i) => (
          <li key={`${a.t}-${i}`} className="flex gap-3 text-fg-muted">
            <span className="shrink-0 tabular-nums text-fg-subtle">{new Date(a.t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{a.msg}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────

type RunFn = (label: string, body: Record<string, unknown>) => Promise<void>;

function ErrorCard({ edit, busy, run }: { edit: EditProject; busy: string | null; run: RunFn }) {
  const e = edit.error!;
  const analyzing = e.tarea === 'analizar';
  return (
    <section className="space-y-3 rounded-xl border border-rose-500/30 bg-surface p-5">
      <p className="flex items-start gap-2 text-[13px] text-rose-600 dark:text-rose-400">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {e.mensaje}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => void run('reintentar', { accion: 'reintentar' })} className="btn-primary h-9 px-4 text-[13px]">
          {busy === 'reintentar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reintentar
        </button>
        {analyzing && e.codigo === 'free_exhausted' && (
          <button type="button" disabled={!!busy} onClick={() => void run('claude', { accion: 'reintentar', modoIA: 'claude-cheap' })} className="btn-secondary h-9 px-4 text-[13px]">
            <Sparkles className="h-4 w-4" /> Usar Claude Haiku (de pago, centavos)
          </button>
        )}
        {analyzing && edit.transcripcion && (
          <button type="button" disabled={!!busy} onClick={() => void run('sinia', { accion: 'reintentar', sinIA: true })} className="btn-secondary h-9 px-4 text-[13px]">
            Seguir sin IA (solo quitar pausas)
          </button>
        )}
        {!analyzing && edit.frases.length > 0 && (
          <button type="button" disabled={!!busy} onClick={() => void run('revisar', { accion: 'volver_a_revisar' })} className="btn-secondary h-9 px-4 text-[13px]">
            Volver a revisar el guion
          </button>
        )}
      </div>
    </section>
  );
}

// ── Borrador ──────────────────────────────────────────────────────────────────

function DraftCard({ edit, busy, run }: { edit: EditProject; busy: string | null; run: RunFn }) {
  const b = edit.borrador!;
  const approved = edit.estado === 'aprobado';
  return (
    <section className="grid gap-5 rounded-xl border border-line bg-surface p-5 md:grid-cols-[auto_minmax(0,1fr)]">
      <video
        key={b.version}
        src={mediaUrl(edit.id, 'borrador', b.version)}
        controls
        playsInline
        className="mx-auto max-h-[560px] w-full max-w-[320px] rounded-xl bg-black"
      />
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{approved ? 'Reel aprobado' : 'Tu reel está listo'}</h3>
          <p className="text-[12px] text-fg-muted">
            Versión {b.version} · {formatClock(b.duracion)} (antes {formatClock(edit.original.duracion)}) · look {edit.perfil.nombre}
          </p>
        </div>
        {approved ? (
          <p className="flex items-center gap-2 text-[13px] text-fg">
            <CheckCircle2 className="h-4 w-4 text-accent" /> Guardado en Proyectos → Edición de video.
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">
            Míralo. Si te gusta, apruébalo y queda en Proyectos. Si no, cambia lo que quieras en el guion de abajo y vuelve a crearlo.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!approved && (
            <button type="button" disabled={!!busy} onClick={() => void run('aprobar', { accion: 'aprobar' })} className="btn-primary h-10 px-5 text-[13px]">
              {busy === 'aprobar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aprobar
            </button>
          )}
          <a href={downloadUrl(edit.id)} className="btn-secondary h-10 px-4 text-[13px]">
            <Download className="h-4 w-4" /> Descargar MP4
          </a>
          {b.portada && (
            <a href={downloadUrl(edit.id, 'portada')} className="btn-secondary h-10 px-4 text-[13px]">
              <ImageDown className="h-4 w-4" /> Portada
            </a>
          )}
        </div>

        {b.calidad && b.calidad.length > 0 && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-[12px] font-medium text-fg">Control de calidad</p>
            <ul className="space-y-1.5">
              {b.calidad.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-fg-muted">
                  {c.ok === true ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : c.ok === false ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  ) : (
                    <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  )}
                  <span>{c.texto}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {b.notas && b.notas.length > 0 && <p className="text-[11px] text-fg-subtle">Sonido: {b.notas.join(' ')}</p>}
        {b.portada && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(edit.id, 'portada', b.version)} alt="Portada del reel" className="h-32 w-auto rounded-lg border border-line" />
        )}
      </div>
    </section>
  );
}

// ── Revisión del guion ────────────────────────────────────────────────────────

/** Notas de editor que mejor funcionan (adaptadas a lo que decide la IA en esta sección). */
const AI_NOTES = [
  { label: 'Más corto', text: 'Que dure menos de 30 segundos: deja solo las mejores frases.' },
  { label: 'Gancho más fuerte', text: 'Que el gancho pegue más: corto, directo y con la promesa principal.' },
  { label: 'Una idea cada vez', text: 'Quita lo que se va del tema principal: una idea cada vez.' },
  { label: 'Sin muletillas', text: 'Corta todas las muletillas y frases de relleno.' },
  { label: 'Empieza fuerte', text: 'Que empiece directamente por la frase más fuerte, sin saludo.' },
  { label: 'Palabras clave', text: 'Elige una palabra clave por frase para resaltar: números, resultados y nombres.' },
];

interface Draft {
  cortar: boolean;
  texto: string;
}

function ScriptReview({ edit, perfiles, busy, run }: { edit: EditProject; perfiles: EditProfile[]; busy: string | null; run: RunFn }) {
  const [rows, setRows] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(edit.frases.map((f) => [f.id, { cortar: f.cortar, texto: phraseText(f) }]))
  );
  const [gancho, setGancho] = useState(edit.gancho);
  const [resaltar, setResaltar] = useState(edit.resaltar.join(', '));
  const [perfilId, setPerfilId] = useState(edit.perfilId);
  const [graficos, setGraficos] = useState<EditGraphic[]>(() => (edit.graficos ?? []).map((g) => ({ ...g, items: [...g.items] })));
  const [indicacion, setIndicacion] = useState('');
  const [modoIA, setModoIA] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);

  const perfil = perfiles.find((p) => p.id === perfilId) ?? edit.perfil;
  const current: EditPhrase[] = useMemo(
    () => edit.frases.map((f) => ({ ...f, cortar: rows[f.id]?.cortar ?? f.cortar })),
    [edit.frases, rows]
  );
  const estimate = useMemo(
    () => totalDuration(keptIntervals(current, perfil.ritmo, edit.original.duracion)),
    [current, perfil.ritmo, edit.original.duracion]
  );
  const cuts = current.filter((f) => f.cortar).length;

  const payload = () => ({
    frases: edit.frases.map((f) => ({ id: f.id, cortar: rows[f.id].cortar, textoEditado: rows[f.id].texto })),
    gancho,
    resaltar: resaltar
      .split(/[,\n]/)
      .map((w) => w.trim())
      .filter(Boolean),
    perfilId,
    ...(edit.graficos ? { graficos: graficos.map((g) => ({ id: g.id, tipo: g.tipo, titulo: g.titulo, texto: g.texto, items: g.items, activo: g.activo })) } : {}),
  });

  const playPhrase = (f: EditPhrase) => {
    const v = video.current;
    if (!v) return;
    stopAt.current = f.e + 0.05;
    v.currentTime = Math.max(0, f.s - 0.05);
    void v.play();
  };

  const toggle = (id: string) => setRows((r) => ({ ...r, [id]: { ...r[id], cortar: !r[id].cortar } }));
  const allKept = cuts === 0;
  const isDraft = edit.estado === 'borrador' || edit.estado === 'aprobado';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{isDraft ? 'Cambiar algo' : 'Revisa el guion'}</h3>
          <p className="max-w-[70ch] text-[12px] text-fg-muted">
            Las frases en rojo se cortan. Toca una para conservarla o cortarla, corrige el texto de los subtítulos escribiendo encima y escucha
            cualquier frase con ▶.
          </p>
          {edit.resumenIA && <p className="mt-1 text-[12px] text-fg"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-accent" />{edit.resumenIA}</p>}
        </div>
        <p className="text-[12px] text-fg-muted">
          {cuts} frase{cuts === 1 ? '' : 's'} cortada{cuts === 1 ? '' : 's'} · queda <b className="tabular-nums text-fg">{formatClock(estimate)}</b> de{' '}
          {formatClock(edit.original.duracion)}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Columna izquierda: original + gancho + perfil */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-fg-muted">Video original</p>
            <video
              ref={video}
              src={mediaUrl(edit.id, 'original')}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => {
                if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                  e.currentTarget.pause();
                  stopAt.current = null;
                }
              }}
              className="max-h-[360px] w-full rounded-xl bg-black"
            />
          </div>

          <label className="block space-y-1 text-[12px] text-fg-muted">
            <span className="block">Texto gancho {perfil.gancho.activo ? '' : '(apagado en este perfil)'}</span>
            <input value={gancho} onChange={(e) => setGancho(e.target.value)} maxLength={120} className="input-clean h-9 w-full px-3 text-[13px]" />
          </label>
          <label className="block space-y-1 text-[12px] text-fg-muted">
            <span className="block">Palabras a resaltar (separadas por comas)</span>
            <input value={resaltar} onChange={(e) => setResaltar(e.target.value)} className="input-clean h-9 w-full px-3 text-[13px]" />
          </label>

          <div className="space-y-1.5">
            <p className="text-[12px] text-fg-muted">Perfil</p>
            <div className="flex flex-wrap gap-1.5">
              {perfiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPerfilId(p.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] cursor-pointer ${
                    perfilId === p.id ? 'border-accent bg-surface-2 font-medium text-fg' : 'border-line text-fg-muted hover:text-fg'
                  }`}
                >
                  <LookDots look={p} /> {p.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
              <Wand2 className="h-3.5 w-3.5 text-accent" /> Pedirle un cambio a la IA
            </p>
            <div className="flex flex-wrap gap-1">
              {AI_NOTES.map((n) => (
                <button
                  key={n.label}
                  type="button"
                  onClick={() => setIndicacion((t) => (t.trim() ? `${t.trim()} ${n.text}` : n.text))}
                  className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted hover:border-fg-subtle hover:text-fg cursor-pointer"
                  title={n.text}
                >
                  {n.label}
                </button>
              ))}
            </div>
            <textarea
              value={indicacion}
              onChange={(e) => setIndicacion(e.target.value)}
              rows={2}
              placeholder="Ej.: que dure menos de 30 segundos y empiece por la parte del precio"
              className="input-clean w-full resize-y px-3 py-2 text-[12px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select value={modoIA} onChange={(e) => setModoIA(e.target.value)} className="input-clean h-8 px-2 text-[12px]" aria-label="Qué IA usar">
                <option value="">IA del selector</option>
                {ORCHESTRATOR_OPTIONS.map((o) => (
                  <option key={o.mode} value={o.mode}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!!busy || !indicacion.trim()}
                onClick={() => void run('reanalizar', { accion: 'reanalizar', indicacion: indicacion.trim(), ...(modoIA ? { modoIA } : {}) })}
                className="btn-secondary h-8 px-3 text-[12px]"
              >
                {busy === 'reanalizar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Rehacer guion
              </button>
            </div>
            <p className="text-[11px] text-fg-subtle">No vuelve a transcribir: solo cuesta la llamada a la IA.</p>
          </div>
        </div>

        {/* Frases */}
        <div className="min-w-0 space-y-4">
        <GraphicsReview
          graficos={graficos}
          setGraficos={setGraficos}
          frases={edit.frases}
          rows={rows}
          busy={busy}
          onPropose={() => void run('graficos', { accion: 'proponer_graficos' })}
        />
        <ol className="max-h-[720px] space-y-1.5 overflow-y-auto pr-1 desktop-scroll">
          {edit.frases.map((f) => {
            const r = rows[f.id];
            const cut = r.cortar;
            return (
              <li
                key={f.id}
                className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                  cut ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-line bg-surface'
                }`}
              >
                <button
                  type="button"
                  onClick={() => playPhrase(f)}
                  className="mt-0.5 rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                  aria-label={`Escuchar la frase de ${formatClock(f.s)}`}
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <span className="mt-1 w-10 shrink-0 tabular-nums text-[11px] text-fg-subtle">{formatClock(f.s)}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <textarea
                    value={r.texto}
                    onChange={(e) => setRows((x) => ({ ...x, [f.id]: { ...x[f.id], texto: e.target.value } }))}
                    rows={Math.max(1, Math.ceil(r.texto.length / 70))}
                    disabled={cut}
                    className={`w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[13px] leading-snug outline-none focus:bg-surface-2 ${
                      cut ? 'text-rose-700 line-through decoration-rose-500/70 dark:text-rose-300' : 'text-fg'
                    }`}
                  />
                  {cut && f.motivo && <span className="ml-1.5 rounded border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300">{f.motivo}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(f.id)}
                  className={`shrink-0 rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
                    cut ? 'border-rose-500/40 text-rose-700 dark:text-rose-300' : 'border-line text-fg-muted hover:text-fg'
                  }`}
                >
                  {cut ? 'Conservar' : 'Cortar'}
                </button>
              </li>
            );
          })}
        </ol>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-fg-muted">
          {allKept ? 'Sin frases cortadas: solo se quitarán las pausas largas.' : `Se cortan ${cuts} frase${cuts === 1 ? '' : 's'}.`} Duración final aprox.{' '}
          <b className="tabular-nums text-fg">{formatClock(estimate)}</b>
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={!!busy} onClick={() => void run('guardar', { accion: 'guardar_revision', ...payload() })} className="btn-secondary h-10 px-4 text-[13px]">
            {busy === 'guardar' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
          <button
            type="button"
            disabled={!!busy || current.every((f) => f.cortar)}
            onClick={() => void run('renderizar', { accion: 'renderizar', ...payload() })}
            className="btn-primary h-10 px-5 text-[13px]"
          >
            {busy === 'renderizar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{' '}
            {isDraft ? 'Crear video de nuevo' : 'Crear video'}
          </button>
        </div>
      </div>
    </section>
  );
}


// ── Revisión de gráficos ─────────────────────────────────────────────────────

const GRAPHIC_LABEL: Record<GraphicType, string> = { tarjeta: 'Tarjeta', numero: 'Cifra', lista: 'Lista', detras: 'Palabra detrás' };

function GraphicsReview({
  graficos,
  setGraficos,
  frases,
  rows,
  busy,
  onPropose,
}: {
  graficos: EditGraphic[];
  setGraficos: React.Dispatch<React.SetStateAction<EditGraphic[]>>;
  frases: EditPhrase[];
  rows: Record<string, { cortar: boolean }>;
  busy: string | null;
  onPropose: () => void;
}) {
  const patch = (id: string, change: Partial<EditGraphic>) => setGraficos((list) => list.map((g) => (g.id === id ? { ...g, ...change } : g)));
  const active = graficos.filter((g) => g.activo && !rows[g.fraseId]?.cortar).length;
  return (
    <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-fg">
          Gráficos <span className="font-normal text-fg-subtle">({active} activos · cada uno entra en su palabra)</span>
        </p>
        <button type="button" disabled={!!busy} onClick={onPropose} className="btn-secondary h-7 px-2.5 text-[11px]">
          {busy === 'graficos' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {graficos.length ? 'Proponer otros' : 'Proponer gráficos con IA'}
        </button>
      </div>
      {graficos.length === 0 && <p className="text-[11px] text-fg-subtle">Sin gráficos. Pídeselos a la IA o deja solo subtítulos.</p>}
      <ul className="space-y-1.5">
        {graficos.map((g) => {
          const cut = rows[g.fraseId]?.cortar;
          const frase = frases.find((f) => f.id === g.fraseId);
          return (
            <li key={g.id} className={`space-y-1.5 rounded-lg border p-2 ${g.activo && !cut ? 'border-line' : 'border-line opacity-55'}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                <span className="tabular-nums">{formatClock(g.t)}</span>
                <select
                  value={g.tipo}
                  onChange={(e) => patch(g.id, { tipo: e.target.value as GraphicType })}
                  className="input-clean h-7 px-1.5 text-[11px]"
                  aria-label="Tipo de gráfico"
                >
                  {(Object.keys(GRAPHIC_LABEL) as GraphicType[]).map((t) => (
                    <option key={t} value={t}>
                      {GRAPHIC_LABEL[t]}
                    </option>
                  ))}
                </select>
                <span className="truncate" title={frase ? phraseText(frase) : undefined}>en «{g.palabra}»</span>
                {cut && <span className="text-rose-600 dark:text-rose-400">su frase se corta</span>}
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={g.activo} onChange={(e) => patch(g.id, { activo: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                  Encendido
                </label>
                <button type="button" onClick={() => setGraficos((l) => l.filter((x) => x.id !== g.id))} className="rounded p-0.5 hover:text-rose-600" aria-label="Quitar gráfico">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={g.titulo}
                onChange={(e) => patch(g.id, { titulo: e.target.value })}
                maxLength={60}
                placeholder={g.tipo === 'numero' ? 'La cifra (ej.: 97 %)' : 'Título'}
                className="input-clean h-8 w-full px-2 text-[12px] font-medium"
              />
              {g.tipo !== 'detras' && g.tipo !== 'lista' && (
                <input
                  value={g.texto}
                  onChange={(e) => patch(g.id, { texto: e.target.value })}
                  maxLength={120}
                  placeholder="Texto corto (opcional)"
                  className="input-clean h-8 w-full px-2 text-[12px]"
                />
              )}
              {g.tipo === 'lista' && (
                <div className="space-y-1">
                  {[0, 1, 2].map((i) => (
                    <input
                      key={i}
                      value={g.items[i] ?? ''}
                      onChange={(e) => {
                        const items = [...g.items];
                        items[i] = e.target.value;
                        patch(g.id, { items: items.slice(0, 3) });
                      }}
                      maxLength={60}
                      placeholder={`Elemento ${i + 1}`}
                      className="input-clean h-7 w-full px-2 text-[12px]"
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
