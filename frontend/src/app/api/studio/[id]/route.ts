import { NextRequest, NextResponse } from 'next/server';
import { getStudioProject } from '@/lib/studio/store';
import { studioError } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const p = await getStudioProject(id);
    // Las rutas absolutas de los medios no salen al navegador: se sirven por /media?m=<id>
    return NextResponse.json({ proyecto: { ...p, medios: p.medios.map(({ ruta: _r, ...m }) => ({ ...m, nombre: _r.split(/[\\/]/).pop() })) } });
  } catch (err) {
    return studioError(err, 'No se pudo leer el proyecto.');
  }
}
