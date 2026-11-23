import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import {
  getMaterialFolder,
  getTaggedMaterialFolders,
  listMaterial,
  MATERIAL_KEY,
  MaterialError,
  MAX_TAGGED_FOLDERS,
  setMaterialFolder,
  setTaggedMaterialFolders,
  summarize,
  type TaggedMaterialFolder,
  validateMaterialFolder,
} from '@/lib/material/material';
import { materialError } from '@/lib/material/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function describeFolder(carpeta: string) {
  const ok = await validateMaterialFolder(carpeta).then(
    () => null,
    (err: unknown) => (err instanceof Error ? err.message : 'No disponible.')
  );
  if (ok) return { carpeta, problema: ok };
  const { archivos, truncado } = await listMaterial(carpeta);
  return { carpeta, total: archivos.length, truncado, tipos: summarize(archivos), muestra: archivos.slice(0, 40).map((a) => a.ruta) };
}

async function describe(carpeta: string | null, extras: TaggedMaterialFolder[] = []) {
  const base = carpeta ? await describeFolder(carpeta) : { carpeta: null };
  const extrasDesc = await Promise.all(
    extras.map(async (e) => ({
      ...(await describeFolder(e.carpeta)),
      etiqueta: e.etiqueta,
    }))
  );
  return { ...base, extras: extrasDesc };
}

/** Carpeta de material de un proyecto (`?clave=edit:<id>`) con un resumen de lo que hay. */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const clave = req.nextUrl.searchParams.get('clave') ?? '';
    if (!MATERIAL_KEY.test(clave)) throw new MaterialError('Proyecto no válido.');
    const [carpeta, extras] = await Promise.all([getMaterialFolder(clave), getTaggedMaterialFolders(clave)]);
    return NextResponse.json(await describe(carpeta, extras));
  } catch (err) {
    return materialError(err, 'No se pudo leer la carpeta de material.');
  }
}

const TaggedSchema = z.object({
  carpeta: z.string().min(1).max(1000),
  etiqueta: z.string().trim().min(1).max(80),
});

const Body = z.object({
  clave: z.string().regex(MATERIAL_KEY),
  carpeta: z.string().max(1000).nullable().optional(),
  extras: z.array(TaggedSchema).max(MAX_TAGGED_FOLDERS).optional(),
});

/** Elige (o quita, con carpeta: null) la carpeta de material y/o las carpetas adicionales con etiqueta. Solo desde la ventana de la app. */
export async function PUT(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new MaterialError('Datos no válidos.');
    const { clave, carpeta, extras } = parsed.data;
    const real = carpeta !== undefined ? await setMaterialFolder(clave, carpeta) : await getMaterialFolder(clave);
    const savedExtras = extras !== undefined ? await setTaggedMaterialFolders(clave, extras) : await getTaggedMaterialFolders(clave);
    return NextResponse.json(await describe(real, savedExtras));
  } catch (err) {
    return materialError(err, 'No se pudo guardar la carpeta.');
  }
}
