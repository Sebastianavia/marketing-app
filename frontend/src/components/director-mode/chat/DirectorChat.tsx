'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Crosshair, Images, Loader2, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { getDirectorSkill } from '@/config/director-skills';
import { currentStage, promptIsStale } from '@/lib/director-mode/stages';
import type { DirectorState } from '@/lib/director-mode/types';
import type { Production } from '@/lib/director/production-store';
import { ScriptSceneCard } from '../ScriptSceneCard';
import { PromptRow, StageBody, costLabel } from '../stage-forms';
import type { useDirectorMode } from '../useDirectorMode';
import { MentionTextarea } from '../refs/MentionTextarea';
import { TagEditor, TagPanel } from '../refs/TagPanel';
import { newMessage, readChat, writeChat, type ChatMessage } from './chat-log';
import { busyKeyFor, composerPlaceholder, focusOf, greeting, narrate, narrateUpload, userEcho, type Focus } from './node-actions';
import { MentionText, refUrl } from '../refs/ref-common';
import { VoiceoverCard } from '../refs/VoiceoverCard';

/**
 * Chat del agente (izquierda del lienzo). Lo que escribes va a la acción del nodo enfocado
 * (rehacer escena / rehacer prompt, con tu texto como indicación) y las pausas (preguntas, ajustes, aprobar)
 * aparecen como tarjetas. + Ref sube archivos: con una escena enfocada quedan solo para ella;
 * con una etiqueta, van a esa etiqueta; si no, a todo el proyecto. El agente narra cada resultado.
 */

type DM = ReturnType<typeof useDirectorMode>;
type Body = Record<string, unknown> & { accion: string };

export interface UploadTarget {
  escenaId?: string;
  etiquetaId?: string;
}

interface Props {
  dm: DM;
  production: Production;
  focusId: string | null;
  onClearFocus: () => void;
  onFocus: (nodeId: string) => void;
  /** Archivos que llegaron de la caja de inicio o soltados en el lienzo. */
  pendingFiles?: File[] | null;
  /** Nombre del archivo de pendingFiles que es la locución del video (caja de inicio). */
  pendingVoiceover?: string | null;
  onPendingTaken?: () => void;
}

/** Destino de + Ref según el nodo enfocado. */
export function uploadTarget(f: Focus): UploadTarget {
  if ((f.kind === 'escena' || f.kind === 'prompt') && f.scene) return { escenaId: f.scene.id };
  if (f.kind === 'etiqueta' && f.tag) return { etiquetaId: f.tag.id };
  return {};
}

