import { NextRequest, NextResponse } from 'next/server';
import { listUsage, listUsageMonths } from '@/lib/usage/usage-store';
import { getPersonName, getSettings } from '@/lib/data/settings';
import { getDataDir } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const month = new URL(req.url).searchParams.get('month') || undefined;
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Mes no válido (usa AAAA-MM).' }, { status: 400 });
    }
    const [rows, months, person, settings] = await Promise.all([
      listUsage(month),
      listUsageMonths(),
      getPersonName(),
      getSettings(),
    ]);
    return NextResponse.json({
      rows,
      months,
      person,
      dailyLimitUSD: settings.dailyLimitUSD ?? 0,
      dataDir: getDataDir(),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudo leer el registro de costos.') }, { status: 500 });
  }
}
