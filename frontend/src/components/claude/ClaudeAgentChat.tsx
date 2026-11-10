'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Paperclip,
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
import type { AgentEvent, ClaudeChatMessage, ClaudeChatStep, SandboxMode } from '@/lib/ai/claude-code/agent-types';
import { agentApi, followAgent } from './agent-api';
import { MaterialFolderBar } from '@/components/material/MaterialFolderBar';

/**
 * Chat con Claude-agente (Claude Code con la suscripción de la persona). Lo usan el editor de
 * video y el Director. Muestra la conversación guardada, sigue en vivo el turno en curso
 * (también si se cambió de pantalla) y permite detenerlo.
 */

const MODE_INFO: Record<SandboxMode, { label: string; hint: string; safe: boolean }> = {
  aislado: {
    label: 'Aislado',
    hint: 'Claude puede usar FFmpeg, Python e instalar herramientas, pero solo dentro de la carpeta de este proyecto. No ve tus claves ni puede gastar dinero.',
    safe: true,
  },
  sin_aislamiento: {
    label: 'Todos los permisos',
    hint: 'En Windows no hay aislamiento: Claude ejecuta comandos con todos tus permisos. No recibe tus claves en su entorno y sus herramientas de archivos siguen limitadas a este proyecto. Para apagarlo: LULO_CLAUDE_BASH_SIN_AISLAMIENTO=0.',
    safe: false,
  },
  sin_bash: {
    label: 'Solo herramientas de Lulo',
    hint: 'Comandos desactivados (LULO_CLAUDE_BASH_SIN_AISLAMIENTO=0): Claude trabaja solo con las herramientas de la app.',
    safe: true,
  },
};

const BASE_STEP_NAMES: Record<string, string> = {
  Bash: 'Comando',
  Read: 'Leyendo',
  Write: 'Escribiendo',
  Edit: 'Editando',
  Glob: 'Buscando archivos',
  Grep: 'Buscando',
  WebSearch: 'Buscando en internet',
  WebFetch: 'Abriendo página',
};

interface LiveStep extends ClaudeChatStep {
  id: string;
  hecho: boolean;
}

interface Live {
  texto: string;
  pasos: LiveStep[];
}

export interface ClaudeAgentChatProps {
  /** Ruta …/claude del proyecto. */
  endpoint: string;
  mensajes: ClaudeChatMessage[];
  /** Recargar el proyecto (al terminar un turno y, con refreshOnStep, tras cada herramienta de Lulo). */
  onChanged: () => void;
  title: string;
  intro?: string;
  suggestions?: string[];
  placeholder?: string;
  /** Nombres legibles de las herramientas de Lulo: { 'lulo: ver_proyecto': 'Mirando el proyecto' }. */
  stepNames?: Record<string, string>;
  refreshOnStep?: boolean;
  /** Ocupa todo el alto del contenedor (panel lateral) en vez de ser una tarjeta. */
  fill?: boolean;
  /** Dibuja un medio cuando Claude escribe [[media:ID]] en una línea (Estudio Claude). */
  renderMedia?: (id: string) => React.ReactNode;
  /** Contenido fijo sobre el campo de texto (p. ej. tarjetas de aprobación). */
  topSlot?: React.ReactNode;
  /** Adjuntar archivos: los guarda y devuelve sus rutas, que se añaden al mensaje. */
  onAttach?: (files: File[]) => Promise<string[]>;
  /** Clave de la carpeta de material (`edit:<id>`…): muestra la barra para elegirla. */
  materialKey?: string;
  /** Tipos que acepta el botón de adjuntar (por defecto fotos, video, audio, PDF y textos). */
  attachAccept?: string;
}

/** Quién dibuja los [[media:ID]] dentro de los mensajes. */
const MediaContext = createContext<((id: string) => React.ReactNode) | null>(null);
const MEDIA_LINE = /^\s*\[\[media:([a-z0-9_]+)\]\]\s*$/;

