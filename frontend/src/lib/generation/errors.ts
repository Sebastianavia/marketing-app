/**
 * Error de generación con el código HTTP que debe devolver la ruta.
 * Lo usan las funciones de lib/generation y lib/jobs, que comparten las rutas de la app y el Director.
 */
export class GenerationError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export function assertOpenRouterKey(message = 'Falta OPENROUTER_API_KEY en .env.local.'): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new GenerationError(message, 400);
  return key;
}
