/** Mensaje legible de cualquier error capturado. */
export function errorMessage(err: unknown, fallback = 'Error inesperado.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
