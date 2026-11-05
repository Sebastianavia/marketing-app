import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { StudioError, getStudioProject } from '@/lib/studio/store';
import { studioError } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALLOWED = /\.(jpe?g|png|webp|mp4|mov|m4v|webm|mp3|wav|m4a|pdf)$/i;

/** Adjuntos del chat (multipart `archivos`) → <carpeta>/adjuntos/. Devuelve sus rutas relativas. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const p = await getStudioProject(id);
    const dir = path.join(/*turbopackIgnore: true*/ p.carpeta, 'adjuntos');
    await fs.mkdir(dir, { recursive: true });
    const form = await req.formData();
    const saved: string[] = [];
    for (const v of form.getAll('archivos')) {
      if (!(v instanceof File)) continue;
      if (!ALLOWED.test(v.name)) throw new StudioError(`Tipo de archivo no admitido: ${v.name}`);
      const base = v.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'archivo';
      let name = base;
      for (let n = 2; await fs.stat(path.join(/*turbopackIgnore: true*/ dir, name)).then(() => true, () => false); n++) name = `${path.parse(base).name}-${n}${path.extname(base)}`;
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), Buffer.from(await v.arrayBuffer()));
      saved.push(`adjuntos/${name}`);
    }
    return NextResponse.json({ archivos: saved });
  } catch (err) {
    return studioError(err, 'No se pudieron guardar los archivos.');
  }
}
