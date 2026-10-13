import { ttsCost } from '@/config/cost-rates';
import { getBrollModel, pickBrollDuration } from '@/config/broll-models';
import { estimateSeconds } from './scene-plan';

export interface EstimateInput {
  voiceModelId: string;
  brollModel: string;
  scenes: Array<{ type: 'avatar' | 'broll'; narration: string }>;
}

/** Costo estimado antes de generar (la voz real da los tiempos exactos). */
export function estimateSceneProject(o: EstimateInput) {
  const chars = o.scenes.map((s) => s.narration.trim()).join(' ').length;
  const voice = ttsCost(o.voiceModelId, chars);
  const broll = getBrollModel(o.brollModel);
  let avatarSeconds = 0;
  let brollSeconds = 0;
  let clips = 0;
  for (const s of o.scenes) {
    const secs = estimateSeconds(s.narration) + 0.5;
    if (s.type === 'avatar') avatarSeconds += secs;
    else brollSeconds += pickBrollDuration(broll, Math.ceil(secs));
  }
  clips = avatarSeconds * 0.05 + brollSeconds * broll.pricePerSecond;
  const totalSeconds = o.scenes.reduce((a, s) => a + estimateSeconds(s.narration), 0);
  return {
    voiceUSD: voice,
    clipsUSD: clips,
    totalUSD: voice + clips,
    avatarSeconds,
    brollSeconds,
    totalSeconds,
  };
}
