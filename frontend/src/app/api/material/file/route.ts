import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { assertAppUiRead } from '@/lib/material/guard';
import { isInside } from '@/lib/fs/inside';
import { kindOf, MaterialError, validateMaterialFolder } from '@/lib/material/material';
import { materialError } from '@/lib/material/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp' };

/** Miniatura de una imagen de una carpeta de material (`?carpeta=&f=`). Solo imágenes, máx. 30 MB. */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const dir = await validateMaterialFolder(req.nextUrl.searchParams.get('carpeta') ?? '');
    const f = req.nextUrl.searchParams.get('f') ?? '';
    const abs = await fs.realpath(path.resolve(/*turbopackIgnore: true*/ dir, f)).catch(() => '');
    if (!abs || !isInside(dir, abs) || abs === dir) throw new MaterialError('Archivo no válido.');
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (kindOf(abs) !== 'imagen' || !mime) throw new MaterialError('Solo se pueden ver imágenes.');
    const st = await fs.stat(/*turbopackIgnore: true*/ abs);
    if (!st.isFile() || st.size > 30 * 1048576) throw new MaterialError('Imagen no válida o demasiado grande.');
    return new Response(new Uint8Array(await fs.readFile(/*turbopackIgnore: true*/ abs)), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    return materialError(err, 'No se pudo leer la imagen.');
  }
}
