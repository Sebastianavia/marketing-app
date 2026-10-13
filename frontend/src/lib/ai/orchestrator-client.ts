'use client';

/**
 * POST a una ruta que usa el orquestador. Si el modo gratis (Gemini) se quedó
 * sin cuota, pregunta antes de gastar y, si se acepta, repite con Claude Haiku.
 */
export async function postOrchestrated(
  url: string,
  body: Record<string, unknown>,
  init: { signal?: AbortSignal } = {}
): Promise<Response> {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...extra }),
      signal: init.signal,
    });

  const res = await send();
  if (res.status !== 409) return res;

  const data = await res.clone().json().catch(() => ({}));
  if (data?.code !== 'free_exhausted') return res;

  const ok = window.confirm(
    `${data.error || 'Gemini gratis no está disponible ahora.'}\n\n` +
      '¿Usar Claude Haiku 5.5 solo para esta vez? Es de pago, normalmente menos de un centavo por guion.'
  );
  return ok ? send({ orchestrator: 'claude-cheap' }) : res;
}
