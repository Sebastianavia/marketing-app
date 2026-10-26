import { NextRequest, NextResponse } from 'next/server';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';

export const runtime = 'nodejs';

/** Sube una imagen de referencia a Cloudinary: OpenRouter necesita una URL pública https. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Adjunta una imagen válida.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await cloudinaryStorageService.uploadImage(buffer, file.name, 'lulo-studio/ugc-studio/references');
    return NextResponse.json({ url: result.publicUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'No se pudo subir la referencia.' }, { status: 500 });
  }
}
