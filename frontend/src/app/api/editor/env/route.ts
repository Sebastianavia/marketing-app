import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { envStatus, listInstallJobs, startInstall, updateEnvSettings } from '@/lib/editor/python-env';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Estado de las herramientas avanzadas (Python, PyTorch, Whisper, modelo de recorte) y de las instalaciones. */
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get('detectar') === '1';
    return NextResponse.json({ estado: await envStatus(force), instalaciones: listInstallJobs() });
  } catch (err) {
    return editorError(err, 'No se pudo comprobar las herramientas.');
  }
}

const ActionSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('instalar'), que: z.enum(['python', 'torch', 'whisper', 'opencv', 'modelo-resnet50', 'modelo-mobilenetv3']) }),
  z.object({
    accion: z.literal('ajustes'),
    transcriptor: z.enum(['elevenlabs', 'whisper']).optional(),
    whisperModelo: z.enum(['turbo', 'small', 'base']).optional(),
    recorteModelo: z.enum(['auto', 'resnet50', 'mobilenetv3']).optional(),
  }),
]);

/** Instalar algo (con botón, lo pide la persona) o cambiar ajustes. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    const a = parsed.data;
    if (a.accion === 'instalar') {
      const job = await startInstall(a.que);
      return NextResponse.json({ instalacion: job });
    }
    const { accion: _accion, ...patch } = a;
    void _accion;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return NextResponse.json({ ajustes: await updateEnvSettings(clean) });
  } catch (err) {
    return editorError(err, 'No se pudo completar la acción.');
  }
}
