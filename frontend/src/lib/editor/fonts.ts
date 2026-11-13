import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fontsDir } from './media';

/**
 * Fuentes de Google Fonts (licencia OFL, uso libre) en la carpeta de fuentes de Lulo
 * (`<datos>/fuentes`), para subtítulos (libass) y piezas del kit (HyperFrames con @font-face).
 * Fase 9: los estándares de marca piden fuentes concretas (p. ej. ETM: Sora, Anton, Prata).
 * Se descarga el TTF estático de cada peso (Google lo sirve en TTF a navegadores antiguos).
 */

const TTF_UA = 'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';

export class FontError extends Error {}

/** Nombre de familia (tabla «name», id 1, Windows) de un TTF: el que usan los subtítulos. */
export function ttfFamilyName(buf: Buffer): string | null {
  try {
    const numTables = buf.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (buf.toString('ascii', rec, rec + 4) !== 'name') continue;
      const off = buf.readUInt32BE(rec + 8);
      const count = buf.readUInt16BE(off + 2);
      const strOff = off + buf.readUInt16BE(off + 4);
      let fallback: string | null = null;
      for (let j = 0; j < count; j++) {
        const r = off + 6 + j * 12;
        const platform = buf.readUInt16BE(r);
        const nameId = buf.readUInt16BE(r + 6);
        const len = buf.readUInt16BE(r + 8);
        const o = strOff + buf.readUInt16BE(r + 10);
        if (nameId !== 1) continue;
        if (platform === 3) {
          // UTF-16 BE
          let s = '';
          for (let k = 0; k < len; k += 2) s += String.fromCharCode(buf.readUInt16BE(o + k));
          return s;
        }
        if (platform === 1) fallback = buf.toString('latin1', o, o + len);
      }
      return fallback;
    }
  } catch {
    return null;
  }
  return null;
}

/** Descarga una familia de Google Fonts en los pesos pedidos. Devuelve los archivos y su nombre para subtítulos. */
export async function installGoogleFont(familia: string, pesos: number[] = [400]): Promise<Array<{ archivo: string; peso: number; nombre: string }>> {
  const fam = familia.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} ]{2,40}$/u.test(fam)) throw new FontError('Nombre de familia no válido.');
  const dir = await fontsDir();
  const out: Array<{ archivo: string; peso: number; nombre: string }> = [];
  for (const peso of [...new Set(pesos)]) {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@${peso}`, { headers: { 'User-Agent': TTF_UA }, signal: AbortSignal.timeout(20_000) });
    if (!css.ok) throw new FontError(`Google Fonts no tiene «${fam}» con peso ${peso} (${css.status}).`);
    const url = /url\((https:[^)]+\.ttf)\)/.exec(await css.text())?.[1];
    if (!url) throw new FontError(`No hay TTF de «${fam}» ${peso}.`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new FontError(`No se pudo descargar «${fam}» (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${fam.replace(/\s+/g, '')}-${peso}.ttf`;
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, file), buf);
    out.push({ archivo: file, peso, nombre: ttfFamilyName(buf) ?? fam });
  }
  return out;
}

/** Fuentes propias instaladas con su nombre para subtítulos. */
export async function listFonts(): Promise<Array<{ archivo: string; nombre: string }>> {
  const dir = await fontsDir();
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => /\.(ttf|otf)$/i.test(f));
  const out: Array<{ archivo: string; nombre: string }> = [];
  for (const f of files) {
    const buf = await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, f)).catch(() => null);
    out.push({ archivo: f, nombre: (buf && ttfFamilyName(buf)) || path.parse(f).name });
  }
  return out;
}

/** Archivo de una fuente propia por su nombre de familia (o null). */
export async function findFontFile(nombre: string): Promise<string | null> {
  const n = nombre.toLowerCase().replace(/\s+/g, '');
  const hit = (await listFonts()).find((f) => f.nombre.toLowerCase().replace(/\s+/g, '') === n || path.parse(f.archivo).name.toLowerCase().replace(/[-\s]/g, '').startsWith(n));
  if (!hit) return null;
  const p = path.join(/*turbopackIgnore: true*/ await fontsDir(), hit.archivo);
  return fsSync.existsSync(p) ? p : null;
}
