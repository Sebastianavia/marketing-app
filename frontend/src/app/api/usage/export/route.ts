import { NextRequest } from 'next/server';
import { currentMonth, listUsage, usageToCsv } from '@/lib/usage/usage-store';
import { getPersonName } from '@/lib/data/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const month = new URL(req.url).searchParams.get('month') || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return new Response('Mes no válido', { status: 400 });
  }
  const [rows, person] = await Promise.all([listUsage(month), getPersonName()]);
  const safePerson = person.replace(/[^\w-]+/g, '_');
  return new Response(usageToCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="costos_${safePerson}_${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
