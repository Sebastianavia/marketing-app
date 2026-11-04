'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  XCircle,
} from 'lucide-react';
import type { ClaudeChatMessage, ClaudeChatStep, EditProject } from '@/lib/editor/types';
import { editorApi, followClaude, type ClaudeAgentEvent, type ClaudeSandboxMode } from './editor-api';

/**
 * Chat con Claude dentro de una edición. Claude (Claude Code con la suscripción de la persona)
 * cambia el estilo y el guion con las herramientas de Lulo, renderiza con el motor y, si el
 * motor no alcanza, trabaja con FFmpeg/Python y publica su propia versión del borrador.
 */

const SUGGESTIONS = [
  'Subtítulos más grandes y en el centro',
  'Hazlo más dinámico: menos pausas y más zoom',
  'Quita la música',
  'Ponle un look cinematográfico (color cálido y viñeta)',
];

const MODE_INFO: Record<ClaudeSandboxMode, { label: string; hint: string; safe: boolean }> = {
  aislado: {
    label: 'Aislado',
    hint: 'Claude puede usar FFmpeg, Python e instalar herramientas, pero solo dentro de la carpeta de esta edición. No ve tus claves ni puede gastar dinero.',
    safe: true,
  },
  sin_aislamiento: {
    label: 'Sin aislamiento',
    hint: 'Windows no tiene aislamiento: Claude ejecuta comandos con tus permisos (activado con LULO_CLAUDE_BASH_SIN_AISLAMIENTO). No ve tus claves ni puede gastar dinero.',
    safe: false,
  },
  sin_bash: {
    label: 'Solo herramientas de Lulo',
    hint: 'En Windows Claude no ejecuta comandos (no hay aislamiento): cambia estilo, guion y renderiza con el motor de la app.',
    safe: true,
  },
};

interface LiveStep extends ClaudeChatStep {
  id: string;
  hecho: boolean;
}

interface Live {
  texto: string;
  pasos: LiveStep[];
}

