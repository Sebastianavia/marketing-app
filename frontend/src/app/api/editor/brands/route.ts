import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { getSettings } from '@/lib/data/settings';
import { profileFromStandard } from '@/lib/editor/profile-from-standard';
import { ProfileError, createProfile } from '@/lib/editor/profile-store';
import { BrandError, BrandInputSchema, LOGO_EXT, ensureLogo, findBrand, loadBrands, saveBrand, setBrandState } from '@/lib/editor/kit/brands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof BrandError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ProfileError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Las marcas (GET) o el logo de una (GET ?logo=<id>). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const id = req.nextUrl.searchParams.get('logo');
    if (!id) return NextResponse.json(await loadBrands());
    const b = await findBrand(id);
    const file = await ensureLogo(b);
    if (!file) return NextResponse.json({ error: 'Sin logo.' }, { status: 404 });
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': LOGO_EXT[b.logoExt ?? ''] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=300' } });
  } catch (err) {
    return fail(err, 'No se pudieron leer las marcas.');
  }
}

/** Crear o editar: multipart con `datos` (JSON), `id` opcional y `logo` opcional. */
export async function POST(req: NextRequest) {
  let tmp = '';
  try {
    assertAppUiRequest(req);
    const form = await req.formData();
    const datos = BrandInputSchema.parse(JSON.parse(String(form.get('datos') ?? '{}')));
    const id = form.get('id') ? String(form.get('id')) : undefined;
    const logo = form.get('logo');
    let logoFile: { tmp: string; name: string } | undefined;
    if (logo instanceof File && logo.size) {
      if (logo.size > 8 * 1024 * 1024) throw new BrandError('El logo pesa más de 8 MB.');
      const ext = path.extname(logo.name).toLowerCase();
      if (!LOGO_EXT[ext]) throw new BrandError(`Formato de logo no admitido (${Object.keys(LOGO_EXT).join(', ')}).`);
      tmp = path.join(os.tmpdir(), `lulo-logo-${randomUUID()}${ext}`);
      await fs.writeFile(tmp, Buffer.from(await logo.arrayBuffer()));
      logoFile = { tmp, name: logo.name };
    }
    const quien = ((await getSettings().catch(() => null)) as { personName?: string } | null)?.personName?.trim() || 'Equipo';
    await saveBrand(datos, quien, id, logoFile);
    return NextResponse.json(await loadBrands());
  } catch (err) {
    return fail(err, 'No se pudo guardar la marca.');
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

const Body = z.object({ accion: z.enum(['retirar', 'reactivar', 'crear_estilo']), id: z.string().max(20) });

export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BrandError('Datos no válidos.');
    if (parsed.data.accion === 'crear_estilo') {
      // La IA convierte el estándar de la marca en un estilo y queda como estilo por defecto de la marca
      const b = await findBrand(parsed.data.id);
      const { perfil, explicacion } = await profileFromStandard(b);
      const creado = await createProfile(perfil);
      const quien = ((await getSettings().catch(() => null)) as { personName?: string } | null)?.personName?.trim() || 'Equipo';
      const { id: _id, logoExt: _l, actualizada: _a, quien: _q, estado: _e, ...input } = b;
      void _id; void _l; void _a; void _q; void _e;
      await saveBrand({ ...input, perfilId: creado.id }, quien, b.id);
      return NextResponse.json({ ...(await loadBrands()), estilo: { id: creado.id, nombre: creado.nombre }, explicacion });
    }
    await setBrandState(parsed.data.id, parsed.data.accion === 'retirar' ? 'retirada' : 'activa');
    return NextResponse.json(await loadBrands());
  } catch (err) {
    return fail(err, 'No se pudo cambiar la marca.');
  }
}
