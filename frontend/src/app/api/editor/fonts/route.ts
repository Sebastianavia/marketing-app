import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { assertAppUiRead } from '@/lib/material/guard';
import { errorMessage } from '@/lib/errors';
import { FontError, installGoogleFont, listFonts } from '@/lib/editor/fonts';
import { fontsDir } from '@/lib/editor/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof FontError) return NextResponse.json({ error: err.message }, { status: 400 });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}

/** Fuentes propias instaladas (GET) o el archivo de una para la vista previa (GET ?archivo=). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const archivo = req.nextUrl.searchParams.get('archivo');
    if (!archivo) return NextResponse.json({ fuentes: await listFonts() });
    const name = path.basename(archivo);
    if (!/\.(ttf|otf)$/i.test(name)) return NextResponse.json({ error: 'Archivo no válido.' }, { status: 400 });
    const buf = await fs.readFile(path.join(/*turbopackIgnore: true*/ await fontsDir(), name));
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': name.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf', 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    return fail(err, 'No se pudieron leer las fuentes.');
  }
}

const Body = z.object({ familia: z.string().trim().min(2).max(40), pesos: z.array(z.number().int().min(100).max(900)).min(1).max(6).default([400]) });

/** Descarga una fuente de Google Fonts (licencia OFL) a la carpeta de fuentes. Solo desde la app. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new FontError('Indica la familia (p. ej. «Sora») y los pesos.');
    const instaladas = await installGoogleFont(parsed.data.familia, parsed.data.pesos);
    return NextResponse.json({ instaladas, fuentes: await listFonts() });
  } catch (err) {
    return fail(err, 'No se pudo descargar la fuente.');
  }
}
