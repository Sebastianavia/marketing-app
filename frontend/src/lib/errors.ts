/** Mensaje legible de cualquier error capturado. */
export function errorMessage(err: unknown, fallback = 'Error inesperado.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** true si el error viene de cancelar una petición (AbortController). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Lee una propiedad (status, code, phase…) de un error desconocido sin usar `any`. */
export function errorProp(err: unknown, key: string): unknown {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>)[key] : undefined;
}

/** Código HTTP que trae el error (status, statusCode o httpStatus), o `fallback`. */
export function errorStatus(err: unknown, fallback = 500): number {
  for (const key of ['httpStatus', 'status', 'statusCode']) {
    const v = errorProp(err, key);
    if (typeof v === 'number' && v >= 100 && v < 600) return v;
  }
  return fallback;
}
