import { NextResponse } from 'next/server';
import { heygenService, HeyGenApiError } from '@/services/heygen.service';

export async function GET() {
  try {
    const avatars = await heygenService.listAvatars();
    return NextResponse.json({ avatars });
  } catch (error) {
    const err = error as HeyGenApiError;
    return NextResponse.json(
      { error: err.message, details: err.details },
      { status: err.statusCode || 500 }
    );
  }
}
