import { NextRequest, NextResponse } from 'next/server';
import { checkJoints } from '@/services/ugc-studio/orchestrator.service';
import { ndjsonResponse } from '@/services/ugc-studio/ndjson-stream';
import { JointCheckRequest } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Revisa si las escenas indicadas empalman con la que ahora las precede. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as JointCheckRequest;
  if (!body.storyboard || !Array.isArray(body.sceneIds) || body.sceneIds.length === 0) {
    return NextResponse.json({ error: 'Faltan storyboard o escenas a revisar.' }, { status: 400 });
  }
  return ndjsonResponse(req.signal, async (emit, signal) => ({
    type: 'joints',
    joints: await checkJoints({ ...body, references: body.references ?? [] }, emit, signal),
  }));
}
