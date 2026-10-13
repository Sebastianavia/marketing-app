import { NextResponse } from 'next/server';
import { spentToday } from '@/lib/usage/usage-store';
import { getSettings } from '@/lib/data/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Gasto de hoy en este PC, para el indicador de la barra superior. */
export async function GET() {
  const [today, settings] = await Promise.all([spentToday(), getSettings()]);
  return NextResponse.json({ todayUSD: today, dailyLimitUSD: settings.dailyLimitUSD ?? 0 });
}
