import { NextRequest, NextResponse } from 'next/server';
import { extractPdfImages } from '@/lib/pdf/pdf-images';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Saca las fotos de dentro de un PDF para usarlas en las escenas. */
export async function POST(req: NextRequest) {
  try {
    const { pdfBase64 } = await req.json();
    if (typeof pdfBase64 !== 'string' || !pdfBase64) {
      return NextResponse.json({ error: 'Falta el PDF.' }, { status: 400 });
    }
    const images = extractPdfImages(Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
    return NextResponse.json({
      images: images.map((img) => ({
        name: img.name,
        width: img.width,
        height: img.height,
        dataUrl: `data:${img.mime};base64,${img.data.toString('base64')}`,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron leer las imágenes del PDF.') }, { status: 400 });
  }
}
