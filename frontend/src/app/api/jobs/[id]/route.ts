import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs/job-store';
import { localMediaUrl } from '@/lib/storage/generated-library';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404 });
    return NextResponse.json({ ...job, videoUrl: job.outputPath ? localMediaUrl(job.outputPath) : null });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err, 'Error al leer el trabajo.') }, { status: 400 });
  }
}
