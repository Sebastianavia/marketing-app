import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getStudioProject } from '@/lib/studio/store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

/** GET ?m=<mediaId>[&descargar=1]: solo medios registrados en el proyecto (con Range para los videos). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const p = await getStudioProject(id);
    const media = p.medios.find((m) => m.id === req.nextUrl.searchParams.get('m'));
    if (!media) return new NextResponse('Archivo no disponible', { status: 404 });
    const file = media.ruta;
    if (!fs.existsSync(file)) return new NextResponse('El archivo ya no está en el disco', { status: 404 });

    const size = fs.statSync(file).size;
    const headers: Record<string, string> = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (req.nextUrl.searchParams.get('descargar') === '1') {
      const fname = path.basename(file);
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
    return new NextResponse(errorMessage(err, 'No se pudo leer el archivo.'), { status: 404 });
  }
}
