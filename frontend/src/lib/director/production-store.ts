import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { getStorageBasePath, sanitizeProjectName } from '@/lib/storage/project-storage';
import type { SceneType } from './estimate';

/**
 * Producciones del Director. Cada una vive en
 * `<carpeta de proyectos>\Producciones\<Nombre AAAA-MM-DD HHhMM>\produccion.json` junto a sus archivos,
 * y aparece como UNA tarjeta en Proyectos (project-metadata.json en la misma carpeta).
 * Un índice `<datos>/productions/<id>.json` apunta a la carpeta para encontrarla por id.
 *
 * Regla central: el plan aprobado es el contrato. Las herramientas que gastan solo reciben
 * produccionId + escenaId y ejecutan la `spec` aprobada; cualquier cambio vuelve a pedir aprobación.
 */

export type SceneStatus = 'pendiente' | 'aprobada' | 'generando' | 'lista' | 'fallida' | 'rechazada';

export type ProductionStatus =
  | 'esperando_aprobacion'
  | 'aprobada'
  | 'en_curso'
  | 'lista'
  | 'con_errores'
  | 'rechazada';

/** Lo que pide el agente para una escena (validado con zod en tools.ts). */
export interface SceneSpec {
  tipo: SceneType;
  /** Descripción corta para la persona que aprueba. */
  titulo?: string;
  duracionSeg?: number;
  /** Lo que se dice (avatar, voz). */
  texto?: string;
  /** Descripción visual (imagen, toma de apoyo). */
  prompt?: string;
  avatarId?: string;
  vozId?: string;
  modelo?: string;
  modeloVoz?: string;
  conAudio?: boolean;
  resolucion?: string;
  cantidad?: number;
  /** Id de una escena de imagen de esta producción que sirve de foto/fotograma inicial. */
  imagenDeEscena?: string;
  /** Solo avatar (HeyGen). */
  movimiento?: string;
  expresividad?: 'low' | 'medium' | 'high';
}

export type FileRole = 'voz' | 'tiempos' | 'imagen' | 'clip';

export interface ProductionFile {
  id: string;
  rol: FileRole;
  herramienta: string;
  modelo: string;
  prompt?: string;
  costoEstimadoUSD: number;
  costoUSD: number;
  ruta: string;
  jobId?: string;
  version: number;
  creado: string;
  /** Movido a _versiones\ al rehacer o cambiar la escena. */
  archivado?: boolean;
}

export interface ProductionScene {
  id: string;
  orden: number;
  spec: SceneSpec;
  /** Costo calculado de la spec actual y su desglose. */
  estimadoUSD: number;
  detalle: string;
  estado: SceneStatus;
  /** Monto aprobado por la persona para la spec actual (null si no hay aprobación vigente). */
  aprobadaUSD: number | null;
  aprobacionId: string | null;
  /** Versión de la spec; sube con cada cambio aprobado o rehacer. */
  version: number;
  /** Gasto real acumulado de la escena (todas las versiones). */
  gastoUSD: number;
  /** Ya se usó el reintento gratis tras un fallo sin cobro. */
  reintentoUsado: boolean;
  /** El último fallo llegó a cobrar algo (entonces reintentar exige aprobación nueva). */
  falloConCobro: boolean;
  jobId?: string;
  error?: string;
  /** Duración real de la voz (avatar/voz), para subtítulos y montaje. */
  duracionRealSeg?: number;
  /** Archivos temporales en Cloudinary que hay que borrar al terminar. */
  temporales?: Array<{ publicId: string; resourceType: 'image' | 'video' }>;
  archivos: ProductionFile[];
}

export interface ProductionApproval {
  id: string;
  escenas: string[];
  montoUSD: number;
  motivo: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  pedida: string;
  resuelta?: string;
  /** Solo se aprueba desde la interfaz de la app. */
  origen?: 'app';
  persona?: string;
}

export interface Production {
  id: string;
  nombre: string;
  carpeta: string;
  formato: '9:16' | '16:9' | '1:1';
  presupuestoUSD: number;
  estado: ProductionStatus;
  escenas: ProductionScene[];
  aprobaciones: ProductionApproval[];
  creada: string;
  actualizada: string;
}

