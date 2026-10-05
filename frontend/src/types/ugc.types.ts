import { MarketingScriptOutput } from './openrouter.types';
import { HeyGenVideoStatus } from './heygen.types';

export type UgcPipelineStep =
  | 'idle'
  | 'generating_script'
  | 'script_ready'
  | 'synthesizing_assets'
  | 'rendering_video'
  | 'completed'
  | 'error';

export interface UgcPipelineInput {
  productName: string;
  productDescription: string;
  targetAudience: string;
  keyBenefit: string;
  avatarId?: string;
  voiceId?: string;
  format?: 'ugc_testimonial' | 'founder_story' | 'problem_solution';
}

export interface UgcPipelineState {
  step: UgcPipelineStep;
  progressPercent: number;
  script?: MarketingScriptOutput;
  heygenVideoId?: string;
  videoStatus?: HeyGenVideoStatus;
  finalVideoUrl?: string;
  error?: string;
}
