import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listJobs, saveJob, type RenderJob } from '@/lib/jobs/job-store';
import { wakeRunner } from '@/lib/jobs/runner';
import { getPersonName, getSettings } from '@/lib/data/settings';
import { assertWithinDailyLimit, DailyLimitError } from '@/lib/usage/usage-store';
import { videoRate } from '@/config/cost-rates';
import { localMediaUrl } from '@/lib/storage/generated-library';
import { errorMessage } from '@/lib/errors';

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
});

/** Crea un trabajo de render y responde al instante; el runner lo procesa en segundo plano. */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return NextResponse.json(
        { error: 'Falta OPENROUTER_API_KEY en .env.local: no se puede generar video.' },
        { status: 400 },
      );
    }

    const body = CreateJob.parse(await req.json());
    const estimatedCostUSD = (body.estimatedSeconds ?? 15) * videoRate(body.model);

    const settings = await getSettings();
    await assertWithinDailyLimit(estimatedCostUSD, settings.dailyLimitUSD);

    const now = new Date().toISOString();
    const job: RenderJob = {
      id: crypto.randomUUID(),
      tool: body.tool,
      title: body.title,
      provider: body.provider,
      model: body.model,
      input: { imageUrl: body.imageUrl, audioUrl: body.audioUrl, aspectRatio: body.aspectRatio },
      status: 'queued',
      phase: 'En cola',
      attempts: 0,
      person: await getPersonName(),
      estimatedCostUSD,
      createdAt: now,
      updatedAt: now,
    };
    await saveJob(job);
    wakeRunner();

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err: unknown) {
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