export class ProductionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const PRODUCTION_ID = /^prod_[a-z0-9]{8,32}$/;
const FILE_NAME = 'produccion.json';

export function newProductionId() {
  return `prod_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export const roundUSD = (n: number) => Math.round(n * 10000) / 10000;

async function indexDir() {
  const dir = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'productions');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function indexPath(id: string) {
  if (!PRODUCTION_ID.test(id)) throw new ProductionError('Id de producción no válido.');
  return path.join(/*turbopackIgnore: true*/ await indexDir(), `${id}.json`);
}

export async function productionsRoot(): Promise<string> {
  const dir = path.join(/*turbopackIgnore: true*/ await getStorageBasePath(), 'Producciones');
  if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
}

/** Crea la carpeta (sin pisar una existente) y devuelve su ruta. */
export async function createProductionFolder(nombre: string): Promise<string> {
  const root = await productionsRoot();
  const base = `${sanitizeProjectName(nombre).replace(/-/g, ' ') || 'Produccion'} ${stamp()}`;
  let dir = path.join(/*turbopackIgnore: true*/ root, base);
  for (let i = 2; fsSync.existsSync(dir); i++) dir = path.join(/*turbopackIgnore: true*/ root, `${base} (${i})`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readProductionFile(dir: string): Promise<Production | null> {
  const p = await readJson<Production | null>(path.join(/*turbopackIgnore: true*/ dir, FILE_NAME), null);
  return p && p.id ? p : null;
}

export async function getProduction(id: string): Promise<Production | null> {
  const idx = await readJson<{ carpeta?: string } | null>(await indexPath(id), null);
  if (!idx?.carpeta) return null;
  return readProductionFile(idx.carpeta);
}

export async function requireProduction(id: string): Promise<Production> {
  const p = await getProduction(id);
  if (!p) throw new ProductionError('Producción no encontrada.', 404);
  return p;
}

export async function listProductions(): Promise<Production[]> {
  const dir = await indexDir();
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const out: Production[] = [];
  for (const f of files) {
    const p = await getProduction(f.replace(/\.json$/, '')).catch(() => null);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.creada.localeCompare(a.creada));
}

/** Estado general derivado de sus escenas y aprobaciones. */
export function deriveStatus(p: Production): ProductionStatus {
  const states = p.escenas.map((s) => s.estado);
  if (states.every((s) => s === 'rechazada')) return 'rechazada';
  if (states.some((s) => s === 'generando')) return 'en_curso';
  if (states.every((s) => s === 'lista' || s === 'rechazada')) return 'lista';
  if (states.some((s) => s === 'pendiente')) return 'esperando_aprobacion';
  if (states.some((s) => s === 'fallida')) return 'con_errores';
  if (states.some((s) => s === 'lista')) return 'en_curso';
  return 'aprobada';
}

export function productionSpent(p: Production) {
  return roundUSD(p.escenas.reduce((t, s) => t + s.gastoUSD, 0));
}

/** Tarjeta en Proyectos: el último clip como video y las imágenes de la producción. */
async function writeProjectCard(p: Production) {
  const files = p.escenas.flatMap((s) => currentFiles(s));
  const clips = files.filter((f) => f.rol === 'clip');
  const images = files.filter((f) => f.rol === 'imagen').map((f) => f.ruta);
  const meta = {
    id: p.id,
    name: path.basename(p.carpeta),
    category: 'Producciones',
    createdAt: p.creada,
    updatedAt: p.actualizada,
    path: p.carpeta,
    title: p.nombre,
    prompt: p.escenas.map((s) => `${s.orden}. ${s.spec.titulo || s.spec.tipo}`).join('\n'),
    ratio: p.formato,
    videoPath: clips.length ? clips[clips.length - 1].ruta : undefined,
    imagePaths: images.length ? images : undefined,
    status: clips.length || images.length ? 'rendered' : 'draft',
    finalCostUSD: productionSpent(p),
    modelUsed: [...new Set(files.map((f) => f.modelo))].join(' + ') || undefined,
    audioMode: 'generar',
    tags: ['director', p.estado],
  };
  try {
    await writeJsonAtomic(path.join(/*turbopackIgnore: true*/ p.carpeta, 'project-metadata.json'), meta);
  } catch (err) {
    console.warn('[produccion] No se pudo actualizar la tarjeta de Proyectos:', err);
  }
}

async function persist(p: Production) {
  p.estado = deriveStatus(p);
  p.actualizada = new Date().toISOString();
  await writeJsonAtomic(path.join(/*turbopackIgnore: true*/ p.carpeta, FILE_NAME), p);
  await writeJsonAtomic(await indexPath(p.id), { id: p.id, carpeta: p.carpeta });
  await writeProjectCard(p);
}

export async function saveNewProduction(p: Production) {
  await withLock(p.id, () => persist(p));
}

// Un candado por producción dentro del proceso: varios renders terminan a la vez y escriben el mismo JSON.
const g = globalThis as unknown as { __luloProductionLocks?: Map<string, Promise<unknown>> };
const locks: Map<string, Promise<unknown>> = g.__luloProductionLocks ?? (g.__luloProductionLocks = new Map());

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return run;
}

/** Lee, modifica y guarda la producción bajo el candado. `fn` puede lanzar para no guardar nada. */
export function updateProduction<T>(id: string, fn: (p: Production) => Promise<T> | T): Promise<{ production: Production; result: T }> {
  return withLock(id, async () => {
    const p = await requireProduction(id);
    const result = await fn(p);
    await persist(p);
    return { production: p, result };
  });
}

export function findScene(p: Production, sceneId: string): ProductionScene {
  const s = p.escenas.find((x) => x.id === sceneId);
  if (!s) throw new ProductionError(`La producción no tiene la escena "${sceneId}".`, 404);
  return s;
}

/** Nombre de archivo dentro de la carpeta: escena-01_v1_voz.mp3 */
export function sceneFileName(scene: ProductionScene, rol: FileRole, ext: string, n?: number) {
  const num = String(scene.orden).padStart(2, '0');
  return `escena-${num}_v${scene.version}_${rol}${n ? `-${n}` : ''}.${ext.replace(/^\./, '')}`;
}

/** Pone una copia (enlace duro si se puede) de un archivo de la biblioteca en la carpeta de la producción. */
export async function placeInProduction(p: Production, source: string, fileName: string): Promise<string> {
  const target = path.join(/*turbopackIgnore: true*/ p.carpeta, fileName);
  if (fsSync.existsSync(target)) throw new ProductionError(`Ya existe ${fileName}; no se sobrescribe.`, 409);
  try {
    await fs.link(source, target);
  } catch {
    await fs.copyFile(source, target);
  }
  return target;
}

/** Mueve los archivos actuales de la escena a _versiones\ (nunca se borran). */
export async function archiveSceneFiles(p: Production, scene: ProductionScene) {
  if (!scene.archivos.length) return;
  const dir = path.join(/*turbopackIgnore: true*/ p.carpeta, '_versiones');
  await fs.mkdir(dir, { recursive: true });
  for (const f of scene.archivos) {
    if (f.archivado) continue;
    f.archivado = true;
    if (path.dirname(f.ruta) !== p.carpeta || !fsSync.existsSync(f.ruta)) continue;
    const dest = path.join(/*turbopackIgnore: true*/ dir, path.basename(f.ruta));
    try {
      await fs.rename(f.ruta, dest);
      f.ruta = dest;
      f.archivado = true;
    } catch (err) {
      console.warn('[produccion] No se pudo mover a _versiones:', err);
    }
  }
}

/** Archivos vigentes de la escena (sin los movidos a _versiones). */
export function currentFiles(scene: ProductionScene, rol?: FileRole): ProductionFile[] {
  return scene.archivos.filter((f) => !f.archivado && (!rol || f.rol === rol));
}

export function pendingApproval(p: Production): ProductionApproval | undefined {
  return p.aprobaciones.find((a) => a.estado === 'pendiente');
}
