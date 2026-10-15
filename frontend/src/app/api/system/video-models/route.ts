import { NextRequest, NextResponse } from 'next/server';
import { checkVideoCatalog } from '@/lib/video/video-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de los modelos de video configurados frente al catálogo en vivo de OpenRouter. ?force=1 ignora la caché. */
export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  const r = await checkVideoCatalog(force);
  return NextResponse.json({ ...r, liveIds: undefined });
}
