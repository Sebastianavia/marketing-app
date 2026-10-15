import fs from 'fs';
import path from 'path';
import {
  GEMINI_EXCLUDED_MODEL_PATTERN,
  GEMINI_FALLBACK_MODELS,
  GEMINI_MODELS_PER_KEY,
  GEMINI_RESERVE_MODELS,
} from '@/config/gemini-free-tier.config';

/**
 * Descubrimiento de los N modelos de texto más recientes con capa gratuita.
 * 1. ListModels → filtra modelos de texto y ordena por versión descendente.
 * 2. Sondea cada candidato con una llamada mínima: 200 o 503 (alta demanda) = disponible;
 *    429 con quotaValue 0 = sin capa gratuita; 404/400 = no utilizable.
 * El resultado se cachea 24 h en disco.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_FILE = path.join(process.cwd(), '.ugc-studio', 'gemini-models.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 25_000;

interface ModelsCache {
  discoveredAt: number;
  models: string[];
}

let inflight: Promise<string[]> | null = null;

function modelVersion(name: string): number {
  const m = name.match(/^gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function rankCandidates(names: string[]): string[] {
  return names
    .filter((n) => n.startsWith('gemini-') && !GEMINI_EXCLUDED_MODEL_PATTERN.test(n) && modelVersion(n) > 0)
    .sort((a, b) => {
      const dv = modelVersion(b) - modelVersion(a);
      if (dv !== 0) return dv;
      // A igual versión: estable antes que preview, y flash/pro antes que lite
      const score = (n: string) => (n.includes('preview') ? 2 : 0) + (n.includes('lite') ? 1 : 0);
      return score(a) - score(b);
    });
}

async function listModelNames(apiKey: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new Error(`ListModels HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''));
}

async function probeModel(apiKey: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ok' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok || res.status === 503) return true;
    if (res.status === 429) {
      const body = await res.text();
      // "limit: 0" → el modelo no tiene capa gratuita para este proyecto
      return !/limit: 0\b|"quotaValue":\s*"0"/.test(body);
    }
    return false;
  } catch {
    // Timeout: el modelo existe pero tardó (modelos con razonamiento); se considera disponible
    return true;
  }
}

function readCache(): ModelsCache | null {
  try {
    const cache: ModelsCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - cache.discoveredAt < CACHE_TTL_MS && cache.models.length > 0) return cache;
  } catch {
    // sin caché
  }
  return null;
}

async function discover(apiKey: string): Promise<string[]> {
  const candidates = rankCandidates(await listModelNames(apiKey));
  const chosen: string[] = [];
  for (const model of candidates) {
    if (chosen.length >= GEMINI_MODELS_PER_KEY + GEMINI_RESERVE_MODELS) break;
    if (await probeModel(apiKey, model)) chosen.push(model);
  }
  return chosen;
}

/**
 * Devuelve los modelos disponibles del más reciente al más antiguo: los primeros
 * GEMINI_MODELS_PER_KEY son los principales del round-robin y el resto, reserva.
 * `force` ignora la caché y vuelve a sondear.
 */
export async function getFreeTierModels(apiKey: string | undefined, force = false): Promise<string[]> {
  if (!force) {
    const cached = readCache();
    if (cached) return cached.models;
  }
  if (!apiKey) return GEMINI_FALLBACK_MODELS;

  inflight ??= discover(apiKey)
    .then((models) => {
      if (models.length === 0) throw new Error('ningún modelo respondió al sondeo');
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ discoveredAt: Date.now(), models }, null, 2));
      console.log(`[GeminiModels] Modelos de capa gratuita: ${models.join(', ')}`);
      return models;
    })
    .catch((err) => {
      console.warn(`[GeminiModels] Descubrimiento falló (${err.message}). Usando respaldo.`);
      return GEMINI_FALLBACK_MODELS;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
