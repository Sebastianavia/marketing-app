import { NextRequest, NextResponse } from 'next/server';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const type = (formData.get('type') as 'image' | 'audio') || 'image';

    if (!file) {
      return NextResponse.json(
        { error: 'No se suministró ningún archivo para subir a Cloudinary.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let result;
    if (type === 'image') {
      result = await cloudinaryStorageService.uploadImage(
        buffer,
        file.name || `portrait_${Date.now()}.jpg`
      );
    } else {
      result = await cloudinaryStorageService.uploadAudio(
        buffer,
        file.name || `audio_${Date.now()}.mp3`
      );
    }

    return NextResponse.json({
      success: true,
      publicUrl: result.publicUrl,
      publicId: result.publicId,
      resourceType: result.resourceType,
      bytes: result.bytes,
    });
  } catch (err: any) {
    console.error('[API Cloudinary Upload Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Error al procesar la subida en Cloudinary.' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const data = await cloudinaryStorageService.getTotalCount();
    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    console.error('[API Cloudinary Count Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Error al consultar almacenamiento de Cloudinary.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    let limit = 100;
    try {
      const url = new URL(req.url);
      const qLimit = url.searchParams.get('limit');
      if (qLimit) {
        limit = parseInt(qLimit, 10) || 100;
      } else {
        const body = await req.json().catch(() => null);
        if (body && typeof body.limit === 'number') {
          limit = body.limit;
        }
      }
    } catch {
      // default limit
    }

    const cleanResult = await cloudinaryStorageService.deleteOldestFiles(limit);
    return NextResponse.json({
      success: true,
      ...cleanResult,
    });
  } catch (err: any) {
    console.error('[API Cloudinary Delete Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Error al ejecutar limpieza en Cloudinary.' },
      { status: 500 }
    );
  }
}
