import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetPath = searchParams.get('path');

    if (!targetPath) {
      return new NextResponse('Parámetro "path" requerido', { status: 400 });
    }

    const normalizedPath = path.normalize(targetPath);

    if (!fs.existsSync(normalizedPath)) {
      return new NextResponse('Archivo no encontrado en disco', { status: 404 });
    }

    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile()) {
      return new NextResponse('La ruta no es un archivo válido', { status: 400 });
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = ALLOWED_EXTENSIONS[ext];

    if (!contentType) {
      return new NextResponse('Tipo de archivo no permitido para visualización directa', { status: 403 });
    }

    const fileBuffer = fs.readFileSync(normalizedPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('Error al transmitir archivo multimedia local:', err);
    return new NextResponse(err.message || 'Error de lectura de archivo', { status: 500 });
  }
}
