import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { createProfile, listProfiles } from '@/lib/editor/profile-store';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Biblioteca de perfiles de edición. */
export async function GET() {
  try {
    return NextResponse.json({ perfiles: await listProfiles() });
  } catch (err) {
    return editorError(err, 'No se pudieron leer los perfiles.');
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const body = await req.json().catch(() => null);
    return NextResponse.json({ perfil: await createProfile(body) });
  } catch (err) {
    return editorError(err, 'No se pudo crear el perfil.');
  }
}
