import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { createStudioProject, listStudioProjects } from '@/lib/studio/store';
import { studioError } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proyectos del Estudio Claude (más recientes primero). */
export async function GET() {
  try {
    const list = await listStudioProjects();
    return NextResponse.json({
      proyectos: list.map((p) => ({ id: p.id, titulo: p.titulo, actualizado: p.actualizado, mensajes: p.chat?.mensajes.length ?? 0, gastoUSD: p.gastoUSD })),
    });
  } catch (err) {
    return studioError(err, 'No se pudieron leer los proyectos.');
  }
}

/** Proyecto nuevo { titulo }. Solo desde la ventana de la app. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const body = (await req.json().catch(() => ({}))) as { titulo?: string };
    return NextResponse.json({ proyecto: await createStudioProject(String(body.titulo ?? '')) });
  } catch (err) {
    return studioError(err, 'No se pudo crear el proyecto.');
  }
}
