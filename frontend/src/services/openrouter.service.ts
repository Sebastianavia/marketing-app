import {
  GenerateScriptRequestPayload,
  MarketingScriptOutput,
} from '@/types/openrouter.types';
import { generateObject } from 'ai';
import { z } from 'zod';
import { openrouter } from '@/lib/ai/openrouter';

const marketingScriptSchema = z.object({
  campaignTitle: z.string().describe('Título creativo y descriptivo de la campaña publicitaria'),
  targetAudience: z.string().describe('Definición del avatar del cliente ideal'),
  coreHook: z.string().describe('Gancho principal para detener el scroll en los primeros 3 segundos'),
  scenes: z.array(
    z.object({
      sceneNumber: z.number(),
      timeframe: z.string().describe('Duración sugerida ej: 0:00 - 0:03'),
      hookType: z.enum([
        'curiosity',
        'pain_point',
        'social_proof',
        'controversial',
        'visual_pattern_interrupt',
      ]),
      speakerScript: z.string().describe('Texto exacto que dirá el avatar o locutor'),
      visualDirection: z.string().describe('Indicación de plano, gestos y elementos de fondo'),
      overlayText: z.string().optional().describe('Texto superpuesto en pantalla para reforzar el mensaje'),
    })
  ),
  fullSpokenText: z.string().describe('Texto completo concatenado y pulido para HeyGen'),
  callToAction: z.string().describe('Llamado a la acción final contundente'),
  recommendedDurationSeconds: z.number().default(30),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
});

export class OpenRouterService {
  /**
   * Genera un guion publicitario optimizado para video corto con retorno estructurado.
   */
  async generateMarketingScript(
    payload: GenerateScriptRequestPayload,
    modelName: string = 'anthropic/claude-3.5-sonnet'
  ): Promise<MarketingScriptOutput> {
    const { object } = await generateObject({
      model: openrouter(modelName),
      schema: marketingScriptSchema,
      prompt: `Actúa como un Director Creativo y Copywriter de élite especializado en anuncios de video vertical (TikTok, Instagram Reels, YouTube Shorts).
Crea un guion comercial de alto impacto con las siguientes especificaciones:
- Producto/Servicio: ${payload.productName}
- Descripción: ${payload.productDescription}
- Público Objetivo: ${payload.targetAudience}
- Beneficio Transformador Clave: ${payload.keyBenefit}
- Formato del Anuncio: ${payload.format}
- Duración Objetivo: ${payload.targetDurationSeconds || 30} segundos.

Estructura requerida:
1. Gancho disruptivo (0-3s): Detener el scroll inmediatamente.
2. Agitación del Problema / Deseo (3-12s): Conectar con el dolor real.
3. Solución & Demostración (12-22s): Introducir el producto con claridad.
4. Llamado a la Acción (CTA) (22-30s): Qué acción específica debe tomar el usuario ahora.`,
    });

    return object as MarketingScriptOutput;
  }
}

export const openRouterService = new OpenRouterService();
