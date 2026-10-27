import { NextRequest, NextResponse } from 'next/server';
import { currentMonth, listUsage, listUsageMonths, spentToday } from '@/lib/usage/usage-store';
import { groupUsageRows } from '@/lib/usage/usage-insights';
import { prevMonthOf } from '@/lib/usage/usage-stats';
import { getPersonName, getSettings } from '@/lib/data/settings';
import { getDataDir } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registro de costos del mes (y del mes anterior, para comparar). Solo lectura.
 * `groups` une cada registro con su producción, proyecto de Guion a video o video suelto.
 */
export async function GET(req: NextRequest) {
  try {
    const month = new URL(req.url).searchParams.get('month') || currentMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Mes no válido (usa AAAA-MM).' }, { status: 400 });
    }
    const prevMonth = prevMonthOf(month);
    const [rawRows, rawPrev, months, person, settings, todayUSD] = await Promise.all([
      listUsage(month),
      listUsage(prevMonth),
      listUsageMonths(),
      getPersonName(),
      getSettings(),
      spentToday(),
    ]);
    const {
      lists: [rows, prevRows],
      groups,
    } = await groupUsageRows(rawRows, rawPrev);
    return NextResponse.json({
      month,
      rows,
      prevMonth,
      prevRows,
      groups,
      months,
      person,
      todayUSD,
      dailyLimitUSD: settings.dailyLimitUSD ?? 0,
      dataDir: getDataDir(),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudo leer el registro de costos.') }, { status: 500 });
  }
}
