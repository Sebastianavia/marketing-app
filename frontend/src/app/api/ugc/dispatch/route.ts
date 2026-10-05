import { NextRequest, NextResponse } from 'next/server';
import { ugcDispatcherService } from '@/services/pipeline/ugc-dispatcher.service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await ugcDispatcherService.dispatch(body);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.phase ? 422 : 500;
    return NextResponse.json(
      {
        error: error.message || 'Error al despachar generación UGC multi-proveedor',
        phase: error.phase,
      },
      { status }
    );
  }
}
