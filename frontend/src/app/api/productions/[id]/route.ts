import { NextResponse } from 'next/server';
import { ProductionError } from '@/lib/director/production-store';
import { reconcileProduction } from '@/lib/director/production-jobs';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await reconcileProduction(id));
  } catch (err) {
    const status = err instanceof ProductionError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo leer la producción.') }, { status });
  }
}
