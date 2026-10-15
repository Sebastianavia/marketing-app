import fs from 'fs';
import path from 'path';
import { GeminiRateLimits, getDefaultLimits, GEMINI_RPD_SWITCH_THRESHOLD } from '@/config/gemini-free-tier.config';

/**
 * Tracker local de cuota por slot (llave + modelo).
 *
 * Google no expone la cuota restante, así que contamos cada request/tokens nosotros
 * y aprendemos los límites reales de los 429 (QuotaFailure.violations[].quotaValue).
 * Se persiste en disco para sobrevivir reinicios del servidor de Next.
 */

const STATE_DIR = path.join(process.cwd(), '.ugc-studio');
const STATE_FILE = path.join(STATE_DIR, 'gemini-usage.json');
const MINUTE_MS = 60_000;

export type SlotStatus = 'ok' | 'cooldown' | 'exhausted' | 'not_free';

interface SlotUsage {
  requests: number[]; // timestamps de requests del último minuto
  tokens: { t: number; n: number }[]; // tokens del último minuto
  dayKey: string;
  dayCount: number;
  learned: Partial<GeminiRateLimits>;
  cooldownUntil?: number;
  exhaustedDayKey?: string;
  notFreeUntil?: number; // límite 0 en la capa gratuita; se vuelve a probar pasado este momento
}

export interface SlotQuotaSnapshot {
  status: SlotStatus;
  limits: GeminiRateLimits;
  rpmUsed: number;
  tpmUsed: number;
  rpdUsed: number;
  rpdRemaining: number;
  rpdRemainingPct: number;
  cooldownMs: number;
}

/** Día de facturación de cuota: Google reinicia RPD a medianoche hora del Pacífico. */
function pacificDayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

