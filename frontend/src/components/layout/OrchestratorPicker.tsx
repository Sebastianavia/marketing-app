'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import {
  CLAUDE_SUBSCRIPTION_MODEL,
  CLAUDE_TIER_OPTIONS,
  DEFAULT_ORCHESTRATOR,
  ORCHESTRATOR_OPTIONS,
  getOrchestratorOption,
  isClaudeCodeMode,
  type ClaudeModelTier,
  type OrchestratorMode,
} from '@/config/llm-models';

interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  subscriptionType?: string;
  apiKeyConfigured?: boolean;
  apiKeyBaseUrl?: string;
  rateLimit?: { status: string; fiveHour?: number; sevenDay?: number };
  error?: string;
}

const pct = (v?: number) => (typeof v === 'number' ? `${Math.round(v * 100)} %` : '—');

/** Texto de estado de Claude Code bajo la opción "mi suscripción" (null = listo y sin datos de cupo). */
function subscriptionHint(st: ClaudeCodeStatus | null): { text: string; ready: boolean } {
  if (!st) return { text: 'Comprobando Claude Code…', ready: false };
  if (!st.installed) return { text: 'Claude Code no está instalado en este PC.', ready: false };
  if (!st.loggedIn) return { text: 'Claude Code sin sesión: en una terminal ejecuta `claude` y /login.', ready: false };
  const plan = st.subscriptionType ? `Plan ${st.subscriptionType}` : 'Sesión iniciada';
  const rl = st.rateLimit;
  const cupo = rl ? ` · usado: 5 h ${pct(rl.fiveHour)}, semana ${pct(rl.sevenDay)}` : '';
  return { text: `${plan}${cupo}`, ready: true };
}

/** Texto de estado de Claude Code bajo la opción "API Key". */
function apiKeyHint(st: ClaudeCodeStatus | null): { text: string; ready: boolean } {
  if (!st) return { text: 'Comprobando Claude Code…', ready: false };
  if (!st.installed) return { text: 'Claude Code no está instalado en este PC.', ready: false };
  if (!st.apiKeyConfigured) return { text: 'Falta ANTHROPIC_AUTH_TOKEN en frontend/.env.local.', ready: false };
  return { text: `Clave activa · ${st.apiKeyBaseUrl || 'API'}`, ready: true };
}

/** Selector global: quién genera guiones, escenas y textos en este PC. */
export function OrchestratorPicker() {
  const [mode, setMode] = useState<OrchestratorMode | null>(null);
  const [claudeModel, setClaudeModel] = useState<ClaudeModelTier>(CLAUDE_SUBSCRIPTION_MODEL);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Al abrir el menú se consulta Claude Code (instalado, sesión, cupo)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch('/api/system/claude-code', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setClaudeStatus(d ?? { installed: false, loggedIn: false }))
      .catch(() => alive && setClaudeStatus({ installed: false, loggedIn: false }));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    fetch('/api/settings/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setMode(d?.orchestrator ?? DEFAULT_ORCHESTRATOR);
        if (d?.claudeModel) setClaudeModel(d.claudeModel);
      })
      .catch(() => alive && setMode(DEFAULT_ORCHESTRATOR));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = async (next: OrchestratorMode) => {
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      const r = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchestrator: next }),
      });
      if (!r.ok) throw new Error();
      // Las pantallas que cambian según el modo (chat de Claude del Director…) se enteran al momento
      window.dispatchEvent(new CustomEvent('lulo:orchestrator', { detail: next }));
    } catch {
      setMode(prev);
    } finally {
      setSaving(false);
    }
  };

  const chooseTier = async (nextTier: ClaudeModelTier) => {
    const prev = claudeModel;
    setClaudeModel(nextTier);
    setSaving(true);
    try {
      const r = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeModel: nextTier }),
      });
      if (!r.ok) throw new Error();
      window.dispatchEvent(new CustomEvent('lulo:claudemodel', { detail: nextTier }));
    } catch {
      setClaudeModel(prev);
    } finally {
      setSaving(false);
    }
  };

  if (!mode) return null;
  const current = getOrchestratorOption(mode);
  const tierName = claudeModel === 'haiku' ? 'Haiku' : claudeModel === 'opus' ? 'Opus' : 'Sonnet';
  const badgeLabel = isClaudeCodeMode(mode) ? `${current.short} (${tierName})` : current.short;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        title="Quién genera guiones y textos (orquestador)"
      >
        <Cpu className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">IA</span>
        <span className={`font-medium text-fg ${saving ? 'opacity-60' : ''}`}>{badgeLabel}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-9 z-50 w-84 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-fg-subtle">
            Orquestador: genera guiones, escenas, chats y “Dar emoción”.
          </p>
          {ORCHESTRATOR_OPTIONS.map((o) => {
            const active = o.mode === mode;
            const hint =
              o.mode === 'claude-subscription'
                ? subscriptionHint(claudeStatus)
                : o.mode === 'claude-apikey'
                  ? apiKeyHint(claudeStatus)
                  : null;
            const disabled = Boolean(hint && !hint.ready && !active);
            return (
              <button
                key={o.mode}
                type="button"
                role="option"
                aria-selected={active}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => choose(o.mode)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                } ${active ? 'bg-surface-2' : disabled ? '' : 'hover:bg-surface-2'}`}
              >
                <span className="mt-0.5 w-3.5 shrink-0">{active && <Check className="h-3.5 w-3.5 text-accent" />}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-fg">{o.label}</span>
                  <span className="block text-[11px] leading-snug text-fg-subtle">{o.description}</span>
                  {hint && (
                    <span className={`mt-0.5 block text-[11px] leading-snug ${hint.ready ? 'text-accent' : 'text-amber-600 dark:text-amber-400'}`}>
                      {hint.text}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {/* Selector de nivel Haiku / Sonnet / Opus cuando se usa Claude Code */}
          {isClaudeCodeMode(mode) && (
            <div className="mt-2 border-t border-line/60 px-2.5 pt-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-fg">Nivel de Claude</span>
                <span className="text-[10px] text-fg-subtle">
                  {CLAUDE_TIER_OPTIONS.find((t) => t.id === claudeModel)?.description}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
                {CLAUDE_TIER_OPTIONS.map((t) => {
                  const sel = t.id === claudeModel;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => chooseTier(t.id)}
                      className={`rounded-md py-1.5 text-center transition-colors cursor-pointer ${
                        sel ? 'bg-surface font-semibold text-fg shadow-sm ring-1 ring-accent/30' : 'text-fg-subtle hover:text-fg hover:bg-surface/50'
                      }`}
                    >
                      <span className="block text-[12px]">{t.label}</span>
                      <span className={`block text-[10px] ${sel ? 'text-accent font-medium' : 'opacity-70'}`}>
                        {t.tier}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
