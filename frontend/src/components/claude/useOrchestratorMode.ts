'use client';

import { useEffect, useState } from 'react';
import { isOrchestratorMode, type OrchestratorMode } from '@/config/llm-models';

/** Evento que lanza el selector "IA" al cambiar de modo (OrchestratorPicker). */
export const ORCHESTRATOR_EVENT = 'lulo:orchestrator';

/** Modo del selector "IA" de este PC (null mientras carga). Se actualiza al cambiarlo. */
export function useOrchestratorMode(): OrchestratorMode | null {
  const [mode, setMode] = useState<OrchestratorMode | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMode(isOrchestratorMode(d?.orchestrator) ? d.orchestrator : 'free'))
      .catch(() => alive && setMode('free'));
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail;
      if (isOrchestratorMode(next)) setMode(next);
    };
    window.addEventListener(ORCHESTRATOR_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(ORCHESTRATOR_EVENT, onChange);
    };
  }, []);
  return mode;
}
