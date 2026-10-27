import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_STT_MODEL, sttCost } from '@/config/cost-rates';
import { getSettings } from '@/lib/data/settings';
import { assertWithinDailyLimit, recordUsage } from '@/lib/usage/usage-store';

/**
 * Voz a texto con ElevenLabs Speech to Text (Scribe v2, API directa, de pago: $0.22 por hora de audio).
 * Tiempos por palabra. Respeta el límite diario y registra el costo en Costos (tipo "Transcripción").
 * Lo usa "video desde mi audio" del modo Director, siempre tras un clic de la persona.
 */

export interface SttWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

export async function transcribeWithElevenLabs(
  file: string,
  o: { seconds: number; productionId?: string; tool?: string; label?: string }
): Promise<{ words: SttWord[]; text: string; costUSD: number; model: string }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY no está configurada en frontend/.env.local. Añádela y reinicia el servidor.');
  const model = DEFAULT_STT_MODEL;
  const costUSD = sttCost(o.seconds, model);
  const settings = await getSettings();
  await assertWithinDailyLimit(costUSD, settings.dailyLimitUSD);

  const bytes = await fs.readFile(file);
  const name = path.basename(file);
  const form = new FormData();
  form.append('model_id', model);
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([new Uint8Array(bytes)], { type: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream' }), name);

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(
      res.status === 401
        ? 'La clave de ElevenLabs no tiene permiso de Speech to Text. Revisa ELEVENLABS_API_KEY.'
        : `ElevenLabs no pudo transcribir (${res.status}). ${detail}`
    );
  }
  const data = (await res.json()) as { text?: string; words?: SttWord[] };
  await recordUsage({
    tool: o.tool ?? 'text-to-video',
    kind: 'transcription',
    provider: 'elevenlabs',
    model,
    description: `Transcripción · ${o.label ?? name} (${Math.round(o.seconds)} s)`,
    units: Math.round(o.seconds),
    unit: 'segundos',
    costUSD,
    estimated: true,
    productionId: o.productionId,
  });
  return { words: data.words ?? [], text: data.text ?? '', costUSD, model };
}
