import { NextRequest, NextResponse } from 'next/server';
import { getPersonName, getSettings, updateSettings } from '@/lib/data/settings';
import { errorMessage } from '@/lib/errors';
import {
  CLAUDE_DEFAULT_EFFORT,
  CLAUDE_SUBSCRIPTION_MODEL,
  DEFAULT_ORCHESTRATOR,
  isClaudeEffortLevel,
  isClaudeModelTier,
  isOrchestratorMode,
  type ClaudeEffortLevel,
  type ClaudeModelTier,
  type OrchestratorMode,
} from '@/config/llm-models';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    personName: await getPersonName(),
    dailyLimitUSD: settings.dailyLimitUSD ?? 0,
    orchestrator: settings.orchestrator ?? DEFAULT_ORCHESTRATOR,
    claudeModel: settings.claudeModel ?? CLAUDE_SUBSCRIPTION_MODEL,
    claudeEffort: settings.claudeEffort ?? CLAUDE_DEFAULT_EFFORT,
  });
}

/**
 * Cambia nombre, límite diario, orquestador, modelo o esfuerzo de Claude.
 * Solo desde la ventana de la app (igual que aprobar gastos):
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
    const patch: {
      personName?: string;
      dailyLimitUSD?: number;
      orchestrator?: OrchestratorMode;
      claudeModel?: ClaudeModelTier;
      claudeEffort?: ClaudeEffortLevel;
    } = {};
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
    if (body.claudeModel !== undefined) {
      if (!isClaudeModelTier(body.claudeModel)) {
        return NextResponse.json({ error: 'Modelo de Claude no válido (elige opus, sonnet o haiku).' }, { status: 400 });
      }
      patch.claudeModel = body.claudeModel;
    }
    if (body.claudeEffort !== undefined) {
      if (!isClaudeEffortLevel(body.claudeEffort)) {
        return NextResponse.json({ error: 'Nivel de esfuerzo no válido (elige low, medium, high, xhigh o max).' }, { status: 400 });
      }
      patch.claudeEffort = body.claudeEffort;
    }
    const next = await updateSettings(patch);
    return NextResponse.json({
      personName: next.personName,
      dailyLimitUSD: next.dailyLimitUSD ?? 0,
      orchestrator: next.orchestrator ?? DEFAULT_ORCHESTRATOR,
      claudeModel: next.claudeModel ?? CLAUDE_SUBSCRIPTION_MODEL,
      claudeEffort: next.claudeEffort ?? CLAUDE_DEFAULT_EFFORT,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudo guardar.') }, { status: 500 });
  }
}
