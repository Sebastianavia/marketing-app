import { NextRequest, NextResponse } from 'next/server';
import { openRouterService } from '@/services/openrouter.service';
import { GenerateScriptRequestPayload } from '@/types/openrouter.types';

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
    return NextResponse.json(script);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al generar guion en OpenRouter.' },
      { status: 500 }
    );
  }
}
