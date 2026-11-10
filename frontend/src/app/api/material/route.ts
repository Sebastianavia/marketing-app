import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { getMaterialFolder, listMaterial, MATERIAL_KEY, MaterialError, setMaterialFolder, summarize, validateMaterialFolder } from '@/lib/material/material';
import { materialError } from '@/lib/material/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function describe(carpeta: string | null) {
  if (!carpeta) return { carpeta: null };
  const ok = await validateMaterialFolder(carpeta).then(
    () => null,
    (err: unknown) => (err instanceof Error ? err.message : 'No disponible.')
  );
  if (ok) return { carpeta, problema: ok };
  const { archivos, truncado } = await listMaterial(carpeta);
  return { carpeta, total: archivos.length, truncado, tipos: summarize(archivos), muestra: archivos.slice(0, 40).map((a) => a.ruta) };
}

/** Carpeta de material de un proyecto (`?clave=edit:<id>`) con un resumen de lo que hay. */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const clave = req.nextUrl.searchParams.get('clave') ?? '';
    if (!MATERIAL_KEY.test(clave)) throw new MaterialError('Proyecto no válido.');
    return NextResponse.json(await describe(await getMaterialFolder(clave)));
  } catch (err) {
    return materialError(err, 'No se pudo leer la carpeta de material.');
  }
}

const Body = z.object({ clave: z.string().regex(MATERIAL_KEY), carpeta: z.string().max(1000).nullable() });

/** Elige (o quita, con carpeta: null) la carpeta de material. Solo desde la ventana de la app. */
export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new MaterialError('Datos no válidos.');
    const real = await setMaterialFolder(parsed.data.clave, parsed.data.carpeta);
    return NextResponse.json(await describe(real));
  } catch (err) {
    return materialError(err, 'No se pudo guardar la carpeta.');
  }
}
