import { NextRequest, NextResponse } from 'next/server';
import { addAvatarPhoto, AvatarError, removeAvatarPhoto } from '@/lib/avatars/avatar-store';
import { toAvatarDto } from '@/lib/avatars/avatar-dto';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

function fail(err: unknown, fallback: string) {
  const status = err instanceof AvatarError ? err.status : 500;
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status });
}

/** Sube una foto (multipart, campo "file"). La app sube una por una para mostrar el avance. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AvatarError('No llegó ninguna foto.');
    const avatar = await addAvatarPhoto(id, file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ avatar: await toAvatarDto(avatar) });
  } catch (err) {
    return fail(err, 'No se pudo guardar la foto.');
  }
}

/** Quita una foto (?file=...). Se mueve a la papelera de avatares. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const file = new URL(req.url).searchParams.get('file') ?? '';
    return NextResponse.json({ avatar: await toAvatarDto(await removeAvatarPhoto(id, file)) });
  } catch (err) {
    return fail(err, 'No se pudo quitar la foto.');
  }
}
