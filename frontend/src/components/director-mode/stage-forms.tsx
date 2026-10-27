'use client';

import React, { useEffect, useState } from 'react';
import { FileText, FileUp, Lightbulb, Loader2, Pencil, RotateCcw } from 'lucide-react';
import { VOICE_MODES, getBrollModel, type VoiceMode } from '@/config/broll-models';
import { brollModelsFor, durationRules } from '@/lib/director-mode/durations';
import { REALISM_SUMMARY_ES } from '@/lib/director-mode/prompts';
import { ACTIVE_ORDER, STAGES, promptIsStale } from '@/lib/director-mode/stages';
import type { Aspect, ActiveStageId, DirectorSettings, DirectorState, InputKind } from '@/lib/director-mode/types';
import type { Production } from '@/lib/director/production-store';
import { ScriptSceneCard, TYPE_LABEL } from './ScriptSceneCard';
import type { useDirectorMode } from './useDirectorMode';

/**
 * Formularios de cada etapa del modo Director. Los usan la Vista lista (tarjetas)
 * y el chat del lienzo, así la lógica vive en un solo sitio.
 */

export type Act = ReturnType<typeof useDirectorMode>['act'];

export const INPUT_TABS: Array<{ id: InputKind; label: string; icon: React.ReactNode }> = [
  { id: 'guion', label: 'Tengo guion', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'idea', label: 'Solo una idea', icon: <Lightbulb className="h-3.5 w-3.5" /> },
  { id: 'pdf', label: 'Un PDF', icon: <FileUp className="h-3.5 w-3.5" /> },
];

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function costLabel(d: DirectorState | undefined) {
  return d?.confidencial ? 'Claude Haiku, < 1 ¢' : 'Gemini, $0';
}

// ---------------------------------------------------------------------------

export function StageSummary({ id, p }: { id: ActiveStageId; p: Production }) {
  const d = p.director!;
  if (id === 'ajustes' && d.etapas.ajustes.estado === 'aprobada') {
    const voice = VOICE_MODES.find((v) => v.id === d.ajustes.modoVoz)?.label;
    return (
      <>
        {d.ajustes.formato} · {d.ajustes.duracionSeg} s · {voice} · {getBrollModel(d.ajustes.modeloBroll).name} ·{' '}
        {d.ajustes.avatarNombre ? `avatar «${d.ajustes.avatarNombre}»` : 'sin avatar'} · presupuesto ${d.ajustes.presupuestoUSD}
      </>
    );
  }
  if (id === 'guion' && d.guion) {
    const total = d.guion.escenas.reduce((t, s) => t + s.duracionSeg, 0);
    return (
      <>
        «{d.guion.titulo}» · {d.guion.escenas.length} escenas · total {total} s (objetivo {d.ajustes.duracionSeg} s)
      </>
    );
  }
  return null;
}

export function StageBody({ id, p, busy, act }: { id: ActiveStageId; p: Production; busy: string | null; act: Act }) {
  const d = p.director!;
  const st = d.etapas[id];
  if (st.estado === 'bloqueada') {
    const prev = ACTIVE_ORDER[ACTIVE_ORDER.indexOf(id) - 1];
    return <p className="text-[11.5px] text-fg-subtle">Se desbloquea al aprobar «{STAGES.find((s) => s.id === prev)?.nombre}».</p>;
  }
  // La key con la revisión reinicia los formularios cuando la etapa cambia en el servidor
  const key = `${p.id}-${id}-${st.rev}`;
  switch (id) {
    case 'idea':
      return <IdeaStage key={key} d={d} busy={busy} act={act} />;
    case 'preguntas':
      return <QuestionsStage key={key} d={d} busy={busy} act={act} />;
    case 'ajustes':
      return <SettingsStage key={key} d={d} busy={busy} act={act} />;
    case 'guion':
      return <ScriptStage key={key} d={d} busy={busy} act={act} />;
    case 'prompts':
      return <PromptsStage key={key} d={d} busy={busy} act={act} />;
  }
}

