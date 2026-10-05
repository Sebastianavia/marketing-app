/**
 * Tipos e interfaces para OpenRouter API y generación de guiones de marketing
 * Docs: https://openrouter.ai/docs
 */

export type OpenRouterRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OpenRouterChatMessage {
  role: OpenRouterRole;
  content: string;
  name?: string;
}

export interface OpenRouterCompletionRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OpenRouterChoice {
  index: number;
  message: {
    role: OpenRouterRole;
    content: string;
  };
  finish_reason: string;
}

export interface OpenRouterCompletionResponse {
  id: string;
  model: string;
  created: number;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Estructura tipada para guiones publicitarios de alto impacto (UGC y Ads)
 */
export type HookType = 'curiosity' | 'pain_point' | 'social_proof' | 'controversial' | 'visual_pattern_interrupt';

export interface MarketingScenePlan {
  sceneNumber: number;
  timeframe: string; // ej. "0:00 - 0:03"
  hookType?: HookType;
  speakerScript: string;
  visualDirection: string;
  overlayText?: string;
  soundCue?: string;
}

export interface MarketingScriptOutput {
  campaignTitle: string;
  targetAudience: string;
  coreHook: string;
  scenes: MarketingScenePlan[];
  fullSpokenText: string;
  callToAction: string;
  recommendedDurationSeconds: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
}

export interface GenerateScriptRequestPayload {
  productName: string;
  productDescription: string;
  targetAudience: string;
  keyBenefit: string;
  format: 'ugc_testimonial' | 'founder_story' | 'problem_solution' | 'direct_response';
  targetDurationSeconds?: number;
}
