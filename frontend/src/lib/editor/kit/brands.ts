import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { feedbackConfigured, getFile, getJsonTagged, putFile, putJsonIfUnchanged } from '@/lib/feedback/r2';

/**
 * Marcas (Fase 3, idea 28): logo, colores, tipografía, lema y usuario de cada marca o cliente, para
 * que Claude haga su intro y su cierre con el kit. COMPARTIDAS en R2 como el manual y la biblioteca
 * de audio: `_lulo/marcas/marcas.json` (If-Match) + logos `_lulo/marcas/<id>.<ext>`; caché local en
 * `<datos>/marcas/`. Sin R2, solo en este PC.
 */

export const LOGO_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
export const KIT_FONTS = ['Archivo Black', 'Montserrat', 'Oswald', 'League Gothic', 'Poppins', 'Inter', 'Outfit', 'Nunito', 'Playfair Display', 'EB Garamond', 'Space Mono', 'Roboto', 'Lato', 'Open Sans'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');

export const BrandInputSchema = z.object({
  nombre: z.string().trim().min(2).max(60),
  colores: z.object({ primario: hex, acento: hex, texto: hex.default('#FFFFFF') }),
  fuente: z.enum(KIT_FONTS).default('Archivo Black'),
  lema: z.string().trim().max(80).optional(),
  /** Usuario en redes, p. ej. «@lulostudio». */
  usuario: z.string().trim().max(40).optional(),
  /** Llamada a la acción del cierre, p. ej. «Síguenos para más». */
  cta: z.string().trim().max(60).optional(),
  nota: z.string().trim().max(300).optional(),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;

export interface Brand extends BrandInput {
  id: string;
  logoExt?: string;
  actualizada: string;
  quien: string;
  estado: 'activa' | 'retirada';
}

interface BrandBook {
  version: number;
  actualizado: string;
  marcas: Brand[];
}

export class BrandError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const KEY = '_lulo/marcas/marcas.json';
const logoKey = (b: Pick<Brand, 'id' | 'logoExt'>) => `_lulo/marcas/${b.id}${b.logoExt}`;
const dir = () => path.join(/*turbopackIgnore: true*/ getDataDir(), 'marcas');
const localFile = () => path.join(dir(), 'marcas.json');
export const localLogo = (b: Pick<Brand, 'id' | 'logoExt'>) => path.join(dir(), `${b.id}${b.logoExt}`);
const empty = (): BrandBook => ({ version: 0, actualizado: new Date().toISOString(), marcas: [] });

async function readLocal(): Promise<BrandBook | null> {
  try {
    return JSON.parse(await fs.readFile(localFile(), 'utf8')) as BrandBook;
  } catch {
    return null;
  }
}
async function saveLocal(b: BrandBook) {
  await fs.mkdir(dir(), { recursive: true });
  await writeJsonAtomic(localFile(), b).catch(() => undefined);
}

export async function loadBrands(): Promise<{ marcas: Brand[]; compartidas: boolean; aviso?: string }> {
  if (feedbackConfigured()) {
    try {
      const { data } = await getJsonTagged<BrandBook>(KEY);
      const b = data ?? empty();
      await saveLocal(b);
      return { marcas: b.marcas, compartidas: true };
    } catch (err) {
      return { marcas: ((await readLocal()) ?? empty()).marcas, compartidas: false, aviso: `Sin conexión con las marcas compartidas (${err instanceof Error ? err.message : 'error'}).` };
    }
  }
  return { marcas: ((await readLocal()) ?? empty()).marcas, compartidas: false, aviso: 'Las marcas son solo de este PC: configura la app de feedback (FEEDBACK_R2_*) para compartirlas.' };
}

async function update<T>(fn: (b: BrandBook) => T): Promise<T> {
  const apply = (b: BrandBook) => {
    const copy: BrandBook = JSON.parse(JSON.stringify(b));
    const result = fn(copy);
    copy.version = (b.version ?? 0) + 1;
    copy.actualizado = new Date().toISOString();
    return { copy, result };
  };
  if (feedbackConfigured()) {
    for (let i = 0; i < 6; i++) {
      const { data, etag } = await getJsonTagged<BrandBook>(KEY);
      const { copy, result } = apply(data ?? empty());
      if (await putJsonIfUnchanged(KEY, copy, data ? etag : null)) {
        await saveLocal(copy);
        return result;
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    }
    throw new BrandError('Otra persona está cambiando las marcas a la vez: vuelve a intentarlo.', 409);
  }
  const { copy, result } = apply((await readLocal()) ?? empty());
  await saveLocal(copy);
  return result;
}

/** Crea o actualiza una marca (con logo opcional ya en disco). */
export async function saveBrand(input: BrandInput, quien: string, id?: string, logo?: { tmp: string; name: string }): Promise<Brand> {
  let logoExt: string | undefined;
  const bid = id ?? `m${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  if (logo) {
    logoExt = path.extname(logo.name).toLowerCase();
    if (!LOGO_EXT[logoExt]) throw new BrandError(`Formato de logo no admitido (${Object.keys(LOGO_EXT).join(', ')}).`);
    await fs.mkdir(dir(), { recursive: true });
    await fs.copyFile(logo.tmp, localLogo({ id: bid, logoExt }));
    if (feedbackConfigured()) await putFile(logoKey({ id: bid, logoExt }), logo.tmp, LOGO_EXT[logoExt]);
  }
  return update((b) => {
    const prev = b.marcas.find((m) => m.id === bid);
    if (id && !prev) throw new BrandError('Esa marca ya no existe.', 404);
    const next: Brand = { ...(prev ?? {}), ...input, id: bid, logoExt: logoExt ?? prev?.logoExt, actualizada: new Date().toISOString(), quien, estado: prev?.estado ?? 'activa' };
    if (prev) Object.assign(prev, next);
    else b.marcas.push(next);
    return next;
  });
}

export async function setBrandState(id: string, estado: Brand['estado']) {
  return update((b) => {
    const m = b.marcas.find((x) => x.id === id);
    if (!m) throw new BrandError('Esa marca ya no existe.', 404);
    m.estado = estado;
    return m;
  });
}

export async function findBrand(ref: string): Promise<Brand> {
  const { marcas } = await loadBrands();
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const m = marcas.find((x) => x.id === ref) ?? marcas.find((x) => n(x.nombre) === n(ref));
  if (!m || m.estado !== 'activa') throw new BrandError(`No hay ninguna marca «${ref}» (mira marcas).`, 404);
  return m;
}

/** Logo en este PC (lo baja de R2 si hace falta). */
export async function ensureLogo(b: Brand): Promise<string | null> {
  if (!b.logoExt) return null;
  const p = localLogo(b);
  if (fsSync.existsSync(p)) return p;
  if (!feedbackConfigured()) return null;
  await fs.mkdir(dir(), { recursive: true });
  await getFile(logoKey(b), p);
  return p;
}
