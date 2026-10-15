import { NextResponse } from 'next/server';
import { getLivePricing, ratePerSecond } from '@/services/ugc-studio/scene-render.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tarifas actuales de heygen-video-1 en OpenRouter (con el descuento vigente aplicado). */
export async function GET() {
  const pricing = await getLivePricing();
  return NextResponse.json({
    discount: pricing.discount,
    live: pricing.live,
    rates: {
      '480p': { base: ratePerSecond(pricing, '480p', false), references: ratePerSecond(pricing, '480p', true) },
      '768p': { base: ratePerSecond(pricing, '768p', false), references: ratePerSecond(pricing, '768p', true) },
    },
  });
}
