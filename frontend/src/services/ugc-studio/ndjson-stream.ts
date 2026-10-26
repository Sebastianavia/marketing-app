import type { StudioEvent } from '@/types/ugc-studio.types';
import type { Emit } from './orchestrator.service';

/**
 * Convierte un trabajo de agentes en una respuesta NDJSON (un StudioEvent por línea),
 * para que la UI muestre en vivo qué agente corre en qué llave/modelo.
 */
export function ndjsonResponse(
  requestSignal: AbortSignal,
  work: (emit: Emit, signal: AbortSignal) => Promise<StudioEvent>
): Response {
  // Se cancela si el cliente se desconecta o si un agente falla (para no dejar agentes en paralelo gastando cuota)
  const abortController = new AbortController();
  requestSignal.addEventListener('abort', () => abortController.abort(requestSignal.reason), { once: true });
  const signal = abortController.signal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // el cliente cerró la conexión
        }
      };
      try {
        emit(await work(emit, signal));
      } catch (err: any) {
        if (!requestSignal.aborted) emit({ type: 'error', message: err?.message || 'Error en el equipo de agentes' });
        abortController.abort();
      } finally {
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}
