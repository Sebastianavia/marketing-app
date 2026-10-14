import { NextRequest, NextResponse } from 'next/server';
import { AvatarError, createAvatar, listAvatars, MAX_AVATAR_PHOTOS } from '@/lib/avatars/avatar-store';
import { toAvatarDto } from '@/lib/avatars/avatar-dto';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

/** Lista de avatares guardados (para la galería y el selector de Creación de imágenes). */
export async function GET() {
  try {
    const avatars = await Promise.all((await listAvatars()).map(toAvatarDto));
    return NextResponse.json({ avatars, maxPhotos: MAX_AVATAR_PHOTOS });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err, 'No se pudieron leer los avatares.') }, { status: 500 });
  }
}

/** Crea un avatar vacío: { name, description? }. Las fotos se suben después. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const avatar = await createAvatar(String(body.name ?? ''), String(body.description ?? ''));
    return NextResponse.json({ avatar: await toAvatarDto(avatar) });
  } catch (err) {
    const status = err instanceof AvatarError ? err.status : 500;
    return NextResponse.json({ error: errorMessage(err, 'No se pudo crear el avatar.') }, { status });
  }
}
