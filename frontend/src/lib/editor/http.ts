import { NextResponse } from 'next/server';
import { ForbiddenError } from '@/lib/director/local-guard';
import { FreeQuotaError } from '@/lib/ai/orchestrator';
import { errorMessage } from '@/lib/errors';
import { EditError } from './edit-store';
import { ProfileError } from './profile-store';

/** Respuesta JSON de error uniforme para las rutas de Edición. */
export function editorError(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof FreeQuotaError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  if (err instanceof EditError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ProfileError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error('[edicion]', err);
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}
