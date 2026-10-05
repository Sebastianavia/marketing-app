import { NextRequest, NextResponse } from 'next/server';
import { heygenService, HeyGenApiError } from '@/services/heygen.service';
import { HeyGenGenerateVideoPayload } from '@/types/heygen.types';

export async function POST(req: NextRequest) {
  try {
    const payload: HeyGenGenerateVideoPayload = await req.json();

    if (!payload.video_inputs || payload.video_inputs.length === 0) {
      return NextResponse.json(
        { error: 'El campo video_inputs es obligatorio y debe contener al menos un clip.' },
        { status: 400 }
      );
    }

    const data = await heygenService.generateAvatarVideo(payload);
    return NextResponse.json(data);
  } catch (error) {
    const err = error as HeyGenApiError;
    return NextResponse.json(
      { error: err.message, details: err.details },
      { status: err.statusCode || 500 }
    );
  }
}
