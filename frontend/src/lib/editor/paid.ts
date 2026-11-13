import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { dubbingCost, sttCost, ttsCost } from '@/config/cost-rates';
import { getSettings } from '@/lib/data/settings';
import { assertWithinDailyLimit, recordUsage } from '@/lib/usage/usage-store';
import { synthesizeSpeech } from '@/lib/generation/voice';
import { transcribeWithElevenLabs } from '@/lib/generation/transcribe';
import { ffmpeg, probeVideo, stageFonts } from './media';
import { buildAss } from './ass';
import { directedProfile } from './direction';
import { normalizeProfile } from './profile-store';
import { renderCopy } from './outputs';
import { getEdit, updateEdit, logActivity } from './edit-store';
import type { SubWord } from './timeline';
import type { EditProject } from './types';

/**
 * Voz e idioma con gasto (Fase 6): doblaje con ElevenLabs y palabras corregidas con la voz clonada.
 * El editor no gasta sin permiso: Claude pide una aprobación (tarjeta en la app), la persona la
 * aprueba con el monto que ve, y cada gasto se descuenta de ella (con 10 % de margen), respeta el
 * límite diario y queda en Costos (herramienta «video-editor»).
 */

export interface EditApproval {
  id: string;
  concepto: string;
  montoUSD: number;
  usadoUSD: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  pedida: string;
  resuelta?: string;
}

export class PaidError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function requestApproval(editId: string, concepto: string, montoUSD: number): Promise<EditApproval> {
  const ap: EditApproval = { id: `ap${randomUUID().slice(0, 8)}`, concepto, montoUSD: Number(montoUSD.toFixed(4)), usadoUSD: 0, estado: 'pendiente', pedida: new Date().toISOString() };
  await updateEdit(editId, (p) => {
    p.aprobaciones = [...(p.aprobaciones ?? []).filter((x) => x.estado !== 'pendiente'), ap];
    logActivity(p, `Claude pide aprobar $${ap.montoUSD.toFixed(2)}: ${concepto}.`);
  });
  return ap;
}

/** Descuenta `costo` de una aprobación aprobada (con 10 % de margen). Lanza si no alcanza. */
export async function spendApproval(editId: string, aprobacionId: string, costo: number) {
  await updateEdit(editId, (p) => {
    const a = (p.aprobaciones ?? []).find((x) => x.id === aprobacionId);
    if (!a) throw new PaidError('Esa aprobación no existe: pide una con pedir_aprobacion.', 404);
    if (a.estado !== 'aprobada') throw new PaidError(a.estado === 'pendiente' ? 'La persona aún no ha aprobado el gasto: termina tu turno y espera.' : 'La persona rechazó ese gasto.', 403);
    const saldo = a.montoUSD * 1.1 - a.usadoUSD;
    if (costo > saldo + 1e-6) throw new PaidError(`No alcanza: cuesta ~$${costo.toFixed(3)} y quedan $${Math.max(0, saldo).toFixed(3)} aprobados. Pide otra aprobación.`, 402);
    a.usadoUSD = Number((a.usadoUSD + costo).toFixed(4));
  });
}

async function assertDaily(costo: number) {
  const s = await getSettings();
  await assertWithinDailyLimit(costo, s.dailyLimitUSD);
}

// ── Corregir una palabra (idea 40) ───────────────────────────────────────────

export const CORRECTION_MODEL = 'eleven_multilingual_v2';

export function correctionCost(texto: string) {
  return ttsCost(CORRECTION_MODEL, texto.trim().length);
}

/** Genera el texto con la voz clonada de la persona y devuelve el archivo (dentro de la carpeta de la edición). */
export async function generateCorrection(p: EditProject, o: { texto: string; vozId: string; vozNombre?: string; idioma?: string }) {
  const r = await synthesizeSpeech({ text: o.texto, voiceId: o.vozId, language: o.idioma ?? 'es', modelId: CORRECTION_MODEL, tool: 'video-editor', voiceName: o.vozNombre });
  const name = `correccion-${randomUUID().slice(0, 6)}.mp3`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, name), Buffer.from(r.result.buffer));
  return { archivo: name, costUSD: r.costUSD };
}