export function StaleNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:text-amber-200">
      Algo anterior cambió. Puedes rehacer esta etapa o aprobarla tal como está.
    </p>
  );
}

// ----- 1. Idea -----

export interface IdeaValues {
  tipo: InputKind;
  texto: string;
  mantenerPalabras: boolean;
  confidencial: boolean;
  pdfBase64?: string;
  pdfNombre?: string;
}

export function IdeaForm({
  initial,
  existingPdf,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<IdeaValues>;
  existingPdf?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (v: IdeaValues) => void;
  onCancel?: () => void;
}) {
  const [tipo, setTipo] = useState<InputKind>(initial?.tipo ?? 'guion');
  const [texto, setTexto] = useState(initial?.texto ?? '');
  const [keep, setKeep] = useState(initial?.mantenerPalabras ?? true);
  const [confidencial, setConfidencial] = useState(initial?.confidencial ?? false);
  const [pdf, setPdf] = useState<{ name: string; dataUrl: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const loadPdf = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return setLocalError('El archivo debe ser un PDF.');
    if (file.size > 20 * 1024 * 1024) return setLocalError('El PDF debe pesar menos de 20 MB.');
    setLocalError(null);
    setPdf({ name: file.name, dataUrl: await readFileAsDataUrl(file) });
  };

  const submit = () => {
    if (tipo === 'pdf' && !pdf && !existingPdf) return setLocalError('Sube el PDF.');
    if (tipo !== 'pdf' && !texto.trim()) return setLocalError(tipo === 'guion' ? 'Pega tu guion.' : 'Escribe la idea del video.');
    setLocalError(null);
    onSubmit({
      tipo,
      texto,
      mantenerPalabras: tipo === 'guion' && keep,
      confidencial,
      ...(tipo === 'pdf' && pdf ? { pdfBase64: pdf.dataUrl, pdfNombre: pdf.name } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        {INPUT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTipo(t.id)}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] transition-colors cursor-pointer ${
              tipo === t.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tipo === 'pdf' && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line p-3 text-[12px] text-fg-muted hover:bg-surface-2">
          <FileUp className="h-4 w-4" />
          <span className="flex-1">{pdf?.name ?? existingPdf ?? 'Elegir PDF (máx. 20 MB)'}</span>
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => loadPdf(e.target.files?.[0])} />
        </label>
      )}

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={tipo === 'guion' ? 7 : 4}
        placeholder={
          tipo === 'guion'
            ? 'Pega tu guion…'
            : tipo === 'idea'
            ? 'Ej.: anuncio de 30 s para un sérum de vitamina C, para mujeres de 25 a 40, tono cercano.'
            : 'Indicaciones opcionales sobre el PDF (qué producto, a quién va dirigido…)'
        }
        className="input-clean w-full resize-y p-3 text-[13px] leading-relaxed"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-muted">
        {tipo === 'guion' && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Mantener mis palabras
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-1.5" title="Gemini gratis puede usar los datos para mejorar productos de Google">
          <input type="checkbox" checked={confidencial} onChange={(e) => setConfidencial(e.target.checked)} />
          Confidencial
        </label>
        {confidencial && <span className="text-[11px] text-fg-subtle">Se usará Claude Haiku (de pago, menos de 1 ¢ por paso), no Gemini gratis.</span>}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-secondary h-8 px-3 text-[12px]">
              Cancelar
            </button>
          )}
          <button type="button" onClick={submit} disabled={busy} className="btn-primary h-8 px-4 text-[12px]">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {submitLabel}
          </button>
        </div>
      </div>
      {localError && <p className="text-[11.5px] text-red-600 dark:text-red-400">{localError}</p>}
    </div>
  );
}

