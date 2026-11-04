'use client';

import type { AgentEvent, SandboxMode } from '@/lib/ai/claude-code/agent-types';

/**
 * Llamadas del chat con Claude-agente. `endpoint` es la ruta …/claude del proyecto
 * (p. ej. /api/editor/projects/<id>/claude o /api/director-mode/<id>/claude).
 */

async function post(endpoint: string, body: Record<string, unknown>) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo hablar con Claude.');
  return d;
}

export const agentApi = {
  send: (endpoint: string, mensaje: string) => post(endpoint, { accion: 'enviar', mensaje }),
  stop: (endpoint: string) => post(endpoint, { accion: 'detener' }),
  reset: (endpoint: string) => post(endpoint, { accion: 'nueva_conversacion' }),
  /** Solo Director: arranca el primer pase de un proyecto recién creado. */
  start: (endpoint: string) => post(endpoint, { accion: 'iniciar' }),
};

/**
 * Sigue el turno de Claude. Sin turno en curso devuelve { activo: false, modo };
 * con turno, llama a onEvent con cada evento hasta que termina y devuelve { activo: true }.
 */
export async function followAgent(
  endpoint: string,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  onOpen?: () => void
): Promise<{ activo: boolean; modo?: SandboxMode }> {
  const r = await fetch(`${endpoint}?desde=0`, { cache: 'no-store', signal });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'No se pudo leer el chat.');
  }
  if ((r.headers.get('content-type') ?? '').includes('application/json')) return r.json();
  onOpen?.();
  const reader = r.body?.getReader();
  if (!reader) return { activo: true };
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as AgentEvent);
      } catch {
        // línea incompleta o no JSON: se ignora
      }
    }
  }
  return { activo: true };
}
