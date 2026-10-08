import { NextRequest, NextResponse } from 'next/server';
import { UGC_MODELS_CATALOG } from '@/config/ugc-models.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface VideoModelPricing {
  id: string;
  name: string;
  costPerSecondUSD: number;
  provider: 'openrouter' | 'apimart';
  isLiveRate: boolean;
  pricingRaw?: Record<string, string | number>;
}

interface OpenRouterRawModel {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
}

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
    const rawModels: OpenRouterRawModel[] = data.data || [];

    // Mapeo inicial con los modelos oficiales del catálogo UGC
    const modelPrices: Record<string, VideoModelPricing> = {};

    for (const catalogModel of UGC_MODELS_CATALOG) {
      modelPrices[catalogModel.id] = {
        id: catalogModel.id,
        name: catalogModel.name,
        costPerSecondUSD: catalogModel.costPerSecondUSD,
        provider: catalogModel.provider,
        isLiveRate: false,
      };
    }

    // Indexar modelos recibidos de OpenRouter por ID
    const openRouterModelMap = new Map<string, OpenRouterRawModel>();
    for (const rawModel of rawModels) {
      if (rawModel?.id) {
        openRouterModelMap.set(rawModel.id.toLowerCase(), rawModel);
      }
    }

    // Actualizar tarifas en vivo para los modelos que dispongan de cotización explícita en la API
    for (const catalogModel of UGC_MODELS_CATALOG) {
      if (catalogModel.provider !== 'openrouter') continue;

      const liveModel = openRouterModelMap.get(catalogModel.id.toLowerCase());
      if (liveModel?.pricing) {
        const pricing = liveModel.pricing;
        let liveCostPerSecond = 0;

        if (pricing.request && parseFloat(pricing.request) > 0) {
          const reqPrice = parseFloat(pricing.request);
          // Si el precio por request equivale a un clip típico de 5s o viene tarifado por segundo
          liveCostPerSecond = reqPrice >= 0.01 && reqPrice <= 0.2
            ? reqPrice
            : Number((reqPrice / 5).toFixed(5));
        } else if (pricing.image && parseFloat(pricing.image) > 0) {
          liveCostPerSecond = parseFloat(pricing.image);
        }

        if (liveCostPerSecond > 0) {
          modelPrices[catalogModel.id] = {
            id: catalogModel.id,
            name: catalogModel.name,
            costPerSecondUSD: liveCostPerSecond,
            provider: 'openrouter',
            isLiveRate: true,
            pricingRaw: pricing,
          };
        }
      }
    }

    return NextResponse.json({
      success: true,
      syncedAt: Date.now(),
      totalCatalogModels: UGC_MODELS_CATALOG.length,
      totalOpenRouterModels: rawModels.length,
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
