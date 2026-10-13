import { BROLL_MODELS } from '@/config/broll-models';
import { UGC_MODELS_CATALOG } from '@/config/ugc-models.config';

/**
 * Comprueba contra el catálogo en vivo de OpenRouter (GET /api/v1/videos/models)
 * que los modelos de video configurados en la app siguen existiendo y que sus
 * duraciones coinciden. Se guarda en memoria 1 hora para no consultarlo en cada clic.
 */

export interface CatalogModel {
  id: string;
  supported_durations?: number[] | null;
}

export interface CatalogCheck {
  ok: boolean;
  checkedAt: string;
  /** No se pudo consultar (sin internet, etc.): no se bloquea nada. */
  unavailable?: string;
  missing: Array<{ id: string; usedIn: string }>;
  durationMismatch: Array<{ id: string; app: number[]; catalog: number[] }>;
  liveIds: string[];
}

const TTL_MS = 60 * 60 * 1000;
const g = globalThis as unknown as { __luloVideoCatalog?: { at: number; result: CatalogCheck } };

export function configuredVideoModels(): Array<{ id: string; usedIn: string; durations?: number[] }> {
  const list: Array<{ id: string; usedIn: string; durations?: number[] }> = [
    { id: 'heygen/avatar-iv', usedIn: 'Avatar Studio y escenas con la persona' },
    ...BROLL_MODELS.map((m) => ({ id: m.id, usedIn: 'Tomas de apoyo (Guion a video)', durations: m.durations })),
  ];
  for (const m of UGC_MODELS_CATALOG) {
    if (m.provider === 'openrouter' && !list.some((x) => x.id === m.id)) {
      list.push({ id: m.id, usedIn: 'Generador UGC', durations: m.supportedClipDurations });
    }
  }
  return list;
}

export async function checkVideoCatalog(force = false): Promise<CatalogCheck> {
  const cached = g.__luloVideoCatalog;
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.result;

  const now = new Date().toISOString();
  let live: CatalogModel[];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/videos/models', {
      headers: process.env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}`);
    const data = await res.json();
    live = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    if (!live.length) throw new Error('catálogo vacío');
  } catch (err) {
    // Sin catálogo no se bloquea nada; no se guarda en caché para reintentar pronto
    return {
      ok: true,
      checkedAt: now,
      unavailable: err instanceof Error ? err.message : 'sin conexión',
      missing: [],
      durationMismatch: [],
      liveIds: [],
    };
  }

  const byId = new Map(live.map((m) => [m.id, m]));
  const missing: CatalogCheck['missing'] = [];
  const durationMismatch: CatalogCheck['durationMismatch'] = [];
  for (const m of configuredVideoModels()) {
    const found = byId.get(m.id);
    if (!found) {
      missing.push({ id: m.id, usedIn: m.usedIn });
      continue;
    }
    const cat = found.supported_durations ?? null;
    if (m.durations && cat && cat.length) {
      const bad = m.durations.filter((d) => !cat.includes(d));
      if (bad.length) durationMismatch.push({ id: m.id, app: m.durations, catalog: cat });
    }
  }
  const result: CatalogCheck = {
    ok: missing.length === 0,
    checkedAt: now,
    missing,
    durationMismatch,
    liveIds: live.map((m) => m.id),
  };
  g.__luloVideoCatalog = { at: Date.now(), result };
  return result;
}

/** Lanza un error claro si el modelo ya no está en OpenRouter (solo si el catálogo respondió). */
export async function assertVideoModelAvailable(id: string) {
  const c = await checkVideoCatalog();
  if (c.unavailable) return;
  if (!c.liveIds.includes(id)) {
    throw new Error(`El modelo de video "${id}" ya no está disponible en OpenRouter. Elige otro antes de generar (no se ha gastado nada).`);
  }
}
