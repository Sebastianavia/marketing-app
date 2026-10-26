import { ttsCost } from '@/config/cost-rates';
import { brollRate, getBrollModel, pickBrollDuration, type VoiceMode } from '@/config/broll-models';
import { estimateSeconds } from './scene-plan';

export interface EstimateInput {
  voiceModelId: string;
  brollModel: string;
  voiceMode?: VoiceMode;
  scenes: Array<{ type: 'avatar' | 'broll'; narration: string }>;
}

/** Costo estimado antes de generar (los tiempos reales salen de la voz o de los clips). */
export function estimateSceneProject(o: EstimateInput) {
  const mode = o.voiceMode ?? 'avatar';
  const broll = getBrollModel(o.brollModel);
  const native = mode === 'native';
  const chars = o.scenes.map((s) => s.narration.trim()).join(' ').length;
  const voice = native ? 0 : ttsCost(o.voiceModelId, chars);
  let avatarSeconds = 0;
  let brollSeconds = 0;
  for (const s of o.scenes) {
    const secs = estimateSeconds(s.narration) + 0.5;
    if (s.type === 'avatar' && mode === 'avatar') avatarSeconds += secs;
    else brollSeconds += pickBrollDuration(broll, Math.ceil(secs + (native ? 0.5 : 0)));
  }
  const clips = avatarSeconds * 0.05 + brollSeconds * brollRate(broll, native);
  const totalSeconds = native
    ? brollSeconds
    : o.scenes.reduce((a, s) => a + estimateSeconds(s.narration), 0);
  return { voiceUSD: voice, clipsUSD: clips, totalUSD: voice + clips, avatarSeconds, brollSeconds, totalSeconds };
}
