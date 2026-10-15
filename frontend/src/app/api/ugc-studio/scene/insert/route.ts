import { NextRequest, NextResponse } from 'next/server';
import { insertScene } from '@/services/ugc-studio/orchestrator.service';
import { ndjsonResponse } from '@/services/ugc-studio/ndjson-stream';
import { sanitizeSettings, SceneInsertRequest } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Inserta una escena intermedia diseñada por el equipo de agentes. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as SceneInsertRequest;
  if (!body.storyboard || !Number.isFinite(body.afterIndex) || !body.instructions?.trim()) {
    return NextResponse.json({ error: 'Faltan storyboard, posición o lo que debe pasar en la escena.' }, { status: 400 });
  }
  return ndjsonResponse(req.signal, async (emit, signal) => ({
    type: 'storyboard',
    storyboard: await insertScene({ ...body, references: body.references ?? [], settings: sanitizeSettings(body.settings) }, emit, signal),
  }));
}
