import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir } from '@/lib/data/data-dir';
import { getPersonName } from '@/lib/data/settings';

/**
 * Registro de costos: un archivo por mes, una línea JSON por generación
 * (`usage/2026-10.jsonl`). Solo se añade, nunca se reescribe, así que una
 * actualización de la app o un corte de luz no borra lo ya registrado.
 */

export type UsageKind = 'video' | 'audio' | 'script' | 'image' | 'voice_clone' | 'transcription';

export interface UsageEvent {
  id: string;
  /** ISO con zona horaria local del servidor. */
  createdAt: string;
  person: string;
  /** Herramienta de la app: avatar-studio, voice-studio, ugc-generator… */
  tool: string;
  kind: UsageKind;
  provider: string;
  model: string;
  /** Qué se generó, en lenguaje humano. */
  description: string;
  /** Cantidad consumida y su unidad (segundos, caracteres, guiones…). */
  units: number;
  unit: string;
  costUSD: number;
  /** Indica si el costo es una estimación con tarifa de catálogo. */
  estimated: boolean;
  /** Archivo guardado en la biblioteca, si aplica. */
  filePath?: string;
  jobId?: string;
  /** Producción del Director a la que pertenece. */
  productionId?: string;
  status: 'ok' | 'failed';
}

export type NewUsageEvent = Omit<UsageEvent, 'id' | 'createdAt' | 'person' | 'status'> & {
  status?: UsageEvent['status'];
};

async function monthFile(month: string) {
  const dir = await ensureDataDir();
  return path.join(/*turbopackIgnore: true*/ dir, 'usage', `${month}.jsonl`);
}

export function currentMonth(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Registra una generación. Nunca lanza: el registro no debe romper una generación que ya se pagó. */
export async function recordUsage(event: NewUsageEvent): Promise<UsageEvent | null> {
  try {
    const now = new Date();
    const full: UsageEvent = {
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      person: await getPersonName(),
      status: 'ok',
      ...event,
      costUSD: Math.round(event.costUSD * 10000) / 10000,
    };
    await fs.appendFile(await monthFile(currentMonth(now)), JSON.stringify(full) + '\n', 'utf-8');
    return full;
  } catch (err) {
    console.error('[usage] No se pudo registrar el consumo:', err);
    return null;
  }
}

export async function listUsage(month = currentMonth()): Promise<UsageEvent[]> {
  const file = await monthFile(month);
  if (!fsSync.existsSync(file)) return [];
  const raw = await fs.readFile(file, 'utf-8');
  const rows: UsageEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Una línea dañada no impide leer las demás.
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listUsageMonths(): Promise<string[]> {
  const dir = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'usage');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const months = files.filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 7));
  const now = currentMonth();
  if (!months.includes(now)) months.push(now);
  return months.sort().reverse();
}

export function usageToCsv(rows: UsageEvent[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['fecha', 'hora', 'persona', 'herramienta', 'tipo', 'descripcion', 'proveedor', 'modelo', 'cantidad', 'unidad', 'costo_usd', 'estimado', 'estado', 'archivo'];
  const lines = rows.map((r) => {
    const d = new Date(r.createdAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return [
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      r.person, r.tool, r.kind, r.description, r.provider, r.model,
      r.units, r.unit, r.costUSD.toFixed(4), r.estimated ? 'si' : 'no', r.status, r.filePath ?? '',
    ].map(esc).join(',');
  });
  // BOM para que Excel abra bien las tildes
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}

export class DailyLimitError extends Error {
  constructor(public spentToday: number, public limit: number, public estimate: number) {
    super(
      `Superarías el límite diario de $${limit.toFixed(2)}: hoy llevas $${spentToday.toFixed(2)} y esta generación cuesta unos $${estimate.toFixed(2)}. Cambia el límite en Costos si lo necesitas.`,
    );
  }
}

/** Gasto de hoy (hora local) de este PC. */
export async function spentToday(): Promise<number> {
  const today = new Date().toDateString();
  const rows = await listUsage();
  return rows
    .filter((r) => r.status === 'ok' && new Date(r.createdAt).toDateString() === today)
    .reduce((sum, r) => sum + r.costUSD, 0);
}

/** Lanza DailyLimitError si la generación estimada superaría el límite configurado. */
export async function assertWithinDailyLimit(estimateUSD: number, limitUSD: number | undefined) {
  if (!limitUSD || limitUSD <= 0) return;
  const spent = await spentToday();
  if (spent + estimateUSD > limitUSD) {
    throw new DailyLimitError(spent, limitUSD, estimateUSD);
  }
}
