import { NextResponse } from 'next/server';
import { getStoredVoices } from '@/lib/storage/voice-storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const voices = await getStoredVoices();
    return NextResponse.json({ voices });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al listar las voces disponibles.' },
      { status: 500 }
    );
  }
}