export function IdeaStage({ d, busy, act }: { d: DirectorState; busy: string | null; act: Act }) {
  const [editing, setEditing] = useState(false);
  const e = d.entrada;
  if (editing) {
    return (
      <IdeaForm
        initial={{ ...e, confidencial: d.confidencial }}
        existingPdf={e.pdfNombre}
        busy={busy === 'guardar_idea'}
        submitLabel="Guardar idea"
        onCancel={() => setEditing(false)}
        onSubmit={async ({ confidencial, ...rest }) => {
          if (await act({ accion: 'guardar_idea', entrada: { ...rest, confidencial } })) setEditing(false);
        }}
      />
    );
  }
  const kind = INPUT_TABS.find((t) => t.id === e.tipo)?.label;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-fg-subtle">
        {kind}
        {e.tipo === 'guion' && (e.mantenerPalabras ? ' · mantener mis palabras' : ' · la IA puede reescribirlo')}
        {e.pdfNombre ? ` · ${e.pdfNombre}` : ''}
      </p>
      {e.texto && <p className="line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-muted">{e.texto}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing(true)} disabled={!!busy} className="btn-secondary h-7 px-2.5 text-[11.5px]">
          <Pencil className="h-3 w-3" /> Editar
        </button>
      </div>
    </div>
  );
}

// ----- 2. Preguntas -----

