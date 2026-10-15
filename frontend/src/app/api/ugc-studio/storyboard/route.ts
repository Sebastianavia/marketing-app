import { NextRequest, NextResponse } from 'next/server';
import { generateStoryboard } from '@/services/ugc-studio/orchestrator.service';
import { ndjsonResponse } from '@/services/ugc-studio/ndjson-stream';
import { sanitizeSettings, StoryboardRequest } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<StoryboardRequest>;
  if (!body.brief?.trim()) {
    return NextResponse.json({ error: 'Describe el video que quieres crear.' }, { status: 400 });
  }

  const request: StoryboardRequest = {
    brief: body.brief.trim(),
    references: body.references ?? [],
    settings: sanitizeSettings(body.settings),
  };

  return ndjsonResponse(req.signal, async (emit, signal) => ({
    type: 'storyboard',
    storyboard: await generateStoryboard(request, emit, signal),
  }));
}
