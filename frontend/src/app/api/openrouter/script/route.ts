import { NextRequest, NextResponse } from 'next/server';
import { GenerateScriptRequestPayload } from '@/types/openrouter.types';
import { buildMarketingScriptPrompt, marketingScriptSchema } from '@/services/openrouter.service';
import { orchestrateObject, orchestratorErrorResponse } from '@/lib/ai/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Guion UGC estructurado. Lo genera el orquestador elegido en Ajustes
 * (Gemini gratis o Claude). Se mantiene la ruta por compatibilidad.
 */
export async function POST(req: NextRequest) {
  try {
    const body: GenerateScriptRequestPayload & { orchestrator?: unknown } = await req.json();

    if (!body.productName || !body.keyBenefit) {
      return NextResponse.json(
        { error: 'productName y keyBenefit son obligatorios para generar el guion.' },
        { status: 400 }
      );
    }

    const { object } = await orchestrateObject({
      tool: 'ugc-generator',
      description: `Guion UGC · ${body.productName}`,
      prompt: buildMarketingScriptPrompt(body),
      schema: marketingScriptSchema,
      mode: body.orchestrator,
    });
    return NextResponse.json(object);
  } catch (error) {
    return orchestratorErrorResponse(error);
  }
}
