import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { assertAppUiRead } from '@/lib/material/guard';
import { kindOf, MaterialError, validateMaterialFolder, type MaterialKind } from '@/lib/material/material';
import { materialError } from '@/lib/material/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hidden = (n: string) => n.startsWith('.') || n.startsWith('$') || n === 'node_modules' || n === 'System Volume Information';

/** Puntos de partida: discos en Windows; carpeta personal y volúmenes en macOS/Linux. */
function roots(): { nombre: string; ruta: string }[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'
      .split('')
      .map((l) => `${l}:\\`)
      .filter((d) => fsSync.existsSync(/*turbopackIgnore: true*/ d))
      .map((d) => ({ nombre: d, ruta: d }));
    return [{ nombre: 'Carpeta personal', ruta: home }, ...drives];
  }
  const out = [{ nombre: 'Carpeta personal', ruta: home }];
  for (const r of ['Desktop', 'Documents', 'Downloads', 'Movies', 'Pictures']) {
    const p = path.join(/*turbopackIgnore: true*/ home, r);
    if (fsSync.existsSync(/*turbopackIgnore: true*/ p)) out.push({ nombre: r, ruta: p });
  }
  if (process.platform === 'darwin' && fsSync.existsSync('/Volumes')) out.push({ nombre: 'Discos', ruta: '/Volumes' });
  return out;
}

/** Explorador de carpetas para elegir la carpeta de material (solo nombres, nunca contenido). */
export async function GET(req: NextRequest) {
  try {
    assertAppUiRead(req);
    const pedida = req.nextUrl.searchParams.get('ruta')?.trim() || os.homedir();
    if (!path.isAbsolute(pedida)) throw new MaterialError('Ruta no válida.');
    const ruta = path.resolve(/*turbopackIgnore: true*/ pedida);
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(/*turbopackIgnore: true*/ ruta, { withFileTypes: true });
    } catch {
      throw new MaterialError('No se puede abrir esa carpeta.', 404);
    }
    const carpetas = entries
      .filter((e) => e.isDirectory() && !hidden(e.name))
      .map((e) => ({ nombre: e.name, ruta: path.join(/*turbopackIgnore: true*/ ruta, e.name) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, 500);
    const tipos: Partial<Record<MaterialKind, number>> = {};
    let archivos = 0;
    for (const e of entries) {
      if (!e.isFile() || hidden(e.name)) continue;
      archivos++;
      const k = kindOf(e.name);
      tipos[k] = (tipos[k] ?? 0) + 1;
    }
    const problema = await validateMaterialFolder(ruta).then(
      () => null,
      (err: unknown) => (err instanceof Error ? err.message : 'No se puede usar.')
    );
    const padre = path.dirname(ruta);
    return NextResponse.json({
      ruta,
      padre: padre === ruta ? null : padre,
      carpetas,
      archivos,
      tipos,
      // Imágenes de esta carpeta (para el selector de UGC)
      imagenes: entries.filter((e) => e.isFile() && !hidden(e.name) && kindOf(e.name) === 'imagen').map((e) => e.name).slice(0, 200),
      usable: !problema,
      problema,
      raices: roots(),
      separador: path.sep,
    });
  } catch (err) {
    return materialError(err, 'No se pudo leer la carpeta.');
  }
}
