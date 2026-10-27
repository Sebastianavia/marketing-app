import { OTHER_SERIES, toolLabel, toolSeries, type ToolSeries } from '@/config/tool-colors';
import type { UsageEvent } from '@/lib/usage/usage-store';

/**
 * Cálculos de la vista Costos. Funciones puras (cliente y pruebas): no leen archivos.
 * Regla común con la vista anterior y con el límite diario: solo suman los registros `status: 'ok'`.
 */

export type UsageRowWithGroup = UsageEvent & {
  /** `prod:<id>` · `scene:<id>` · `job:<id>` (ver usage-insights.ts). */
  groupKey?: string;
};

export interface UsageGroupInfo {
  key: string;
  kind: 'produccion' | 'escenas' | 'suelto';
  nombre: string;
  carpeta?: string;
}

export const KIND_LABEL: Record<UsageEvent['kind'], string> = {
  video: 'Video',
  audio: 'Voz',
  script: 'Guion',
  image: 'Imagen',
  voice_clone: 'Clonación',
  transcription: 'Transcripción',
};

export const PROVIDER_LABEL: Record<string, string> = {
  openrouter: 'OpenRouter',
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  apimart: 'APIMart',
  heygen: 'HeyGen',
  fal: 'fal',
  buzzy: 'Buzzy',
};

export const GROUP_KIND_LABEL: Record<UsageGroupInfo['kind'], string> = {
  produccion: 'Producción',
  escenas: 'Guion a video',
  suelto: 'Video suelto',
};

/** Dólares: 2 decimales; 4 si es menos de un centavo. */
export const usd = (n: number) => (n === 0 ? '$0.00' : Math.abs(n) < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export const pct = (n: number) => `${Math.round(n)} %`;

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return capFirst(new Date(y, mm - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }));
}

export function monthName(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('es', { month: 'long' });
}

export function prevMonthOf(m: string) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm, 0).getDate();
}

