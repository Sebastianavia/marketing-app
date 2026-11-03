import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { deleteProfile, getProfile, updateProfile } from '@/lib/editor/profile-store';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ perfil: await getProfile(id) });
  } catch (err) {
    return editorError(err, 'No se pudo leer el perfil.');
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    return NextResponse.json({ perfil: await updateProfile(id, body) });
  } catch (err) {
    return editorError(err, 'No se pudo guardar el perfil.');
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    await deleteProfile(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return editorError(err, 'No se pudo borrar el perfil.');
  }
}
