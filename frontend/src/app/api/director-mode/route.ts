import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { ProductionError } from '@/lib/director/production-store';
import { createDirectorDraft, listDirectorDrafts } from '@/lib/director-mode/engine';
import { InputBody } from '@/lib/director-mode/schemas';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Borradores del modo Director de Guion a video. */
export async function GET() {
  try {
    return NextResponse.json({ borradores: await listDirectorDrafts() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron leer los borradores.') }, { status: 500 });
  }
}

/** Crea un borrador con la etapa Idea ya guardada. Solo desde la ventana de la app. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const entrada = InputBody.parse(await req.json());
    const production = await createDirectorDraft(entrada);
    return NextResponse.json({ production });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    const status = err instanceof ProductionError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo crear el borrador.') }, { status });
  }
}