export function QuestionsStage({ d, busy, act }: { d: DirectorState; busy: string | null; act: Act }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(d.preguntas.map((q) => [q.id, q.respuesta ?? ''])));
  const [other, setOther] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(d.preguntas.map((q) => [q.id, Boolean(q.respuesta && !q.opciones.includes(q.respuesta))]))
  );

  const st = d.etapas.preguntas;
  const generating = busy === 'generar_preguntas';
  const cost = costLabel(d);

  if (!d.preguntas.length) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-fg-muted">La IA te hace dos preguntas para orientar el guion (tono, enfoque…).</p>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => act({ accion: 'saltar_preguntas' })} disabled={!!busy} className="btn-secondary h-8 px-3 text-[12px]">
            Saltar
          </button>
          <button type="button" onClick={() => act({ accion: 'generar_preguntas' })} disabled={!!busy} className="btn-primary h-8 px-3 text-[12px]">
            {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Pedir preguntas · {cost}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StaleNote show={st.estado === 'desactualizada'} />
      {d.preguntas.map((q) => (
        <fieldset key={q.id} className="space-y-1.5">
          <legend className="text-[12.5px] font-medium text-fg">{q.pregunta}</legend>
          <div className="flex flex-wrap gap-1.5">
            {q.opciones.map((o) => {
              const on = !other[q.id] && answers[q.id] === o;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    setOther((c) => ({ ...c, [q.id]: false }));
                    setAnswers((c) => ({ ...c, [q.id]: o }));
                  }}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors cursor-pointer ${
                    on ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg-muted hover:bg-surface-2'
                  }`}
                >
                  {o}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setOther((c) => ({ ...c, [q.id]: true }));
                setAnswers((c) => ({ ...c, [q.id]: q.opciones.includes(c[q.id]) ? '' : c[q.id] }));
              }}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors cursor-pointer ${
                other[q.id] ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg-muted hover:bg-surface-2'
              }`}
            >
              Otra…
            </button>
          </div>
          {other[q.id] && (
            <input
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((c) => ({ ...c, [q.id]: e.target.value }))}
              placeholder="Escribe tu respuesta"
              className="input-clean h-8 w-full px-2 text-[12px]"
            />
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => act({ accion: 'generar_preguntas' })} disabled={!!busy} className="btn-secondary h-8 px-3 text-[12px]">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Otras preguntas · {cost}
        </button>
        <button type="button" onClick={() => act({ accion: 'saltar_preguntas' })} disabled={!!busy} className="btn-secondary h-8 px-3 text-[12px]">
          Saltar
        </button>
        <button
          type="button"
          onClick={() => act({ accion: 'responder_preguntas', respuestas: answers })}
          disabled={!!busy}
          className="btn-primary h-8 px-3 text-[12px]"
        >
          {busy === 'responder_preguntas' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {st.estado === 'aprobada' ? 'Guardar respuestas' : 'Confirmar y seguir →'}
        </button>
      </div>
    </div>
  );
}

// ----- 3. Ajustes -----

interface AvatarOption {
  id: string;
  name: string;
}

export function SettingsStage({ d, busy, act }: { d: DirectorState; busy: string | null; act: Act }) {
  const [s, setS] = useState<DirectorSettings>(d.ajustes);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [editing, setEditing] = useState(d.etapas.ajustes.estado !== 'aprobada');
  useEffect(() => {
    fetch('/api/avatars')
      .then((r) => r.json())
      .then((j) => setAvatars((j.avatars ?? []).map((a: AvatarOption) => ({ id: a.id, name: a.name }))))
      .catch(() => setAvatars([]));
  }, []);

  const models = brollModelsFor(s.modoVoz, s.formato);
  const set = (patch: Partial<DirectorSettings>) =>
    setS((cur) => {
      const next = { ...cur, ...patch };
      const valid = brollModelsFor(next.modoVoz, next.formato);
      if (!valid.some((m) => m.id === next.modeloBroll) && valid[0]) next.modeloBroll = valid[0].id;
      return next;
    });

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing(true)} disabled={!!busy} className="btn-secondary h-7 px-2.5 text-[11.5px]">
          <Pencil className="h-3 w-3" /> Editar
        </button>
      </div>
    );
  }

  const save = async () => {
    const { avatarNombre: _omit, ...ajustes } = s;
    void _omit;
    if (await act({ accion: 'guardar_ajustes', ajustes })) setEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-1.5 sm:grid-cols-3">
        {VOICE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => set({ modoVoz: m.id as VoiceMode })}
            className={`rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
              s.modoVoz === m.id ? 'border-accent bg-accent/5' : 'border-line hover:bg-surface-2'
            }`}
          >
            <span className="block text-[12.5px] font-medium text-fg">{m.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{m.description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-[11px] text-fg-subtle">
        <label className="space-y-1">
          <span className="block">Formato</span>
          <select value={s.formato} onChange={(e) => set({ formato: e.target.value as Aspect })} className="input-clean h-8 px-2 text-[12px]">
            <option value="9:16">9:16 vertical</option>
            <option value="16:9">16:9 horizontal</option>
            <option value="1:1">1:1 cuadrado</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block">Duración</span>
          <select value={s.duracionSeg} onChange={(e) => set({ duracionSeg: Number(e.target.value) })} className="input-clean h-8 px-2 text-[12px]">
            {[15, 20, 30, 45, 60, 90].map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block">Modelo de tomas de apoyo</span>
          <select value={s.modeloBroll} onChange={(e) => set({ modeloBroll: e.target.value })} className="input-clean h-8 px-2 text-[12px]">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · ${(s.modoVoz === 'native' ? m.pricePerSecondAudio ?? m.pricePerSecond : m.pricePerSecond).toFixed(3)}/s
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block">Avatar (opcional)</span>
          <select value={s.avatarId ?? ''} onChange={(e) => set({ avatarId: e.target.value || null })} className="input-clean h-8 px-2 text-[12px]">
            <option value="">Sin avatar (se elige en Elenco)</option>
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block">Presupuesto (USD)</span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.5}
            value={s.presupuestoUSD}
            onChange={(e) => set({ presupuestoUSD: Number(e.target.value) || 0 })}
            className="input-clean h-8 w-20 px-2 text-[12px]"
          />
        </label>
      </div>
      <p className="text-[11px] text-fg-subtle">Duraciones por escena: {durationRules(s)}. Las escenas se ajustan solas a estas duraciones.</p>
      {!models.length && <p className="text-[11.5px] text-red-600 dark:text-red-400">Ningún modelo admite esta combinación de formato y voz.</p>}
      <div className="flex justify-end gap-2">
        {d.etapas.ajustes.estado === 'aprobada' && (
          <button
            type="button"
            onClick={() => {
              setS(d.ajustes);
              setEditing(false);
            }}
            className="btn-secondary h-8 px-3 text-[12px]"
          >
            Cancelar
          </button>
        )}
        <button type="button" onClick={save} disabled={!!busy || !models.length} className="btn-primary h-8 px-3 text-[12px]">
          {busy === 'guardar_ajustes' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar ajustes y seguir →
        </button>
      </div>
    </div>
  );
}

// ----- 5. Guion -----

export function ScriptStage({ d, busy, act }: { d: DirectorState; busy: string | null; act: Act }) {
  const st = d.etapas.guion;
  const cost = costLabel(d);
  const generating = busy === 'generar_guion';
  const hasPrompts = Boolean(d.guion?.escenas.some((s) => s.prompt));

  if (!d.guion?.escenas.length) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-fg-muted">
          {d.locucion?.usarComoVoz && d.locucion.transcripcion
            ? 'La IA reparte las escenas sobre tu locución: el audio manda los tiempos y el diálogo.'
            : d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras
            ? 'La IA divide tu guion en escenas sin cambiar tus palabras.'
            : 'La IA escribe el guion por escenas con tus respuestas y ajustes.'}
        </p>
        <button type="button" onClick={() => act({ accion: 'generar_guion' })} disabled={!!busy} className="btn-primary ml-auto h-8 px-3 text-[12px]">
          {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Escribir guion · {cost}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <StaleNote show={st.estado === 'desactualizada'} />
      {d.guion.escenas.map((s) => (
        <ScriptSceneCard
          // La versión en la key reinicia el formulario cuando la escena cambia
          key={`${s.id}-${d.guion!.generacion}-${s.version}-${s.duracionSeg}`}
          scene={s}
          ajustes={d.ajustes}
          ctx={d}
          showPromptState={hasPrompts}
          disabled={!!busy}
          redoing={busy === `rehacer_escena:${s.id}`}
          saving={busy === `editar_escena:${s.id}`}
          costLabel={cost}
          onRedo={(indicacion) => act({ accion: 'rehacer_escena', escenaId: s.id, indicacion }, `rehacer_escena:${s.id}`)}
          onSave={(cambios) => act({ accion: 'editar_escena', escenaId: s.id, cambios }, `editar_escena:${s.id}`)}
        />
      ))}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            if (!hasPrompts || window.confirm('Rehacer todo el guion deja desactualizados todos los prompts. ¿Seguir?')) void act({ accion: 'generar_guion' });
          }}
          disabled={!!busy}
          className="btn-secondary h-8 px-3 text-[12px]"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Rehacer todo el guion · {cost}
        </button>
        {st.estado !== 'aprobada' && (
          <button type="button" onClick={() => act({ accion: 'aprobar', etapa: 'guion' })} disabled={!!busy} className="btn-primary h-8 px-3 text-[12px]">
            {busy === 'aprobar' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Aprobar guion y seguir →
          </button>
        )}
      </div>
    </div>
  );
}

// ----- 8. Prompts -----

export function PromptsStage({ d, busy, act }: { d: DirectorState; busy: string | null; act: Act }) {
  const st = d.etapas.prompts;
  const cost = costLabel(d);
  const escenas = d.guion?.escenas ?? [];
  const stale = escenas.filter((s) => promptIsStale(s, d));
  const anyPrompt = escenas.some((s) => s.prompt);
  const generating = busy === 'generar_prompts';

  if (!anyPrompt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-fg-muted">Un prompt por escena para el modelo de video. Lo verás y podrás editarlo antes de gastar nada.</p>
        <button
          type="button"
          onClick={() => act({ accion: 'generar_prompts', soloFaltantes: false })}
          disabled={!!busy}
          className="btn-primary ml-auto h-8 px-3 text-[12px]"
        >
          {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Escribir prompts · {cost}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <StaleNote show={st.estado === 'desactualizada'} />
      <p className="text-[11px] text-fg-subtle">
        Van en inglés porque los modelos de video lo siguen mejor. En las tomas de apoyo se añade al usarlos: {REALISM_SUMMARY_ES}
      </p>
      {escenas.map((s) => (
        <PromptRow key={`${s.id}-${s.version}-${s.prompt?.texto.length ?? 0}`} d={d} sceneId={s.id} busy={busy} act={act} cost={cost} />
      ))}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {stale.length > 0 && (
          <button
            type="button"
            onClick={() => act({ accion: 'generar_prompts', soloFaltantes: true })}
            disabled={!!busy}
            className="btn-secondary h-8 px-3 text-[12px]"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Escribir los {stale.length} que faltan · {cost}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Rehacer todos los prompts reemplaza también los que editaste. ¿Seguir?')) void act({ accion: 'generar_prompts', soloFaltantes: false });
          }}
          disabled={!!busy}
          className="btn-secondary h-8 px-3 text-[12px]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Rehacer todos
        </button>
        {st.estado !== 'aprobada' && (
          <button
            type="button"
            onClick={() => act({ accion: 'aprobar', etapa: 'prompts' })}
            disabled={!!busy || stale.length > 0}
            title={stale.length ? 'Faltan prompts o hay alguno desactualizado' : undefined}
            className="btn-primary h-8 px-3 text-[12px]"
          >
            {busy === 'aprobar' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Aprobar prompts
          </button>
        )}
      </div>
      {st.estado === 'aprobada' && (
        <p className="text-[11.5px] text-fg-muted">
          Listo hasta aquí. Las imágenes iniciales, el presupuesto y los clips llegan en las Fases 3 y 4: nada se ha gastado en video.
        </p>
      )}
    </div>
  );
}

export function PromptRow({ d, sceneId, busy, act, cost }: { d: DirectorState; sceneId: string; busy: string | null; act: Act; cost: string }) {
  const s = d.guion!.escenas.find((x) => x.id === sceneId)!;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.prompt?.texto ?? '');
  const [askRedo, setAskRedo] = useState(false);
  const [indicacion, setIndicacion] = useState('');
  const stale = promptIsStale(s, d);
  const redoKey = `rehacer_prompt:${s.id}`;

  const redo = () => {
    setAskRedo(false);
    void act({ accion: 'rehacer_prompt', escenaId: s.id, indicacion }, redoKey);
  };

  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-fg-subtle">{s.orden}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-muted">{TYPE_LABEL[s.tipo]}</span>
        <span className="font-mono text-[10.5px] text-fg-subtle">{s.duracionSeg} s</span>
        {s.prompt?.modelo === 'manual' && <span className="text-[10.5px] text-fg-subtle">editado a mano</span>}
        {stale && (
          <span className="text-[10.5px] text-amber-700 dark:text-amber-300">{s.prompt ? 'desactualizado: la escena cambió' : 'sin prompt'}</span>
        )}
        {!editing && (
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => {
                setText(s.prompt?.texto ?? '');
                setEditing(true);
              }}
              disabled={!!busy}
              className="btn-secondary h-7 px-2 text-[11px]"
            >
              <Pencil className="h-3 w-3" /> Editar
            </button>
            <button type="button" onClick={() => setAskRedo((v) => !v)} disabled={!!busy} className="btn-secondary h-7 px-2 text-[11px]">
              {busy === redoKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Rehacer
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11.5px] text-fg-subtle">«{s.dialogo || s.queSeVe}»</p>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="input-clean w-full resize-y p-2 font-mono text-[12px]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary h-8 px-3 text-[12px]">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!!busy || !text.trim()}
              onClick={async () => {
                if (await act({ accion: 'editar_prompt', escenaId: s.id, texto: text }, `editar_prompt:${s.id}`)) setEditing(false);
              }}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              Guardar prompt
            </button>
          </div>
        </div>
      ) : (
        s.prompt && <p className={`mt-2 font-mono text-[11.5px] leading-relaxed ${stale ? 'text-fg-subtle line-through decoration-amber-500/50' : 'text-fg-muted'}`}>{s.prompt.texto}</p>
      )}
      {askRedo && !editing && (
        <div className="mt-2 flex gap-2">
          <input
            value={indicacion}
            onChange={(e) => setIndicacion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && redo()}
            placeholder="¿Qué cambiar? (opcional)"
            className="input-clean h-8 flex-1 px-2 text-[12px]"
          />
          <button type="button" onClick={redo} disabled={!!busy} className="btn-primary h-8 px-3 text-[12px]">
            Rehacer · {cost}
          </button>
        </div>
      )}
    </div>
  );
}
