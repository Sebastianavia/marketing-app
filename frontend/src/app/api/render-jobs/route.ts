import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listJobs } from '@/lib/jobs/job-store';
import { createRenderJob, MISSING_VIDEO_KEY } from '@/lib/jobs/create-job';
import { DailyLimitError } from '@/lib/usage/usage-store';
import { videoRate } from '@/config/cost-rates';
import { localMediaUrl } from '@/lib/storage/generated-library';
import { errorMessage } from '@/lib/errors';
import { GenerationError, assertOpenRouterKey } from '@/lib/generation/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const httpsUrl = z.string().trim().regex(/^https?:\/\//i, 'Debe ser una URL pública (https).');

const CreateJob = z.object({
  tool: z.string().min(1).max(40),
  title: z.string().max(120).default('Video'),
  provider: z.literal('openrouter').default('openrouter'),
  model: z.string().min(1).default('heygen/avatar-iv'),
  imageUrl: httpsUrl,
  audioUrl: httpsUrl,
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
  estimatedSeconds: z.number().positive().max(600).optional(),
  motionPrompt: z.string().max(500).optional(),
  expressiveness: z.enum(['low', 'medium', 'high']).optional(),
});

/** Crea un trabajo de render y responde al instante; el runner lo procesa en segundo plano. */
export async function POST(req: NextRequest) {
  try {
    assertOpenRouterKey(MISSING_VIDEO_KEY);
    const body = CreateJob.parse(await req.json());
    const job = await createRenderJob({
      tool: body.tool,
      title: body.title,
      model: body.model,
      input: {
        imageUrl: body.imageUrl,
        audioUrl: body.audioUrl,
        aspectRatio: body.aspectRatio,
        motionPrompt: body.motionPrompt?.trim() || undefined,
        expressiveness: body.expressiveness,
      },
      estimatedCostUSD: (body.estimatedSeconds ?? 15) * videoRate(body.model),
    });
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err: unknown) {
    if (err instanceof GenerationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof DailyLimitError) {
      return NextResponse.json({ error: err.message, code: 'daily_limit' }, { status: 402 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    }
    return NextResponse.json({ error: errorMessage(err, 'No se pudo crear el trabajo.') }, { status: 500 });
  }
}

/** Lista trabajos. ?tool=avatar-studio&active=1 devuelve solo los que siguen en curso. */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const jobs = await listJobs({
    tool: params.get('tool') || undefined,
    status: params.get('active') ? ['queued', 'processing'] : undefined,
  });
  const limit = Math.min(Number(params.get('limit')) || 50, 200);
  return NextResponse.json(
    jobs.slice(0, limit).map((j) => ({ ...j, videoUrl: j.outputPath ? localMediaUrl(j.outputPath) : null })),
  );
}