export function monthOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Día local AAAA-MM-DD (como agrupa la tabla y como cuenta el límite diario). */
export function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(day: string, now = new Date()) {
  const [y, m, dd] = day.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return capFirst(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
}

export function shortDay(day: string) {
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

export const isOk = (r: UsageEvent) => r.status === 'ok';

export function sumCost(rows: UsageEvent[]) {
  return rows.reduce((s, r) => (isOk(r) ? s + r.costUSD : s), 0);
}

// ---------------------------------------------------------------------------
// Videos (producciones, proyectos de Guion a video, videos sueltos)
// ---------------------------------------------------------------------------

export interface VideoCost {
  info: UsageGroupInfo;
  costUSD: number;
  partes: Partial<Record<UsageEvent['kind'], number>>;
  /** Primer registro del grupo. */
  desde: string;
  terminado: boolean;
}

/** Un "video terminado" tiene al menos un clip cobrado; suma todo lo suyo (imagen, voz, clips). */
export function videoCosts(rows: UsageRowWithGroup[], groups: Record<string, UsageGroupInfo>): VideoCost[] {
  const map = new Map<string, VideoCost>();
  for (const r of rows) {
    if (!r.groupKey || !isOk(r)) continue;
    const info = groups[r.groupKey] ?? { key: r.groupKey, kind: 'suelto' as const, nombre: 'Video' };
    let v = map.get(r.groupKey);
    if (!v) {
      v = { info, costUSD: 0, partes: {}, desde: r.createdAt, terminado: false };
      map.set(r.groupKey, v);
    }
    v.costUSD += r.costUSD;
    v.partes[r.kind] = (v.partes[r.kind] ?? 0) + r.costUSD;
    if (r.createdAt < v.desde) v.desde = r.createdAt;
    if (r.kind === 'video') v.terminado = true;
  }
  return [...map.values()].filter((v) => v.terminado).sort((a, b) => b.costUSD - a.costUSD);
}

export function averageVideo(rows: UsageRowWithGroup[], groups: Record<string, UsageGroupInfo>) {
  const v = videoCosts(rows, groups);
  return { count: v.length, avg: v.length ? v.reduce((s, x) => s + x.costUSD, 0) / v.length : 0 };
}

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

export interface Summary {
  month: string;
  prevMonth: string;
  isCurrentMonth: boolean;
  dayOfMonth: number;
  days: number;
  monthTotal: number;
  /** Mes anterior completo. */
  prevTotal: number;
  /** Mes anterior hasta el mismo día (mes actual) o completo (mes pasado). */
  prevComparable: number;
  /** % de cambio contra prevComparable (null si el mes anterior no tuvo gasto). */
  deltaPct: number | null;
  /** Mes actual: promedio por día de calendario × días del mes. Mes pasado: el total real. */
  closing: number;
  closingIsEstimate: boolean;
  video: { count: number; avg: number };
  prevVideo: { count: number; avg: number };
  okCount: number;
}

export function summarize(opts: {
  rows: UsageRowWithGroup[];
  prevRows: UsageRowWithGroup[];
  groups: Record<string, UsageGroupInfo>;
  month: string;
  now?: Date;
}): Summary {
  const now = opts.now ?? new Date();
  const { month } = opts;
  const prevMonth = prevMonthOf(month);
  const isCurrentMonth = monthOf(now) === month;
  const days = daysInMonth(month);
  const dayOfMonth = isCurrentMonth ? now.getDate() : days;
  const monthTotal = sumCost(opts.rows);
  const prevTotal = sumCost(opts.prevRows);
  const prevComparable = isCurrentMonth
    ? sumCost(opts.prevRows.filter((r) => new Date(r.createdAt).getDate() <= dayOfMonth))
    : prevTotal;
  const deltaPct = prevComparable > 0 ? ((monthTotal - prevComparable) / prevComparable) * 100 : null;
  return {
    month,
    prevMonth,
    isCurrentMonth,
    dayOfMonth,
    days,
    monthTotal,
    prevTotal,
    prevComparable,
    deltaPct,
    closing: isCurrentMonth ? (monthTotal / dayOfMonth) * days : monthTotal,
    closingIsEstimate: isCurrentMonth,
    video: averageVideo(opts.rows, opts.groups),
    prevVideo: averageVideo(opts.prevRows, opts.groups),
    okCount: opts.rows.filter(isOk).length,
  };
}

/** Frase de arriba: cómo va el mes en una línea. */
export function headline(s: Summary): string {
  const name = capFirst(monthName(s.month));
  const prev = monthName(s.prevMonth);
  const verb = s.isCurrentMonth ? 'va en' : 'cerró en';
  if (s.monthTotal === 0) return s.isCurrentMonth ? `${name} todavía no tiene gastos.` : `${name} no tuvo gastos.`;
  if (s.deltaPct === null) return `${name} ${verb} ${usd(s.monthTotal)}. No hay gastos de ${prev} para comparar.`;
  const when = s.isCurrentMonth ? ` a esta fecha` : '';
  if (Math.abs(s.deltaPct) < 1) return `${name} ${verb} ${usd(s.monthTotal)}, casi igual que ${prev}${when}.`;
  const dir = s.deltaPct > 0 ? 'más' : 'menos';
  return `${name} ${verb} ${usd(s.monthTotal)}, un ${pct(Math.abs(s.deltaPct))} ${dir} que ${prev}${when}.`;
}

// ---------------------------------------------------------------------------
// Gasto por día
// ---------------------------------------------------------------------------

export interface DaySpend {
  day: string;
  n: number;
  total: number;
  /** En el orden fijo de las series. */
  parts: Array<{ series: ToolSeries; cost: number }>;
}

export function dailySpend(rows: UsageEvent[], month: string): { days: DaySpend[]; series: ToolSeries[] } {
  const n = daysInMonth(month);
  const days: DaySpend[] = Array.from({ length: n }, (_, i) => ({
    day: `${month}-${String(i + 1).padStart(2, '0')}`,
    n: i + 1,
    total: 0,
    parts: [],
  }));
  const seen = new Map<string, ToolSeries>();
  for (const r of rows) {
    if (!isOk(r) || r.costUSD <= 0) continue;
    const day = localDay(r.createdAt);
    const d = days.find((x) => x.day === day);
    if (!d) continue;
    const series = toolSeries(r.tool);
    seen.set(series.id, series);
    d.total += r.costUSD;
    const part = d.parts.find((p) => p.series.id === series.id);
    if (part) part.cost += r.costUSD;
    else d.parts.push({ series, cost: r.costUSD });
  }
  for (const d of days) d.parts.sort((a, b) => a.series.order - b.series.order);
  return { days, series: [...seen.values()].sort((a, b) => a.order - b.order) };
}

// ---------------------------------------------------------------------------
// En qué se va
// ---------------------------------------------------------------------------

export type BreakdownBy = 'tool' | 'provider' | 'model';

export interface BreakdownRow {
  key: string;
  label: string;
  costUSD: number;
  pct: number;
  /** Solo por herramienta: el color de la serie. Proveedor y modelo van en gris. */
  series?: ToolSeries;
}

export function breakdown(rows: UsageEvent[], by: BreakdownBy): BreakdownRow[] {
  const total = sumCost(rows);
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    if (!isOk(r)) continue;
    const series = by === 'tool' ? toolSeries(r.tool) : undefined;
    // Por herramienta se agrupa por serie de color ("Otras" junta chat, Mia…)
    const key = by === 'tool' ? series!.id : by === 'provider' ? r.provider : r.model;
    const label =
      by === 'tool' ? (series === OTHER_SERIES ? OTHER_SERIES.label : series!.label) : by === 'provider' ? PROVIDER_LABEL[r.provider] ?? r.provider : r.model;
    const row = map.get(key) ?? { key, label, costUSD: 0, pct: 0, series };
    row.costUSD += r.costUSD;
    map.set(key, row);
  }
  return [...map.values()]
    .map((x) => ({ ...x, pct: total > 0 ? (x.costUSD / total) * 100 : 0 }))
    .sort((a, b) => b.costUSD - a.costUSD || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Gratis y sin cobrar
// ---------------------------------------------------------------------------

export interface FreeAndFailed {
  freeCount: number;
  freeTokens: number;
  failedCount: number;
  /** Fallidos que aun así cobraron algo. */
  failedCharged: { count: number; costUSD: number };
  reasons: Array<{ reason: string; count: number }>;
}

/** Motivo legible de un fallo a partir de la descripción ("… · falló: <mensaje>"). */
export function failureReason(description: string): string {
  const m = description.match(/fall[oó]:\s*(.*)$/i);
  const msg = (m?.[1] ?? description).trim();
  if (/clave|api key|user not found|key limit/i.test(msg)) return 'Clave de OpenRouter vencida o sin cupo';
  if (/saldo|credits|quota|billing/i.test(msg)) return 'Sin saldo o sin cuota en el proveedor';
  if (/violat|usage guidelines|rechaz/i.test(msg)) return 'El proveedor rechazó la imagen';
  if (/no encuentra|not found/i.test(msg)) return 'El proveedor perdió el trabajo';
  if (/parameter|requires|not valid|pixels/i.test(msg)) return 'Parámetros no admitidos por el modelo';
  return msg.length > 70 ? `${msg.slice(0, 70)}…` : msg || 'Sin detalle';
}

export function freeAndFailed(rows: UsageEvent[]): FreeAndFailed {
  const free = rows.filter((r) => isOk(r) && r.costUSD === 0);
  const failed = rows.filter((r) => r.status === 'failed');
  const charged = failed.filter((r) => r.costUSD > 0);
  const reasons = new Map<string, number>();
  for (const r of failed) {
    const k = failureReason(r.description);
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  return {
    freeCount: free.length,
    freeTokens: free.reduce((s, r) => s + (r.unit === 'tokens' ? r.units : 0), 0),
    failedCount: failed.length,
    failedCharged: { count: charged.length, costUSD: charged.reduce((s, r) => s + r.costUSD, 0) },
    reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Registro: búsqueda y filtros
// ---------------------------------------------------------------------------

export interface LogFilters {
  q: string;
  tool: string;
  provider: string;
  kind: string;
  status: '' | 'ok' | 'failed' | 'estimated';
  day: string;
}

export const EMPTY_FILTERS: LogFilters = { q: '', tool: '', provider: '', kind: '', status: '', day: '' };

export function filterRows<T extends UsageEvent>(rows: T[], f: LogFilters): T[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.tool && toolLabel(r.tool) !== f.tool) return false;
    if (f.provider && r.provider !== f.provider) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.status === 'ok' && r.status !== 'ok') return false;
    if (f.status === 'failed' && r.status !== 'failed') return false;
    if (f.status === 'estimated' && !r.estimated) return false;
    if (f.day && localDay(r.createdAt) !== f.day) return false;
    if (q) {
      const hay = `${r.description} ${r.model} ${r.provider} ${toolLabel(r.tool)} ${r.person}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Grupos por día para la tabla (las filas ya vienen de más nueva a más vieja). */
export function groupByDay<T extends UsageEvent>(rows: T[]) {
  const out: Array<{ day: string; total: number; rows: T[] }> = [];
  for (const r of rows) {
    const day = localDay(r.createdAt);
    let g = out.at(-1);
    if (!g || g.day !== day) {
      g = { day, total: 0, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
    if (isOk(r)) g.total += r.costUSD;
  }
  return out;
}
