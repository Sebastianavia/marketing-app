import { NextResponse } from 'next/server';
import { getProject } from '@/lib/scenes/scene-store';
import { getJob } from '@/lib/jobs/job-store';
import { localMediaUrl } from '@/lib/storage/generated-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de un proyecto por escenas, con el avance de cada clip. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let p;
  try {
    p = await getProject(id);
  } catch {
    p = null;
  }
  if (!p) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 });

  const scenes = await Promise.all(
    p.scenes.map(async (s, i) => {
      const job = s.clipJobId ? await getJob(s.clipJobId).catch(() => null) : null;
      return {
        number: i + 1,
        type: s.type,
        narration: s.narration,
        start: s.start,
        // El estado real sale del trabajo (por si el proyecto no alcanzó a guardarse)
        status:
          job?.status === 'completed' ? 'done' : job?.status === 'failed' ? 'failed' : job ? 'rendering' : s.status ?? 'pending',
        phase: job?.phase,
        error: s.error ?? job?.error,
        clipUrl: s.clipPath ? localMediaUrl(s.clipPath) : null,
      };
    })
  );

  return NextResponse.json({
    id: p.id,
    title: p.title,
    status: p.status,
    phase: p.phase,
    error: p.error,
    totalSeconds: p.totalSeconds,
    estimatedCostUSD: p.estimatedCostUSD,
    costUSD: p.costUSD,
    outputPath: p.outputPath,
    outputUrl: p.outputPath ? localMediaUrl(p.outputPath) : null,
    scenes,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
  });
}
