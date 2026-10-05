import { NextRequest, NextResponse } from 'next/server';
import { getStorageBasePath, setStorageBasePath } from '@/lib/storage/project-storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const basePath = await getStorageBasePath();
    return NextResponse.json({ basePath });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al obtener ruta' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { basePath } = await req.json();
    if (!basePath || typeof basePath !== 'string') {
      return NextResponse.json({ error: 'Ruta no válida' }, { status: 400 });
    }

    const updated = await setStorageBasePath(basePath);
    return NextResponse.json({ success: true, basePath: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al actualizar ruta' }, { status: 500 });
  }
}
