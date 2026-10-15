import { NextRequest, NextResponse } from 'next/server';
import { getSceneRenderStatus } from '@/services/ugc-studio/scene-render.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getSceneRenderStatus(id));
  } catch (error: any) {
    // Error transitorio (red, subida): la UI sigue consultando
    return NextResponse.json({ status: 'processing', warning: error.message }, { status: 200 });
  }
}
