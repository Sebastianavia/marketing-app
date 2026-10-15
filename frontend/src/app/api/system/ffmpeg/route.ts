import { NextResponse } from 'next/server';
import { ffmpegVersion, resolveFfmpegPath } from '@/lib/video/ffmpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ¿Está FFmpeg disponible para montar videos? */
export async function GET() {
  const version = await ffmpegVersion();
  return NextResponse.json({ available: Boolean(version), version, path: version ? resolveFfmpegPath() : null });
}
