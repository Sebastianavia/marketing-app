import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { errorMessage } from '@/lib/errors';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { isInside } from '@/lib/fs/inside';
import { kindOf, MaterialError, validateMaterialFolder } from '@/lib/material/material';

export const runtime = 'nodejs';

const FOLDER = 'lulo-studio/ugc-studio/references';

/** Imagen de la carpeta de material ({ carpeta, archivo }): solo desde la ventana de la app. */
async function fromFolder(req: NextRequest) {
  assertAppUiRequest(req);
  const body = (await req.json().catch(() => null)) as { carpeta?: unknown; archivo?: unknown } | null;
  if (typeof body?.carpeta !== 'string' || typeof body.archivo !== 'string') throw new MaterialError('Elige una imagen.');
  const dir = await validateMaterialFolder(body.carpeta);
  const abs = await fs.realpath(path.resolve(dir, body.archivo)).catch(() => '');
  if (!abs || !isInside(dir, abs) || abs === dir || kindOf(abs) !== 'imagen' || /\.(svg|heic|tiff?)$/i.test(abs)) throw new MaterialError('Elige una imagen JPG, PNG o WebP de la carpeta.');
  const st = await fs.stat(abs);
  if (st.size > 10 * 1048576) throw new MaterialError('La imagen pesa más de 10 MB (límite de Cloudinary).');
  return cloudinaryStorageService.uploadImage(await fs.readFile(abs), path.basename(abs), FOLDER);
}

/** Sube una imagen de referencia a Cloudinary: OpenRouter necesita una URL pública https. */
export async function POST(req: NextRequest) {
  try {
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      return NextResponse.json({ url: (await fromFolder(req)).publicUrl });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Adjunta una imagen válida.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await cloudinaryStorageService.uploadImage(buffer, file.name, FOLDER);
    return NextResponse.json({ url: result.publicUrl });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof MaterialError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: errorMessage(error, 'No se pudo subir la referencia.') }, { status: 500 });
  }
}
