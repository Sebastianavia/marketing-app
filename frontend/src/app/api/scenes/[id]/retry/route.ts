import { NextResponse } from 'next/server';
import { retryProject } from '@/lib/scenes/scene-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vuelve a intentar solo las partes que fallaron (no repite lo que ya se pagó). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const p = await retryProject(id);
    if (!p) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, status: p.status });
  } catch {
    return NextResponse.json({ error: 'Proyecto no válido.' }, { status: 400 });
  }
}