export function DirectorChat({ dm, production, focusId, onClearFocus, onFocus, pendingFiles, pendingVoiceover, onPendingTaken }: Props) {
  const d = production.director!;
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat(production.id));
  const [text, setText] = useState('');
  const [showRefs, setShowRefs] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextTarget = useRef<UploadTarget | null>(null);
  const focus = useMemo(() => focusOf(d, focusId), [d, focusId]);
  const skill = getDirectorSkill(d.skill);
  const cost = costLabel(d);
  const refCount = (d.referencias ?? []).length;
  const tags = d.etiquetas;

  const push = (...m: ChatMessage[]) =>
    setMessages((cur) => {
      const next = [...cur, ...m];
      writeChat(production.id, next);
      return next;
    });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, dm.busy]);

  /** Acción con conversación: eco de la persona → motor → narración del agente. */
  const chatAct = async (body: Body, key?: string, typed?: string) => {
    const echo = typed ?? userEcho(body, d);
    if (echo) push(newMessage('tu', echo, { nodo: focusId ?? undefined }));
    const r = await dm.run(body, key);
    if (r.ok) push(newMessage('agente', narrate(body.accion, r.before.director!, r.production.director!, body, r.aviso)));
    else push(newMessage('agente', `No pude hacerlo: ${r.error}`, { error: true }));
    return r.ok;
  };

  /** + Ref: guarda en la carpeta de la producción y, si hay fotos nuevas sin etiqueta, el agente propone etiquetas. */
  const handleFiles = async (files: File[], target: UploadTarget, voiceoverName?: string | null) => {
    if (!files.length) return;
    const escena = target.escenaId ? d.guion?.escenas.find((s) => s.id === target.escenaId) : undefined;
    const tag = target.etiquetaId ? d.etiquetas?.find((t) => t.id === target.etiquetaId) : undefined;
    push(newMessage('tu', `Subo ${files.length === 1 ? `«${files[0].name}»` : `${files.length} archivos`}${tag ? ` a @${tag.mencion}` : escena ? ` para la escena ${escena.orden}` : ''}.`));
    const r = await dm.uploadRefs(files, target);
    if (!r.ok) {
      push(newMessage('agente', `No pude guardarlos: ${r.error}`, { error: true }));
      return;
    }
    const after = r.production.director!;
    push(newMessage('agente', narrateUpload(after, r.nuevas, escena?.orden, tag ? `@${tag.mencion}` : undefined)));
    setShowRefs(true);
    const untagged = (after.referencias ?? []).filter((x) => r.nuevas.includes(x.id) && x.medio === 'imagen' && !x.etiquetaId).map((x) => x.id);
    if (untagged.length) await chatAct({ accion: 'proponer_etiquetas', refIds: untagged }, 'proponer_etiquetas', '');
    // "Es mi locución" (caja de inicio): se elige y, sin Confidencial, se transcribe gratis con Gemini
    const voice = voiceoverName ? (after.referencias ?? []).find((x) => r.nuevas.includes(x.id) && x.medio === 'audio' && x.nombreOriginal === voiceoverName) : undefined;
    if (voice && (await chatAct({ accion: 'usar_locucion', refId: voice.id, usarComoVoz: true }, 'usar_locucion', ''))) {
      onFocus('locucion');
      if (!after.confidencial) await chatAct({ accion: 'transcribir_locucion', motor: 'gemini' }, 'transcribir_locucion', '');
      else push(newMessage('agente', 'Con «Confidencial» no envío tu audio a Gemini gratis. Puedes transcribirlo con ElevenLabs (de pago) en la tarjeta de la locución.'));
    }
  };

  const pickFiles = (target?: UploadTarget) => {
    nextTarget.current = target ?? uploadTarget(focus);
    fileInput.current?.click();
  };

  // Archivos de la caja de inicio o soltados en el lienzo (se toman una sola vez)
  useEffect(() => {
    if (!pendingFiles?.length) return;
    const files = pendingFiles;
    const voice = pendingVoiceover;
    onPendingTaken?.();
    void Promise.resolve().then(() => handleFiles(files, uploadTarget(focus), voice));
    // Solo cuando llegan archivos nuevos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFiles]);

  /** Ejecuta la acción que propuso el chat; el agente narra el resultado. */
  const runPlan = (body: Body) => chatAct(body, busyKeyFor(body), '');

  /** Chat libre: pregunta o cambio, con el nodo enfocado como contexto. */
  const send = async () => {
    const t = text.trim();
    if (!t || dm.busy) return;
    setText('');
    const historial = messages.slice(-12).map((m) => ({ rol: m.rol, texto: m.texto }));
    push(newMessage('tu', t, { nodo: focusId ?? undefined }));
    const r = await dm.ask({ mensaje: t, historial, enfoque: focusId });
    if (!r.ok) {
      push(newMessage('agente', `No pude responder: ${r.error}`, { error: true }));
      return;
    }
    if (!r.plan) {
      push(newMessage('agente', [r.respuesta, r.motivo].filter(Boolean).join(' ')));
      return;
    }
    if (r.plan.ejecucion === 'auto') {
      push(newMessage('agente', r.respuesta || `${r.plan.resumen}.`));
      await runPlan(r.plan.body);
      return;
    }
    const { body, resumen, boton, costo } = r.plan;
    push(newMessage('agente', r.respuesta, { propuesta: { body, resumen, boton, costo, estado: 'pendiente' } }));
  };

  const decide = async (id: string, yes: boolean) => {
    const m = messages.find((x) => x.id === id);
    if (!m?.propuesta || m.propuesta.estado !== 'pendiente' || dm.busy) return;
    const body = m.propuesta.body;
    setMessages((cur) => {
      const next = cur.map((x) => (x.id === id && x.propuesta ? { ...x, propuesta: { ...x.propuesta, estado: yes ? ('hecha' as const) : ('descartada' as const) } } : x));
      writeChat(production.id, next);
      return next;
    });
    if (!yes) {
      push(newMessage('agente', 'De acuerdo, no cambio nada.'));
      return;
    }
    await runPlan(body);
  };

  const shown = messages.length ? messages : [newMessage('agente', greeting(d, production.nombre))];
  const target = uploadTarget(focus);
  const refHint = target.etiquetaId ? `a @${focus.tag?.mencion}` : target.escenaId ? `solo para la escena ${focus.scene?.orden}` : 'para todo el proyecto';
  const panelOpen = focus.kind === 'referencias' || (focus.kind === 'ninguno' && showRefs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera: con quién habla y en qué está enfocado */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Bot className="h-4 w-4 text-fg-subtle" />
        <span className="text-[12.5px] font-medium text-fg">Director</span>
        {skill && <span className="truncate text-[11px] text-fg-subtle">{skill.icono} {skill.nombre}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {focus.kind === 'ninguno' && (
            <button
              type="button"
              onClick={() => setShowRefs((v) => !v)}
              aria-pressed={showRefs}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                showRefs ? 'border-accent/40 bg-accent/10 text-fg' : 'border-line text-fg-muted hover:text-fg'
              }`}
              title="Referencias y etiquetas del proyecto"
            >
              <Images className="h-3 w-3" /> Referencias{refCount ? ` · ${refCount}` : ''}
            </button>
          )}
          {focus.kind !== 'ninguno' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-fg">
              <Crosshair className="h-3 w-3" /> {focus.label}
              <button type="button" onClick={onClearFocus} aria-label="Quitar el enfoque" className="ml-0.5 cursor-pointer text-fg-subtle hover:text-fg">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Conversación */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {shown.map((m) => (
          <div key={m.id} className={m.rol === 'tu' ? 'flex justify-end' : 'flex'}>
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                m.rol === 'tu'
                  ? 'bg-fg text-bg'
                  : m.error
                  ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'bg-surface-2 text-fg'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.rol === 'tu' ? m.texto : <MentionText text={m.texto} tags={tags} />}</p>
              {m.propuesta && (
                <div className="mt-2 border-t border-line pt-2">
                  <p className="text-[11.5px] text-fg-muted">
                    {m.propuesta.resumen} · {m.propuesta.costo}
                  </p>
                  {m.propuesta.estado === 'pendiente' ? (
                    <div className="mt-1.5 flex gap-1.5">
                      <button type="button" disabled={!!dm.busy} onClick={() => void decide(m.id, true)} className="btn-primary h-7 px-2.5 text-[11.5px]">
                        <Check className="h-3 w-3" /> {m.propuesta.boton}
                      </button>
                      <button type="button" disabled={!!dm.busy} onClick={() => void decide(m.id, false)} className="btn-secondary h-7 px-2.5 text-[11.5px]">
                        No
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-fg-subtle">{m.propuesta.estado === 'hecha' ? '✓ Hecho' : 'Descartado'}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {dm.busy && (
          <p className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {dm.busy === 'subir_referencias' ? 'Guardando archivos…' : dm.busy === 'proponer_etiquetas' ? 'Mirando las fotos…' : dm.busy === 'transcribir_locucion' ? 'Escuchando tu locución…' : 'Pensando…'}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {/* Tarjeta del momento: la del nodo enfocado, las referencias o la pausa de la etapa en curso */}
      <div className="max-h-[48%] overflow-y-auto border-t border-line px-3 py-3">
        {focus.kind === 'locucion' && d.locucion ? (
          <VoiceoverCard
            key={`${d.locucion.refId}-${d.locucion.transcripcion?.creada ?? 'sin'}-${d.locucion.transcripcion?.frases.map((f) => f.texto).join('|').length ?? 0}`}
            productionId={production.id}
            d={d}
            busy={dm.busy}
            act={(b, k) => chatAct(b as Body, k)}
          />
        ) : focus.kind === 'etiqueta' && focus.tag ? (
          <TagEditor
            key={`${focus.tag.id}-${focus.tag.rev}-${focus.tag.confirmada}`}
            productionId={production.id}
            d={d}
            tag={focus.tag}
            busy={dm.busy}
            act={(b, k) => chatAct(b as Body, k, '')}
            onAddFiles={(o) => pickFiles(o)}
            onClose={onClearFocus}
          />
        ) : panelOpen ? (
          <TagPanel
            productionId={production.id}
            d={d}
            busy={dm.busy}
            act={(b, k) => chatAct(b as Body, k, '')}
            costLabel={cost}
            onAddFiles={(o) => pickFiles({ ...o })}
            onOpenTag={(id) => onFocus(`etiqueta:${id}`)}
            onOpenVoiceover={() => onFocus('locucion')}
          />
        ) : (
          <Gate d={d} production={production} focus={focus} busy={dm.busy} act={(b, k) => chatAct(b as Body, k)} cost={cost} />
        )}
      </div>

      {/* Caja de texto */}
      <form
        className="flex items-end gap-2 border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,audio/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void handleFiles(files, nextTarget.current ?? uploadTarget(focus));
          }}
        />
        <button
          type="button"
          onClick={() => pickFiles()}
          disabled={!!dm.busy}
          className="btn-secondary h-9 w-9 shrink-0"
          aria-label={`+ Ref: añadir referencias ${refHint}`}
          title={`+ Ref: fotos, audio o PDF ${refHint}`}
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <MentionTextarea
          value={text}
          onChange={setText}
          tags={tags}
          atButton
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={composerPlaceholder(focus)}
          className="input-clean min-h-[44px] w-full resize-none p-2 text-[12.5px] disabled:opacity-60"
          aria-label="Mensaje para el Director"
        />
        <button type="submit" disabled={!text.trim() || !!dm.busy} className="btn-primary h-9 w-9 shrink-0" aria-label={`Enviar · ${cost}`} title={`Enviar · ${cost}`}>
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

type GateAct = (body: Record<string, unknown> & { accion: string }, key?: string) => Promise<boolean>;

function Gate({ d, production, focus, busy, act, cost }: { d: DirectorState; production: Production; focus: ReturnType<typeof focusOf>; busy: string | null; act: GateAct; cost: string }) {
  switch (focus.kind) {
    case 'idea':
      return <StageBody id="idea" p={production} busy={busy} act={act} />;
    case 'direccion':
      return (
        <div className="space-y-4">
          <StageBody id="preguntas" p={production} busy={busy} act={act} />
          <StageBody id="ajustes" p={production} busy={busy} act={act} />
        </div>
      );
    case 'escena': {
      const s = focus.scene!;
      return (
        <ScriptSceneCard
          key={`${s.id}-${d.guion!.generacion}-${s.version}-${s.duracionSeg}`}
          scene={s}
          ajustes={d.ajustes}
          ctx={d}
          audioSrc={d.locucion ? refUrl(production.id, d.locucion.refId) : null}
          showPromptState={Boolean(d.guion?.escenas.some((x) => x.prompt))}
          disabled={!!busy || d.etapas.guion.estado === 'bloqueada'}
          redoing={busy === `rehacer_escena:${s.id}`}
          saving={busy === `editar_escena:${s.id}`}
          costLabel={cost}
          onRedo={(indicacion) => void act({ accion: 'rehacer_escena', escenaId: s.id, indicacion }, `rehacer_escena:${s.id}`)}
          onSave={(cambios) => act({ accion: 'editar_escena', escenaId: s.id, cambios }, `editar_escena:${s.id}`)}
        />
      );
    }
    case 'prompt': {
      const s = focus.scene!;
      if (d.etapas.prompts.estado === 'bloqueada') return <p className="text-[12px] text-fg-subtle">Aprueba el guion para escribir los prompts.</p>;
      return <PromptRow key={`${s.id}-${s.version}-${s.prompt?.texto.length ?? 0}`} d={d} sceneId={s.id} busy={busy} act={act} cost={cost} />;
    }
    default:
      return <NextStep d={d} production={production} busy={busy} act={act} cost={cost} />;
  }
}

/** Sin nada enfocado: la pausa de la etapa en curso, en pequeño. */
function NextStep({ d, production, busy, act, cost }: { d: DirectorState; production: Production; busy: string | null; act: GateAct; cost: string }) {
  const cur = currentStage(d);
  if (cur === 'idea' || cur === 'preguntas' || cur === 'ajustes') return <StageBody id={cur} p={production} busy={busy} act={act} />;

  const btn = (label: string, body: Record<string, unknown> & { accion: string }, primary = false, confirm?: string) => (
    <button
      type="button"
      disabled={!!busy}
      onClick={() => {
        if (!confirm || window.confirm(confirm)) void act(body);
      }}
      className={`${primary ? 'btn-primary' : 'btn-secondary'} h-8 px-3 text-[12px]`}
    >
      {busy === body.accion && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {!primary && body.accion.startsWith('generar') && busy !== body.accion && <RotateCcw className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  if (cur === 'guion') {
    if (!d.guion?.escenas.length) return <div className="flex flex-wrap gap-2">{btn(`Escribir guion · ${cost}`, { accion: 'generar_guion' }, true)}</div>;
    const hasPrompts = d.guion.escenas.some((s) => s.prompt);
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-fg-muted">Revisa las escenas en el lienzo. Toca una para cambiarla.</p>
        <div className="flex flex-wrap gap-2">
          {btn(`Rehacer todo · ${cost}`, { accion: 'generar_guion' }, false, hasPrompts ? 'Rehacer todo el guion deja desactualizados todos los prompts. ¿Seguir?' : undefined)}
          {btn('Aprobar guion', { accion: 'aprobar', etapa: 'guion' }, true)}
        </div>
      </div>
    );
  }
  if (cur === 'prompts') {
    const escenas = d.guion?.escenas ?? [];
    const stale = escenas.filter((s) => promptIsStale(s, d));
    if (!escenas.some((s) => s.prompt)) return <div className="flex flex-wrap gap-2">{btn(`Escribir prompts · ${cost}`, { accion: 'generar_prompts', soloFaltantes: false }, true)}</div>;
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-fg-muted">
          {stale.length ? `Faltan o están desactualizados ${stale.length} prompts.` : 'Revisa los prompts en el lienzo. Toca uno para cambiarlo.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {stale.length > 0 && btn(`Escribir los ${stale.length} que faltan · ${cost}`, { accion: 'generar_prompts', soloFaltantes: true })}
          {stale.length === 0 && btn('Aprobar prompts', { accion: 'aprobar', etapa: 'prompts' }, true)}
        </div>
      </div>
    );
  }
  return <p className="text-[12px] text-fg-muted">Todo el texto está aprobado. Las imágenes iniciales y los clips llegan en las Fases 3 y 4; nada se ha gastado en video.</p>;
}
