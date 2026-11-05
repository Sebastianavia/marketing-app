import { NextResponse } from 'next/server';
import { ForbiddenError } from '@/lib/director/local-guard';
import { errorMessage } from '@/lib/errors';
import { StudioError } from './store';

/** Respuesta JSON de error uniforme para las rutas del Estudio Claude. */
export function studioError(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof StudioError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error('[estudio]', err);
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}
