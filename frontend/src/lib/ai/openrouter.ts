import { createOpenAI } from '@ai-sdk/openai';

/**
 * Cliente OpenRouter para Vercel AI SDK
 * Permite invocar modelos como Claude 3.5 Sonnet, Gemini 2.5 Flash, DeepSeek, etc.
 */
export const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  headers: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'X-Title': 'Marketing AI Studio',
  },
});