/** Parsea "37s" / "1.5s" (formato google.protobuf.Duration) a ms. */
function parseRetryDelay(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const seconds = parseFloat(value.replace(/s$/, ''));
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

class GeminiQuotaTracker {
  private slots: Record<string, SlotUsage> = {};
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(shared: { __geminiQuotaSlots?: Record<string, SlotUsage> }) {
    if (!shared.__geminiQuotaSlots) {
      shared.__geminiQuotaSlots = {};
      try {
        if (fs.existsSync(STATE_FILE)) {
          shared.__geminiQuotaSlots = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
      } catch (err) {
        console.warn('[GeminiQuota] No se pudo leer el estado de cuota, se inicia vacío:', err);
      }
    }
    this.slots = shared.__geminiQuotaSlots!;
  }

  private usage(slotId: string): SlotUsage {
    const today = pacificDayKey();
    let u = this.slots[slotId];
    if (!u) {
      u = { requests: [], tokens: [], dayKey: today, dayCount: 0, learned: {} };
      this.slots[slotId] = u;
    }
    if (u.dayKey !== today) {
      u.dayKey = today;
      u.dayCount = 0;
    }
    const cutoff = Date.now() - MINUTE_MS;
    u.requests = u.requests.filter((t) => t > cutoff);
    u.tokens = u.tokens.filter((x) => x.t > cutoff);
    return u;
  }

  limits(slotId: string, model: string): GeminiRateLimits {
    return { ...getDefaultLimits(model), ...this.usage(slotId).learned };
  }

  snapshot(slotId: string, model: string): SlotQuotaSnapshot {
    const u = this.usage(slotId);
    const limits = this.limits(slotId, model);
    const now = Date.now();
    const rpdRemaining = Math.max(0, limits.rpd - u.dayCount);
    const cooldownMs = Math.max(0, (u.cooldownUntil ?? 0) - now);

    let status: SlotStatus = 'ok';
    if ((u.notFreeUntil ?? 0) > now) status = 'not_free';
    // Agotado solo si Google lo confirmó (429 diario) o si el límite es uno aprendido de Google.
    // Si solo alcanzamos nuestra estimación por defecto, el slot queda como último recurso (lowReserve).
    else if (u.exhaustedDayKey === u.dayKey || (u.learned.rpd !== undefined && rpdRemaining === 0)) status = 'exhausted';
    else if (cooldownMs > 0) status = 'cooldown';

    return {
      status,
      limits,
      rpmUsed: u.requests.length,
      tpmUsed: u.tokens.reduce((s, x) => s + x.n, 0),
      rpdUsed: u.dayCount,
      rpdRemaining,
      rpdRemainingPct: limits.rpd > 0 ? rpdRemaining / limits.rpd : 0,
      cooldownMs,
    };
  }

  /**
   * ¿Conviene usar este slot ahora? Aplica el cambio preventivo: si queda menos del umbral
   * de RPD (salvo `allowLowReserve`) o la ventana del minuto está llena, devuelve ok=false.
   * `waitMs` = cuánto falta para que vuelva a estar disponible (0 = no hoy / no por tiempo).
   */
  availability(slotId: string, model: string, allowLowReserve = false): { ok: boolean; waitMs: number; lowReserve: boolean } {
    const snap = this.snapshot(slotId, model);
    if (snap.status === 'not_free' || snap.status === 'exhausted') return { ok: false, waitMs: 0, lowReserve: false };
    if (snap.status === 'cooldown') return { ok: false, waitMs: snap.cooldownMs, lowReserve: false };
    if (!allowLowReserve && snap.rpdRemainingPct < GEMINI_RPD_SWITCH_THRESHOLD) return { ok: false, waitMs: 0, lowReserve: true };

    const u = this.usage(slotId);
    if (snap.rpmUsed >= snap.limits.rpm || snap.tpmUsed >= snap.limits.tpm) {
      const oldest = Math.min(...u.requests, ...u.tokens.map((x) => x.t));
      return { ok: false, waitMs: Math.max(250, oldest + MINUTE_MS - Date.now()), lowReserve: false };
    }
    return { ok: true, waitMs: 0, lowReserve: false };
  }

  /** Reserva el request antes de llamar, para que agentes en paralelo no se pisen. */
  reserve(slotId: string): void {
    const u = this.usage(slotId);
    u.requests.push(Date.now());
    u.dayCount += 1;
    this.scheduleSave();
  }

  recordTokens(slotId: string, tokens: number): void {
    if (!tokens) return;
    this.usage(slotId).tokens.push({ t: Date.now(), n: tokens });
    this.scheduleSave();
  }

  /** Pausa corta (ej. 503 por alta demanda) sin tocar los contadores. */
  cooldown(slotId: string, ms: number): void {
    const u = this.usage(slotId);
    u.cooldownUntil = Math.max(u.cooldownUntil ?? 0, Date.now() + ms);
    this.scheduleSave();
  }

  /**
   * Procesa el cuerpo de un 429 de Google: aprende el límite real, y decide si el slot
   * queda en cooldown (por minuto), agotado (por día) o fuera de la capa gratuita (límite 0).
   */
  handleRateLimit(slotId: string, responseBody?: string): void {
    const u = this.usage(slotId);
    let details: any[] = [];
    let messageLimits: number[] = [];
    try {
      const error = JSON.parse(responseBody || '{}')?.error;
      details = error?.details ?? [];
      // Google pone los valores en el mensaje ("* Quota exceeded for metric: ..., limit: 250, ..."),
      // una línea por violación y en el mismo orden que QuotaFailure.violations
      messageLimits = [...String(error?.message ?? '').matchAll(/limit: (\d+)/g)].map((m) => Number(m[1]));
    } catch {
      // cuerpo no JSON: se trata como límite por minuto genérico
    }

    let retryMs: number | undefined;
    let isDaily = false;

    for (const d of details) {
      const type = String(d?.['@type'] ?? '');
      if (type.endsWith('RetryInfo')) retryMs = parseRetryDelay(d.retryDelay);
      if (!type.endsWith('QuotaFailure')) continue;

      (d.violations ?? []).forEach((v: any, idx: number) => {
        const id = `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`;
        const value = Number(v.quotaValue ?? messageLimits[idx]);
        if (value === 0) {
          u.notFreeUntil = Date.now() + 24 * 60 * 60 * 1000;
          return;
        }
        if (!Number.isFinite(value)) return;
        if (/PerDay/i.test(id)) {
          u.learned.rpd = value;
          isDaily = true;
        } else if (/token/i.test(id)) {
          u.learned.tpm = value;
        } else if (/PerMinute/i.test(id)) {
          u.learned.rpm = value;
        }
      });
    }

    if (isDaily) u.exhaustedDayKey = u.dayKey;
    u.cooldownUntil = Date.now() + (retryMs ?? MINUTE_MS);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.slots, null, 2));
      } catch (err) {
        console.warn('[GeminiQuota] No se pudo persistir el estado de cuota:', err);
      }
    }, 500);
  }
}

// Los contadores se comparten vía globalThis (sobreviven recargas de módulos en dev);
// la clase se recrea para que los cambios de código apliquen sin reiniciar.
const globalForQuota = globalThis as unknown as { __geminiQuotaSlots?: Record<string, SlotUsage> };
export const geminiQuota = new GeminiQuotaTracker(globalForQuota);
