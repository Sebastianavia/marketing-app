import { NextRequest, NextResponse } from 'next/server';
import { getPersonName, getSettings, updateSettings } from '@/lib/data/settings';
import { errorMessage } from '@/lib/errors';
import { DEFAULT_ORCHESTRATOR, isOrchestratorMode, type OrchestratorMode } from '@/config/llm-models';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    personName: await getPersonName(),
    dailyLimitUSD: settings.dailyLimitUSD ?? 0,
    orchestrator: settings.orchestrator ?? DEFAULT_ORCHESTRATOR,
  });
}

/**
 * Cambia nombre, límite diario u orquestador. Solo desde la ventana de la app (igual que aprobar gastos):
 * el límite diario y el modo de IA deciden cuánto se puede gastar, así que el Director no debe tocarlos.
 */
export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Los ajustes solo se cambian desde la ventana de Lulo Studio.' }, { status: 403 });
    }
    throw err;
  }
  try {
    const body = await req.json();
    const patch: { personName?: string; dailyLimitUSD?: number; orchestrator?: OrchestratorMode } = {};
    if (typeof body.personName === 'string') {
      const name = body.personName.trim().slice(0, 60);
      if (!name) return NextResponse.json({ error: 'El nombre no puede estar vacío.' }, { status: 400 });
      patch.personName = name;
    }
    if (body.dailyLimitUSD !== undefined) {
      const limit = Number(body.dailyLimitUSD);
      if (!Number.isFinite(limit) || limit < 0) {
        return NextResponse.json({ error: 'El límite diario debe ser un número mayor o igual a 0.' }, { status: 400 });
      }
      patch.dailyLimitUSD = Math.round(limit * 100) / 100;
    }
    if (body.orchestrator !== undefined) {
      if (!isOrchestratorMode(body.orchestrator)) {
        return NextResponse.json({ error: 'Orquestador no válido.' }, { status: 400 });
      }
      patch.orchestrator = body.orchestrator;
    }
    const next = await updateSettings(patch);
    return NextResponse.json({
      personName: next.personName,
      dailyLimitUSD: next.dailyLimitUSD ?? 0,
      orchestrator: next.orchestrator ?? DEFAULT_ORCHESTRATOR,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudo guardar.') }, { status: 500 });
  }
}
