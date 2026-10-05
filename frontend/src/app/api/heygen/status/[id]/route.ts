import { NextRequest, NextResponse } from 'next/server';
import { heygenService, HeyGenApiError } from '@/services/heygen.service';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Falta el parámetro id del video.' }, { status: 400 });
    }

    const data = await heygenService.getVideoStatus(id);
    return NextResponse.json(data);
  } catch (error) {
    const err = error as HeyGenApiError;
    return NextResponse.json(
      { error: err.message, details: err.details },
      { status: err.statusCode || 500 }
    );
  }
}
