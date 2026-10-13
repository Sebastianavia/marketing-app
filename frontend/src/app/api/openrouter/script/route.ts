import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { openRouterService } from '@/services/openrouter.service';
import { GenerateScriptRequestPayload } from '@/types/openrouter.types';
import { recordUsage } from '@/lib/usage/usage-store';
import { scriptCost } from '@/config/cost-rates';

export async function POST(req: NextRequest) {
  try {
    const body: GenerateScriptRequestPayload = await req.json();

    if (!body.productName || !body.keyBenefit) {
      return NextResponse.json(
        { error: 'productName y keyBenefit son obligatorios para generar el guion.' },
        { status: 400 }
      );
    }

    const script = await openRouterService.generateMarketingScript(body);
    await recordUsage({
      tool: 'ugc-generator',
      kind: 'script',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      description: `Guion UGC · ${body.productName}`,
      units: 1,
      unit: 'guion',
      costUSD: scriptCost('anthropic/claude-3.5-sonnet'),
      estimated: true,
    });
    return NextResponse.json(script);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al generar guion en OpenRouter.' },
      { status: 500 }
    );
  }
}
