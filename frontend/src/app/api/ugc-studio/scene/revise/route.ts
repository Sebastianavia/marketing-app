import { NextRequest, NextResponse } from 'next/server';
import { reviseScene } from '@/services/ugc-studio/orchestrator.service';
import { ndjsonResponse } from '@/services/ugc-studio/ndjson-stream';
import { sanitizeSettings, SceneRevisionRequest } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SceneRevisionRequest;
  if (!body.storyboard || !body.sceneId || !body.feedback?.trim()) {
    return NextResponse.json({ error: 'Faltan storyboard, escena o feedback.' }, { status: 400 });
  }

  return ndjsonResponse(req.signal, async (emit, signal) => ({
    type: 'storyboard',
    storyboard: await reviseScene({ ...body, references: body.references ?? [], settings: sanitizeSettings(body.settings) }, emit, signal),
  }));
}
