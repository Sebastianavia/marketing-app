import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { editFile, getEdit } from '@/lib/editor/edit-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
};

/**
 * GET ?f=original|borrador|portada[&descargar=1]: sirve el video de la edición por partes (Range),
 * para poder saltar a cualquier frase sin cargar el archivo entero.
 * Solo archivos registrados en la edición, nunca una ruta libre.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const which = req.nextUrl.searchParams.get('f');
    const p = await getEdit(id);
    const name =
      which === 'borrador'
        ? p.borrador?.archivo
        : which === 'portada'
          ? p.borrador?.portada
          : which === 'original'
            ? p.original.archivo
            : undefined;
    if (!name) return new NextResponse('Archivo no disponible', { status: 404 });
    const file = editFile(p, name);
    if (!fs.existsSync(file)) return new NextResponse('El archivo ya no está en la carpeta de la edición', { status: 404 });

    const size = fs.statSync(file).size;
    const headers: Record<string, string> = {
      'Content-Type': TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (req.nextUrl.searchParams.get('descargar') === '1') {
      const safe = p.titulo.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'reel';
      const fname = which === 'portada' ? `${safe}-portada.jpg` : `${safe}.mp4`;
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`;
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
      return new NextResponse(stream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  } catch (err) {
    return new NextResponse(errorMessage(err, 'No se pudo leer el video.'), { status: 404 });
  }
}
