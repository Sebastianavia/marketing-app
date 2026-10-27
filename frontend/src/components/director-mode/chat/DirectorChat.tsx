'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Crosshair, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { getDirectorSkill } from '@/config/director-skills';
import { currentStage, promptIsStale } from '@/lib/director-mode/stages';
import type { DirectorState } from '@/lib/director-mode/types';
import type { Production } from '@/lib/director/production-store';
import { ScriptSceneCard } from '../ScriptSceneCard';
import { PromptRow, StageBody, costLabel } from '../stage-forms';
import type { useDirectorMode } from '../useDirectorMode';
import { newMessage, readChat, writeChat, type ChatMessage } from './chat-log';
import { composerFor, focusOf, greeting, narrate, userEcho } from './node-actions';

/**
 * Chat del agente (izquierda del lienzo). En este paso no interpreta frases libres:
 * lo que escribes va a la acción del nodo enfocado (rehacer escena / rehacer prompt, con tu texto como indicación)
 * y las pausas (preguntas, ajustes, aprobar) aparecen como tarjetas. El agente narra cada resultado.
 */

type DM = ReturnType<typeof useDirectorMode>;
type Body = Record<string, unknown> & { accion: string };

interface Props {
  dm: DM;
  production: Production;
  focusId: string | null;
  onClearFocus: () => void;
}

export function DirectorChat({ dm, production, focusId, onClearFocus }: Props) {
  const d = production.director!;
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat(production.id));
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const focus = useMemo(() => focusOf(d, focusId), [d, focusId]);
  const composer = composerFor(d, focus);
  const skill = getDirectorSkill(d.skill);
  const cost = costLabel(d);

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

  const send = async () => {
    const t = text.trim();
    if (!t || !composer.enabled || !composer.toBody || dm.busy) return;
    setText('');
    await chatAct(composer.toBody(t), composer.busyKey, t);
  };

  const shown = messages.length ? messages : [newMessage('agente', greeting(d, production.nombre))];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera: con quién habla y en qué está enfocado */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Bot className="h-4 w-4 text-fg-subtle" />
        <span className="text-[12.5px] font-medium text-fg">Director</span>
        {skill && <span className="truncate text-[11px] text-fg-subtle">{skill.icono} {skill.nombre}</span>}
        {focus.kind !== 'ninguno' && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-fg">
            <Crosshair className="h-3 w-3" /> {focus.label}
            <button type="button" onClick={onClearFocus} aria-label="Quitar el enfoque" className="ml-0.5 cursor-pointer text-fg-subtle hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {/* Conversación */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {shown.map((m) => (
          <div key={m.id} className={m.rol === 'tu' ? 'flex justify-end' : 'flex'}>
            <p
              className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                m.rol === 'tu'
                  ? 'bg-fg text-bg'
                  : m.error
                  ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'bg-surface-2 text-fg'
              }`}
            >
              {m.texto}
            </p>
          </div>
        ))}
        {dm.busy && (
          <p className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </p>
        )}
        <div ref={endRef} />
      </div>

      {/* Tarjeta del momento: la del nodo enfocado o la pausa de la etapa en curso */}
      <div className="max-h-[48%] overflow-y-auto border-t border-line px-3 py-3">
        <Gate d={d} production={production} focus={focus} busy={dm.busy} act={(b, k) => chatAct(b as Body, k)} cost={cost} />
      </div>

      {/* Caja de texto */}
      <form
        className="flex items-end gap-2 border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={!composer.enabled}
          placeholder={composer.placeholder}
          className="input-clean min-h-[44px] flex-1 resize-none p-2 text-[12.5px] disabled:opacity-60"
          aria-label="Mensaje para el Director"
        />
        <button type="submit" disabled={!composer.enabled || !text.trim() || !!dm.busy} className="btn-primary h-9 w-9 shrink-0" aria-label={`Enviar · ${cost}`} title={`Enviar · ${cost}`}>
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
    const stale = escenas.filter(promptIsStale);
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