// ── Doblaje (idea 39) ────────────────────────────────────────────────────────

export const DUB_LANGS: Record<string, string> = { en: 'inglés', pt: 'portugués', fr: 'francés', it: 'italiano', de: 'alemán', es: 'español' };

export function dubEstimate(seconds: number) {
  const dub = dubbingCost(seconds);
  const stt = sttCost(seconds);
  return { doblaje: dub, transcripcion: stt, total: Number((dub + stt).toFixed(4)) };
}

const API = 'https://api.elevenlabs.io/v1';

async function elevenFetch(url: string, init: RequestInit = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new PaidError('ELEVENLABS_API_KEY no está configurada en frontend/.env.local.', 503);
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), 'xi-api-key': key }, signal: AbortSignal.timeout(180_000) });
}

/** Palabras transcritas → palabras de subtítulo (una «frase» por oración). */
function toSubWords(words: Array<{ text: string; start: number; end: number; type?: string }>): SubWord[] {
  let frase = 0;
  const out: SubWord[] = [];
  for (const w of words) {
    if (w.type && w.type !== 'word') continue;
    const t = w.text.trim();
    if (!t) continue;
    out.push({ t, s: w.start, e: w.end, frase });
    if (/[.!?…]$/.test(t)) frase++;
  }
  return out;
}

/**
 * Doblaje del borrador actual: render sin subtítulos (y con el gancho traducido si se da) →
 * ElevenLabs Dubbing (mantiene música y efectos) → transcripción del audio doblado → subtítulos en
 * el idioma nuevo con el estilo del video → `doblaje-<idioma>-vN.mp4`.
 */
