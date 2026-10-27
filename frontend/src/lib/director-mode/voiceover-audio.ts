import fs from 'fs/promises';
import path from 'path';
import { FreeQuotaError, orchestrateObject } from '@/lib/ai/orchestrator';
import { makeTempDir, runFfmpeg } from '@/lib/video/ffmpeg';
import { ProductionError } from '@/lib/director/production-store';
import { transcriptionPrompt } from './prompts';
import { TranscriptSchema } from './schemas';
import { cleanPhrases, parseSilences, type Silence } from './voiceover';
import type { VoiceoverPhrase } from './types';

/**
 * Locución propia, parte con archivos: silencios con FFmpeg y transcripción con Gemini gratis.
 * ($0; con "confidencial" no se llama a Gemini: solo ElevenLabs, con clic.)
 */

/** Silencios de al menos 0,25 s por debajo de -35 dB. */
export async function detectSilences(file: string): Promise<Silence[]> {
  const stderr = await runFfmpeg(['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.25', '-f', 'null', '-'], 2 * 60 * 1000);
  return parseSilences(stderr);
}

/** Audio pequeño para la IA: mono, 16 kHz, 32 kbps (10 min ≈ 2,4 MB). */
async function compactAudio(file: string): Promise<Buffer> {
  const dir = await makeTempDir('lulo-locucion-');
  const out = path.join(/*turbopackIgnore: true*/ dir, 'locucion.mp3');
  try {
    await runFfmpeg(['-y', '-hide_banner', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], 2 * 60 * 1000);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Frases con tiempos aproximados (Gemini gratis, siempre en modo gratis aunque el selector diga Claude). */
export async function transcribeWithGemini(file: string, totalSeg: number): Promise<{ frases: VoiceoverPhrase[]; modelo: string }> {
  const audio = await compactAudio(file);
  try {
    const built = transcriptionPrompt(totalSeg);
    const { object, meta } = await orchestrateObject({
      tool: 'text-to-video',
      description: 'Director · transcribir locución',
      system: built.system,
      prompt: built.prompt,
      files: [{ data: new Uint8Array(audio), mediaType: 'audio/mpeg', filename: 'locucion.mp3' }],
      schema: TranscriptSchema,
      temperature: 0,
      // Claude no oye audio: la transcripción gratis siempre va por Gemini
      mode: 'free',
      confidential: false,
    });
    return { frases: cleanPhrases(object.frases, totalSeg), modelo: meta.model };
  } catch (err) {
    if (err instanceof FreeQuotaError || (err as { code?: string })?.code === 'free_exhausted') {
      throw new ProductionError('Gemini gratis no respondió ahora. Prueba en un rato o usa la transcripción precisa de ElevenLabs (de pago).', 503);
    }
    throw err;
  }
}
