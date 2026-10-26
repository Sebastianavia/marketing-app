import { elevenLabsService, resolveElevenModelId } from '@/services/elevenlabs/elevenlabs.service';
import type { ElevenLabsVoiceSettings } from '@/types/elevenlabs.types';
import { saveGenerated } from '@/lib/storage/generated-library';
import { assertWithinDailyLimit, recordUsage } from '@/lib/usage/usage-store';
import { getSettings } from '@/lib/data/settings';
import { ttsCost } from '@/config/cost-rates';

/**
 * Locución con ElevenLabs, compartida por la ruta /api/elevenlabs/tts (Voice Studio, Avatar Studio)
 * y el Director. Todo lo generado se guarda en la biblioteca y se registra en Costos.
 */

export interface SpeechRequest {
  text: string;
  voiceId?: string;
  language?: string;
  modelId?: string;
  voiceSettings?: Partial<ElevenLabsVoiceSettings>;
  /** Herramienta que aparece en Costos. */
  tool?: string;
  voiceName?: string;
  productionId?: string;
}

function usageDescription(language: string, voiceName: string | undefined, text: string, characters: number) {
  return `Locución ${language.toUpperCase()}${voiceName ? ` · ${voiceName}` : ''} · "${text.trim().slice(0, 60)}${characters > 60 ? '…' : ''}"`;
}

async function saveToLibrary(buffer: Buffer, id: string): Promise<string | undefined> {
  // Todo lo generado se guarda en la biblioteca, aunque no se pulse "Guardar proyecto"
  try {
    return await saveGenerated('audio', buffer, 'mp3', id);
  } catch (saveErr) {
    console.warn('[TTS] No se pudo guardar el MP3 en la biblioteca:', saveErr);
    return undefined;
  }
}

/** Lanza DailyLimitError si la locución superaría el límite diario (costo de catálogo por caracteres). */
async function assertVoiceWithinDailyLimit(text: string, modelId: string | undefined) {
  const settings = await getSettings();
  await assertWithinDailyLimit(ttsCost(resolveElevenModelId(modelId), text.trim().length), settings.dailyLimitUSD);
}

/**
 * Voz con el SDK de ElevenLabs. Lanza DailyLimitError si superaría el límite diario
 * y ElevenLabsTTSError (con httpStatus y code) si falla la síntesis.
 */
export async function synthesizeSpeech(req: SpeechRequest) {
  const language = req.language ?? 'es';
  const tool = req.tool ?? 'voice-studio';
  await assertVoiceWithinDailyLimit(req.text, req.modelId);
  const result = await elevenLabsService.generateAudio(req.text, req.voiceId, language, req.modelId, req.voiceSettings);

  const effectiveModel = result.modelId || req.modelId || 'desconocido';
  const filePath = await saveToLibrary(Buffer.from(result.buffer), crypto.randomUUID());

  const characters = result.charactersBilled ?? req.text.trim().length;
  const costUSD = ttsCost(effectiveModel, characters);
  await recordUsage({
    tool: String(tool),
    kind: 'audio',
    provider: 'elevenlabs',
    model: effectiveModel,
    description: usageDescription(language, req.voiceName, req.text, characters),
    units: characters,
    unit: 'caracteres',
    costUSD,
    estimated: true,
    filePath,
    productionId: req.productionId,
  });

  return { result, effectiveModel, filePath, characters, costUSD };
}

/**
 * Voz con tiempos por carácter (para subtítulos y para medir la duración real).
 * La usa el Director; duración = fin del último carácter.
 */
export async function synthesizeSpeechWithTimestamps(req: SpeechRequest & { voiceId: string; modelId: string }) {
  const language = req.language ?? 'es';
  await assertVoiceWithinDailyLimit(req.text, req.modelId);
  const result = await elevenLabsService.generateWithTimestamps(req.text, req.voiceId, req.modelId, req.voiceSettings ?? {});
  const filePath = await saveToLibrary(result.buffer, crypto.randomUUID());
  const characters = result.charactersBilled;
  const costUSD = ttsCost(result.modelId, characters);
  await recordUsage({
    tool: req.tool ?? 'director',
    kind: 'audio',
    provider: 'elevenlabs',
    model: result.modelId,
    description: usageDescription(language, req.voiceName, req.text, characters),
    units: characters,
    unit: 'caracteres',
    costUSD,
    estimated: true,
    filePath,
    productionId: req.productionId,
  });
  const ends = result.alignment?.ends ?? [];
  const durationSec = ends.length ? ends[ends.length - 1] : null;
  return { ...result, filePath, characters, costUSD, durationSec };
}