export async function dubDraft(editId: string, o: { idioma: string; gancho?: string; aprobacionId: string }, onStep?: (s: string) => void) {
  const p = await getEdit(editId);
  if (!p.borrador) throw new PaidError('Primero hace falta un borrador.');
  const est = dubEstimate(p.borrador.duracion);
  await assertDaily(est.total);
  await spendApproval(editId, o.aprobacionId, est.total);
  const fail = async (err: unknown) => {
    // Si no llegó a cobrarse, se devuelve el saldo a la aprobación
    await updateEdit(editId, (q) => {
      const a = (q.aprobaciones ?? []).find((x) => x.id === o.aprobacionId);
      if (a) a.usadoUSD = Math.max(0, Number((a.usadoUSD - est.total).toFixed(4)));
    }).catch(() => undefined);
    throw err;
  };

  // 1. Render sin subtítulos
  onStep?.('Render sin subtítulos');
  const q: EditProject = JSON.parse(JSON.stringify(p));
  q.perfil = { ...q.perfil, subtitulos: { ...q.perfil.subtitulos, activo: false }, gancho: { ...q.perfil.gancho, activo: !!o.gancho?.trim() } };
  q.gancho = o.gancho?.trim() ?? '';
  if (q.direccion) {
    q.direccion.subtitulos = { ...(q.direccion.subtitulos ?? {}), activo: false } as typeof q.direccion.subtitulos;
    if (q.direccion.gancho) q.direccion.gancho = { ...q.direccion.gancho, activo: !!o.gancho?.trim() };
    q.direccion.segundoIdioma = undefined;
  }
  let clean: { archivo: string };
  try {
    clean = await renderCopy(p, q, `doblaje-${o.idioma}-base-v${p.borrador.version}`);
  } catch (err) {
    return fail(err);
  }
  const cleanAbs = path.join(/*turbopackIgnore: true*/ p.carpeta, clean.archivo);

  // 2. Doblaje (desde aquí ya se cobra)
  onStep?.('Doblando con ElevenLabs');
  const form = new FormData();
  const bytes = await fs.readFile(cleanAbs);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'video.mp4');
  form.append('target_lang', o.idioma);
  form.append('source_lang', 'es');
  form.append('num_speakers', '1');
  form.append('watermark', 'false');
  form.append('highest_resolution', 'true');
  form.append('name', `${p.titulo} (${o.idioma})`);
  const res = await elevenFetch(`${API}/dubbing`, { method: 'POST', body: form });
  if (!res.ok) return fail(new PaidError(`ElevenLabs rechazó el doblaje (${res.status}): ${(await res.text()).slice(0, 300)}`, 502));
  const { dubbing_id: dubId } = (await res.json()) as { dubbing_id: string };
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await elevenFetch(`${API}/dubbing/${dubId}`);
    const j = (await st.json().catch(() => ({}))) as { status?: string; error?: string };
    if (j.status === 'dubbed') break;
    if (j.status === 'failed') throw new PaidError(`El doblaje falló en ElevenLabs: ${j.error ?? 'sin detalle'}`, 502);
    if (Date.now() - t0 > 40 * 60_000) throw new PaidError(`El doblaje tarda demasiado (id ${dubId}); vuelve a mirar más tarde.`, 504);
  }
  const dl = await elevenFetch(`${API}/dubbing/${dubId}/audio/${o.idioma}`);
  if (!dl.ok) throw new PaidError(`No se pudo descargar el doblaje (${dl.status}).`, 502);
  const isVideo = (dl.headers.get('content-type') ?? '').includes('video');
  const rawName = `doblaje-${o.idioma}-raw${isVideo ? '.mp4' : '.mp3'}`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, rawName), Buffer.from(await dl.arrayBuffer()));
  await recordUsage({
    tool: 'video-editor',
    kind: 'audio',
    provider: 'elevenlabs',
    model: 'dubbing-v1',
    description: `Doblaje a ${DUB_LANGS[o.idioma] ?? o.idioma} · ${p.titulo}`,
    units: Math.round(p.borrador.duracion),
    unit: 'segundos',
    costUSD: est.doblaje,
    estimated: true,
    status: 'ok',
  });

  // 3. Video doblado (si llegó solo audio, se une al video limpio)
  let dubbed = path.join(/*turbopackIgnore: true*/ p.carpeta, rawName);
  if (!isVideo) {
    const muxed = path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}-mux.mp4`);
    await ffmpeg({ cwd: p.carpeta, args: ['-y', '-hide_banner', '-i', cleanAbs, '-i', dubbed, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', muxed] });
    dubbed = muxed;
  }

  // 4. Subtítulos en el idioma nuevo
  onStep?.('Transcribiendo el doblaje');
  const info = await probeVideo(dubbed);
  const wav = path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}.wav`);
  await ffmpeg({ cwd: p.carpeta, args: ['-y', '-hide_banner', '-i', dubbed, '-vn', '-ac', '1', '-ar', '16000', wav] });
  const stt = await transcribeWithElevenLabs(wav, { seconds: info.duracion, tool: 'video-editor', label: `Subtítulos del doblaje (${o.idioma})` });
  const perfil = p.direccion ? directedProfile(normalizeProfile(p.perfil), p.direccion) : normalizeProfile(p.perfil);
  const words = toSubWords(stt.words);
  const subs = buildAss({ perfil: { ...perfil, gancho: { ...perfil.gancho, activo: false } }, words, gancho: '', resaltar: [], duracionFinal: info.duracion });
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}.ass`), subs.ass, 'utf-8');
  const fonts = await stageFonts(p.carpeta);
  const out = `doblaje-${o.idioma}-v${p.borrador.version}.mp4`;
  onStep?.('Subtítulos en el idioma nuevo');
  await ffmpeg({
    cwd: p.carpeta,
    args: ['-y', '-hide_banner', '-i', path.basename(dubbed), '-vf', `subtitles=doblaje-${o.idioma}.ass${fonts ? `:fontsdir=${fonts}` : ''}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out],
    timeoutMs: 15 * 60_000,
  });
  for (const tmp of [wav, path.join(/*turbopackIgnore: true*/ p.carpeta, rawName), cleanAbs, path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}-mux.mp4`)]) await fs.rm(tmp, { force: true }).catch(() => undefined);
  if (fsSync.existsSync(path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}-base-v${p.borrador.version}.jpg`))) {
    await fs.rename(path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}-base-v${p.borrador.version}.jpg`), path.join(/*turbopackIgnore: true*/ p.carpeta, `doblaje-${o.idioma}-v${p.borrador.version}.jpg`)).catch(() => undefined);
  }
  return { archivo: out, duracion: info.duracion, costoUSD: est.total, palabras: words.length };
}