export function ClaudeAgentChat({
  endpoint,
  mensajes,
  onChanged,
  title,
  intro,
  suggestions = [],
  placeholder = 'Escribe qué quieres que haga Claude…',
  stepNames = {},
  refreshOnStep = false,
  fill = false,
  renderMedia,
  topSlot,
  onAttach,
  materialKey,
  attachAccept = 'image/*,video/*,audio/*,application/pdf,.txt,.md,.srt,.csv,.docx',
}: ClaudeAgentChatProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [modo, setModo] = useState<SandboxMode | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  const listRef = useRef<HTMLDivElement>(null);
  const names = { ...BASE_STEP_NAMES, ...stepNames };

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const follow = async (expectTurn: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (expectTurn) setLive({ texto: '', pasos: [] });
    let ended: AgentEvent | null = null;
    let lastRefresh = 0;
    try {
      const r = await followAgent(
        endpoint,
        (e) => {
          if (e.tipo === 'fin' || e.tipo === 'error') ended = e;
          // Lo que Claude cambia con las herramientas de Lulo se ve en el proyecto mientras trabaja
          if (refreshOnStep && e.tipo === 'resultado_paso' && Date.now() - lastRefresh > 800) {
            lastRefresh = Date.now();
            onChangedRef.current();
          }
          setLive((prev) => applyEvent(prev ?? { texto: '', pasos: [] }, e));
        },
        ac.signal,
        () => setLive((prev) => prev ?? { texto: '', pasos: [] }),
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
    const end = ended as AgentEvent | null;
    if (end?.tipo === 'error' && end.codigo && end.codigo !== 'failed') setError(end.mensaje);
    setLive(null);
    onChangedRef.current();
    followAgent(endpoint, () => {})
      .then((r) => r.modo && setModo(r.modo))
      .catch(() => undefined);
  };

  // La última versión de follow, para los efectos (que solo dependen del proyecto)
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  });

  // Al abrir (o cambiar de proyecto): si Claude está trabajando, se retoma el seguimiento
  useEffect(() => {
    const first = setTimeout(() => void followRef.current(false), 0);
    return () => {
      clearTimeout(first);
      abortRef.current?.abort();
    };
  }, [endpoint]);

  // Si el último mensaje es de la persona y aún no hay turno visible, se vuelve a mirar
  // (p. ej. el primer pase que arranca el servidor justo después de crear el proyecto)
  const waiting = !live && mensajes.length > 0 && mensajes[mensajes.length - 1].rol === 'usuario';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void followRef.current(false), 2500);
    return () => clearInterval(t);
  }, [waiting, endpoint]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes.length, live?.texto, live?.pasos.length]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending || live) return;
    setSending(true);
    setError(null);
    try {
      await agentApi.send(endpoint, t);
      setInput('');
      onChangedRef.current(); // muestra el mensaje enviado
      void follow(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a Claude.');
    } finally {
      setSending(false);
    }
  };

  const stop = () => void agentApi.stop(endpoint).catch(() => undefined);
  const reset = async () => {
    if (!window.confirm('¿Empezar una conversación nueva? Claude olvidará lo hablado (el proyecto se queda como está).')) return;
    try {
      await agentApi.reset(endpoint);
      onChangedRef.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar.');
    }
  };

  const info = modo ? MODE_INFO[modo] : null;
  const busy = Boolean(live) || sending;

  return (
    <MediaContext.Provider value={renderMedia ?? null}>
      <section className={fill ? 'flex h-full min-h-0 flex-col gap-3 p-4' : 'space-y-3 rounded-xl border border-line bg-surface p-5'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
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
        {intro && <p className="text-[12px] text-fg-subtle">{intro}</p>}

        {(mensajes.length > 0 || live) && (
          <div ref={listRef} className={`desktop-scroll space-y-3 overflow-y-auto pr-1 ${fill ? 'min-h-0 flex-1' : 'max-h-[460px]'}`}>
            {mensajes.map((m) => (
              <Message key={m.id} m={m} names={names} />
            ))}
            {live && <LiveMessage live={live} names={names} />}
            {waiting && (
              <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <Loader2 className="h-3 w-3 animate-spin" /> Claude se está preparando…
              </p>
            )}
          </div>
        )}
        {fill && mensajes.length === 0 && !live && <div className="flex-1" />}

        {error && (
          <p className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {mensajes.length === 0 && !live && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
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

        {topSlot}

        {materialKey && <MaterialFolderBar clave={materialKey} />}

        <div className="flex items-end gap-2">
          {onAttach && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept={attachAccept}
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (!files.length) return;
                  setAttaching(true);
                  try {
                    const rutas = await onAttach(files);
                    setInput((t) => `${t ? `${t.trim()}\n` : ''}Adjunté: ${rutas.join(', ')}`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'No se pudieron adjuntar.');
                  } finally {
                    setAttaching(false);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={attaching}
                className="btn-secondary h-10 w-10 shrink-0 px-0"
                aria-label="Adjuntar fotos, videos, audios, PDF o textos"
                title="Adjuntar fotos, videos, audios, PDF o textos (guion, brief)"
              >
                {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
            </>
          )}
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
            placeholder={busy ? 'Claude está trabajando…' : placeholder}
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
    </MediaContext.Provider>
  );
}

function applyEvent(prev: Live, e: AgentEvent): Live {
  switch (e.tipo) {
    case 'texto':
      return { ...prev, texto: prev.texto + e.delta };
    case 'paso':
      return { ...prev, pasos: [...prev.pasos, { id: e.id, herramienta: e.herramienta, detalle: e.detalle, hecho: false }] };
    case 'resultado_paso':
      return { ...prev, pasos: prev.pasos.map((s) => (s.id === e.id ? { ...s, hecho: true, error: e.error ? e.resumen : undefined } : s)) };
    default:
      return prev;
  }
}

type Names = Record<string, string>;

function Message({ m, names }: { m: ClaudeChatMessage; names: Names }) {
  if (m.rol === 'usuario') {
    return <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-fg">{m.texto}</div>;
  }
  return (
    <div className={`max-w-[95%] space-y-2 rounded-xl border px-3 py-2.5 ${m.error ? 'border-rose-500/30' : 'border-line'}`}>
      {m.pasos && m.pasos.length > 0 && <Steps pasos={m.pasos} names={names} />}
      <RichText text={m.texto} />
      {(m.duracionSeg !== undefined || (m.denegados?.length ?? 0) > 0) && (
        <p className="text-[11px] text-fg-subtle">
          {m.duracionSeg !== undefined ? formatSecs(m.duracionSeg) : ''}
          {m.denegados?.length ? ` · ${m.denegados.length} acción(es) bloqueada(s) por seguridad` : ''}
        </p>
      )}
    </div>
  );
}

function LiveMessage({ live, names }: { live: Live; names: Names }) {
  const last = live.pasos[live.pasos.length - 1];
  return (
    <div className="max-w-[95%] space-y-2 rounded-xl border border-accent/40 px-3 py-2.5">
      {live.pasos.length > 0 && <Steps pasos={live.pasos} names={names} open />}
      {live.texto ? <RichText text={live.texto} /> : null}
      <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Loader2 className="h-3 w-3 animate-spin" />
        {last && !last.hecho ? `${stepLabel(last, names)}…` : 'Claude está trabajando…'}
      </p>
    </div>
  );
}

function Steps({ pasos, names, open: initiallyOpen = false }: { pasos: Array<ClaudeChatStep & { hecho?: boolean }>; names: Names; open?: boolean }) {
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
                {stepLabel(p, names)}
                {p.error ? <span className="block text-rose-600 dark:text-rose-400">{p.error}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function stepLabel(p: ClaudeChatStep, names: Names): string {
  const name = names[p.herramienta] ?? p.herramienta;
  return p.detalle ? `${name}: ${p.detalle}` : name;
}

function formatSecs(s: number): string {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;

/** Markdown mínimo: párrafos, listas con "-" o "1.", **negrita** y `código`. */
function RichText({ text }: { text: string }) {
  const renderMedia = useContext(MediaContext);
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-fg">
      {blocks.flatMap((b, i) => {
        // Dentro de un bloque, las líneas seguidas que empiezan con "-", "*" o "1." forman una lista
        // (aunque vengan justo debajo de un título sin línea en blanco)
        const groups: Array<{ list: boolean; media?: string; lines: string[] }> = [];
        for (const line of b.split('\n')) {
          const media = renderMedia ? MEDIA_LINE.exec(line)?.[1] : undefined;
          if (media) {
            groups.push({ list: false, media, lines: [] });
            continue;
          }
          const list = LIST_ITEM.test(line);
          const last = groups[groups.length - 1];
          if (last && !last.media && last.list === list) last.lines.push(line);
          else groups.push({ list, lines: [line] });
        }
        return groups.map((g, j) =>
          g.media && renderMedia ? (
            <div key={`${i}-${j}`}>{renderMedia(g.media)}</div>
          ) : g.list ? (
            <ul key={`${i}-${j}`} className="list-disc space-y-0.5 pl-5">
              {g.lines.map((l, k) => (
                <li key={k}>{inline(l.replace(LIST_ITEM, ''))}</li>
              ))}
            </ul>
          ) : (
            <p key={`${i}-${j}`} className="whitespace-pre-wrap">
              {inline(g.lines.join('\n'))}
            </p>
          ),
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
