import { NextRequest, NextResponse } from 'next/server';
import { geminiRouter } from '@/lib/ai/gemini/gemini-router';
import { getFreeTierModels } from '@/lib/ai/gemini/gemini-models';
import { getGeminiKeyPool } from '@/lib/ai/gemini-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de cuota de cada slot (llave × modelo). `?rediscover=1` vuelve a sondear los modelos. */
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('rediscover') === '1') {
      await getFreeTierModels(getGeminiKeyPool()[0], true);
    }
    const slots = await geminiRouter.report();
    return NextResponse.json({ slots });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error leyendo cuota de Gemini' }, { status: 500 });
  }
}
