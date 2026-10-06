import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'Lulo Studio - Pricing Sync',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      next: { revalidate: 3600 }, // Cache 1 hora
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Error de OpenRouter al consultar modelos (${res.status}): ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawModels: any[] = data.data || [];

    // Mapear precios por modelo
    // OpenRouter devuelve pricing en pricing: { prompt, completion, image, request }
    const modelPrices: Record<
      string,
      {
        id: string;
        name: string;
        costPerSecondUSD: number;
        pricingRaw: any;
      }
    > = {};

    for (const m of rawModels) {
      if (!m || !m.id) continue;
      const pricing = m.pricing || {};

      // Si tiene costo por request o imagen o completion
      // Para modelos de video, OpenRouter puede indicar pricing.request o tarifación por unidad
      let derivedCostPerSecond = 0;

      if (pricing.request && parseFloat(pricing.request) > 0) {
        // Si el precio por request equivale a un clip típico de 5s, o si viene por segundo
        const reqPrice = parseFloat(pricing.request);
        derivedCostPerSecond = reqPrice >= 0.01 && reqPrice <= 0.2 ? reqPrice : Number((reqPrice / 5).toFixed(5));
      } else if (pricing.image && parseFloat(pricing.image) > 0) {
        derivedCostPerSecond = parseFloat(pricing.image);
      } else if (pricing.prompt && parseFloat(pricing.prompt) > 0) {
        derivedCostPerSecond = parseFloat(pricing.prompt) * 1000;
      }

      modelPrices[m.id] = {
        id: m.id,
        name: m.name || m.id,
        costPerSecondUSD: derivedCostPerSecond,
        pricingRaw: pricing,
      };
    }

    return NextResponse.json({
      success: true,
      totalModels: rawModels.length,
      modelPrices,
    });
  } catch (error: any) {
    console.error('[OpenRouter Pricing API Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error al obtener precios de OpenRouter' },
      { status: 500 }
    );
  }
}
