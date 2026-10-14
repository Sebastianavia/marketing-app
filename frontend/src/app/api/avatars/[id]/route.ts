import { NextRequest, NextResponse } from 'next/server';
import { AvatarError, deleteAvatar, getAvatar, updateAvatar } from '@/lib/avatars/avatar-store';
import { toAvatarDto } from '@/lib/avatars/avatar-dto';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

function fail(err: unknown, fallback: string) {
  const status = err instanceof AvatarError ? err.status : 500;
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ avatar: await toAvatarDto(await getAvatar(id)) });
  } catch (err) {
    return fail(err, 'No se pudo leer el avatar.');
  }
}

/** Cambia nombre, descripción o foto de portada: { name?, description?, cover? }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const patch: { name?: string; description?: string; cover?: string } = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.description === 'string') patch.description = body.description;
    if (typeof body.cover === 'string') patch.cover = body.cover;
    return NextResponse.json({ avatar: await toAvatarDto(await updateAvatar(id, patch)) });
  } catch (err) {
    return fail(err, 'No se pudo guardar el avatar.');
  }
}

/** Mueve el avatar completo a Avatares\_papelera (no se borra del disco). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteAvatar(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err, 'No se pudo eliminar el avatar.');
  }
}
