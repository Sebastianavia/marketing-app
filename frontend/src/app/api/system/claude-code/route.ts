import { NextRequest, NextResponse } from 'next/server';
import { getClaudeCodeStatus } from '@/lib/ai/claude-code/bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ¿Está Claude Code instalado y con sesión? Cupo de la suscripción visto en la última respuesta. */
export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('refresh') === '1';
  return NextResponse.json(await getClaudeCodeStatus(force));
}
