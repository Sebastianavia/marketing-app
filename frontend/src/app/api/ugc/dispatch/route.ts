import { NextRequest, NextResponse } from 'next/server';
import { ugcDispatcherService } from '@/services/pipeline/ugc-dispatcher.service';
import { errorMessage, errorProp } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await ugcDispatcherService.dispatch(body);
    return NextResponse.json(result);
  } catch (error) {
    const phase = errorProp(error, 'phase');
    const status = phase ? 422 : 500;
    return NextResponse.json(
      {
        error: errorMessage(error, 'Error al despachar generación UGC multi-proveedor'),
        phase,
      },
      { status }
    );
  }
}