export function ClaudeEditChat({ edit, onChanged }: { edit: EditProject; onChanged: () => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [modo, setModo] = useState<ClaudeSandboxMode | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const follow = async (id: string, expectTurn: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (expectTurn) setLive({ texto: '', pasos: [] });
    let ended: ClaudeAgentEvent | null = null;
    try {
      const r = await followClaude(
        id,
        (e) => {
          if (e.tipo === 'fin' || e.tipo === 'error') ended = e;
          setLive((prev) => applyEvent(prev ?? { texto: '', pasos: [] }, e));
        },
        ac.signal,
        () => setLive((prev) => prev ?? { texto: '', pasos: [] })
      );
      if (!r.activo) {
        if (r.modo) setModo(r.modo);
        setLive(null);
        return;
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Se perdió la conexión con Claude.');
    }
    if (ac.signal.aborted) return;
    const end = ended as ClaudeAgentEvent | null;
    if (end?.tipo === 'error' && end.codigo && end.codigo !== 'failed') setError(end.mensaje);
    setLive(null);
    onChangedRef.current();
    // Tras terminar se vuelve a pedir el modo (y se confirma que no queda turno)
    followClaude(id, () => {}).then((r) => r.modo && setModo(r.modo)).catch(() => undefined);
  };

  // Al abrir: si Claude está trabajando (p. ej. se cambió de pantalla), se retoma el seguimiento
  useEffect(() => {
    const first = setTimeout(() => void follow(edit.id, false), 0);
    return () => {
      clearTimeout(first);
      abortRef.current?.abort();
    };
    // Solo al cambiar de edición
  }, [edit.id]);

  const mensajes = edit.claude?.mensajes ?? [];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes.length, live?.texto, live?.pasos.length]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending || live) return;
    setSending(true);
    setError(null);
    try {
      await editorApi.claudeSend(edit.id, t);
      setInput('');
      onChangedRef.current(); // muestra el mensaje enviado
      void follow(edit.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a Claude.');
    } finally {
      setSending(false);
    }
  };

  const stop = () => void editorApi.claudeStop(edit.id).catch(() => undefined);
  const reset = async () => {
    if (!window.confirm('¿Empezar una conversación nueva? Claude olvidará lo hablado (los borradores se quedan).')) return;
    try {
      await editorApi.claudeReset(edit.id);
      onChangedRef.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar.');
    }
  };

  const info = modo ? MODE_INFO[modo] : null;
  const busy = Boolean(live) || sending;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h3 className="text-[14px] font-semibold text-fg">Claude · editor</h3>
          {info && (
            <span
              title={info.hint}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                info.safe ? 'border-line text-fg-muted' : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
              }`}
            >
              {info.safe ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {info.label}
            </span>
          )}
        </div>
        {mensajes.length > 0 && !busy && (
          <button type="button" onClick={reset} className="btn-secondary h-7 px-2.5 text-[11px]">
            <RotateCcw className="h-3 w-3" /> Nueva conversación
          </button>
        )}
      </div>
      <p className="text-[12px] text-fg-subtle">
        Pídele cualquier cambio. Usa tu suscripción de Claude ($0 extra); cada versión que haga aparece arriba como borrador para que la
        apruebes.
      </p>

      {(mensajes.length > 0 || live) && (
        <div ref={listRef} className="desktop-scroll max-h-[460px] space-y-3 overflow-y-auto pr-1">
          {mensajes.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {live && <LiveMessage live={live} />}
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {mensajes.length === 0 && !live && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInput(s)}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          disabled={busy}
          placeholder={busy ? 'Claude está trabajando…' : 'Ej.: pon el video en blanco y negro y los subtítulos en amarillo'}
          className="input-clean min-h-[44px] flex-1 resize-y px-3 py-2 text-[13px]"
          aria-label="Mensaje para Claude"
        />
        {live ? (
          <button type="button" onClick={stop} className="btn-secondary h-10 px-3 text-[12px]">
            <Square className="h-3.5 w-3.5" /> Detener
          </button>
        ) : (
          <button type="button" onClick={() => void send(input)} disabled={busy || !input.trim()} className="btn-primary h-10 px-4 text-[12px]">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar
          </button>
        )}
      </div>
    </section>
  );
}

function applyEvent(prev: Live, e: ClaudeAgentEvent): Live {
  switch (e.tipo) {
    case 'texto':
      return { ...prev, texto: prev.texto + e.delta };
    case 'paso':
      return { ...prev, pasos: [...prev.pasos, { id: e.id, herramienta: e.herramienta, detalle: e.detalle, hecho: false }] };
    case 'resultado_paso':
      return {
        ...prev,
        pasos: prev.pasos.map((s) => (s.id === e.id ? { ...s, hecho: true, error: e.error ? e.resumen : undefined } : s)),
      };
    default:
      return prev;
  }
}

function Message({ m }: { m: ClaudeChatMessage }) {
  if (m.rol === 'usuario') {
    return (
      <div className="ml-auto max-w-[85%] rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-fg whitespace-pre-wrap">{m.texto}</div>
    );
  }
  return (
    <div className={`max-w-[95%] space-y-2 rounded-xl border px-3 py-2.5 ${m.error ? 'border-rose-500/30' : 'border-line'}`}>
      {m.pasos && m.pasos.length > 0 && <Steps pasos={m.pasos} />}
      <RichText text={m.texto} />
      {(m.duracionSeg !== undefined || (m.denegados?.length ?? 0) > 0) && (
        <p className="text-[11px] text-fg-subtle">
          {m.duracionSeg !== undefined ? `${formatSecs(m.duracionSeg)}` : ''}
          {m.denegados?.length ? ` · ${m.denegados.length} acción(es) bloqueada(s) por seguridad` : ''}
        </p>
      )}
    </div>
  );
}

function LiveMessage({ live }: { live: Live }) {
  const last = live.pasos[live.pasos.length - 1];
  return (
    <div className="max-w-[95%] space-y-2 rounded-xl border border-accent/40 px-3 py-2.5">
      {live.pasos.length > 0 && <Steps pasos={live.pasos} open />}
      {live.texto ? <RichText text={live.texto} /> : null}
      <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Loader2 className="h-3 w-3 animate-spin" />
        {last && !last.hecho ? `${stepLabel(last)}…` : 'Claude está trabajando…'}
      </p>
    </div>
  );
}

function Steps({ pasos, open: initiallyOpen = false }: { pasos: Array<ClaudeChatStep & { hecho?: boolean }>; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const fails = pasos.filter((p) => p.error).length;
  return (
    <div className="text-[11px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-fg-subtle hover:text-fg">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {pasos.length} paso{pasos.length === 1 ? '' : 's'}
        {fails ? ` · ${fails} con error` : ''}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l border-line pl-2.5">
          {pasos.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5 text-fg-muted">
              {p.error ? (
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
              ) : p.hecho === false ? (
                <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
              )}
              <span className="min-w-0 break-words">
                {stepLabel(p)}
                {p.error ? <span className="block text-rose-600 dark:text-rose-400">{p.error}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STEP_NAMES: Record<string, string> = {
  'lulo: ver_edicion': 'Mirando la edición',
  'lulo: cambiar_perfil': 'Cambiando el estilo',
  'lulo: cambiar_guion': 'Ajustando el guion',
  'lulo: renderizar': 'Armando el video con el motor',
  'lulo: esperar_render': 'Esperando el render',
  'lulo: publicar_borrador': 'Publicando la nueva versión',
  Bash: 'Comando',
  Read: 'Leyendo',
  Write: 'Escribiendo',
  Edit: 'Editando',
  Glob: 'Buscando archivos',
  Grep: 'Buscando',
  WebSearch: 'Buscando en internet',
  WebFetch: 'Abriendo página',
};

function stepLabel(p: ClaudeChatStep): string {
  const name = STEP_NAMES[p.herramienta] ?? p.herramienta;
  return p.detalle ? `${name}: ${p.detalle}` : name;
}

function formatSecs(s: number): string {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Markdown mínimo: párrafos, listas con "-" o "1.", **negrita** y `código`. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-fg">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b)}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
