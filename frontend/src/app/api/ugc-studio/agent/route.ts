import { NextRequest, NextResponse } from 'next/server';
import { planAgentActions } from '@/services/ugc-studio/orchestrator.service';
import { ndjsonResponse } from '@/services/ugc-studio/ndjson-stream';
import { AgentRequest, sanitizeSettings } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Agente creativo del chat: responde y decide las acciones que la app ejecutará (con confirmación si gastan). */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<AgentRequest>;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Escribe un mensaje.' }, { status: 400 });
  }
  const request: AgentRequest = {
    message: body.message.trim(),
    history: body.history ?? [],
    storyboard: body.storyboard ?? null,
    references: body.references ?? [],
    settings: sanitizeSettings(body.settings),
  };
  return ndjsonResponse(req.signal, async (emit, signal) => ({
    type: 'agent_reply',
    ...(await planAgentActions(request, emit, signal)),
  }));
}
