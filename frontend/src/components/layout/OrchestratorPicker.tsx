'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import {
  DEFAULT_ORCHESTRATOR,
  ORCHESTRATOR_OPTIONS,
  getOrchestratorOption,
  type OrchestratorMode,
} from '@/config/llm-models';

/** Selector global: quién genera guiones, escenas y textos en este PC. */
export function OrchestratorPicker() {
  const [mode, setMode] = useState<OrchestratorMode | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/settings/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMode(d?.orchestrator ?? DEFAULT_ORCHESTRATOR))
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
    setOpen(false);
    setSaving(true);
    try {
      const r = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchestrator: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setMode(prev);
    } finally {
      setSaving(false);
    }
  };

  if (!mode) return null;
  const current = getOrchestratorOption(mode);

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
        <span className={`font-medium text-fg ${saving ? 'opacity-60' : ''}`}>{current.short}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-fg-subtle">
            Orquestador: genera guiones, escenas y “Dar emoción”.
          </p>
          {ORCHESTRATOR_OPTIONS.map((o) => {
            const active = o.mode === mode;
            return (
              <button
                key={o.mode}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(o.mode)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  active ? 'bg-surface-2' : 'hover:bg-surface-2'
                }`}
              >
                <span className="mt-0.5 w-3.5 shrink-0">{active && <Check className="h-3.5 w-3.5 text-accent" />}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-fg">{o.label}</span>
                  <span className="block text-[11px] leading-snug text-fg-subtle">{o.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
