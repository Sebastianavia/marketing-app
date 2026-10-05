/**
 * Catálogo de Modelos de Video UGC con Soporte Multi-Proveedor (APIMart y OpenRouter)
 * Arquitectura desacoplada y fuertemente tipada con especificaciones exactas
 * de la documentación oficial (duración mínima, máxima por clip y modos de composición).
 */

export interface AIModelConfig {
  id: string; // identificador exacto para el payload de la API
  name: string; // nombre comercial
  provider: 'apimart' | 'openrouter';
  costPerSecondUSD: number; // tarifa por segundo en USD
  category: 'talking-head' | 'b-roll' | 'cinematic';
  tag: 'Mejor Presupuesto' | 'Ultra Realista' | 'B-Roll' | string;
  description: string; // justificación de uso
  recommendedPerformance: string; // ej. "Ideal para ganchos de 3s" o "Óptimo para planos secundarios"

  // ESPECIFICACIONES EXACTAS DE LA DOCUMENTACIÓN OFICIAL (APIMart & OpenRouter)
  apiMinDurationSeconds: number; // Mínimo aceptado por la API (ej: 4s)
  apiMaxClipDurationSeconds: number; // Máximo aceptado en una sola llamada de API (ej: 15s para Kling/Hailuo/Seedance; 10s para Wan)
  apiDefaultDurationSeconds: number; // Duración recomendada por defecto (ej: 5s o 6s)
  supportedClipDurations: number[]; // Presets de tomas nativas soportadas por la API
  multiClipCompositionSupported: boolean; // Indica si para duraciones mayores (30s, 60s, 120s) se compone mediante tomas concatenadas
}

export const UGC_MODELS_CATALOG: AIModelConfig[] = [
  // ===========================================================================
  // BLOQUE 1: APIMART (Documentación Oficial: docs.apimart.ai)
  // ===========================================================================
  {
    id: 'minimax-hailuo-2.3',
    name: 'MiniMax-Hailuo-2.3',
    provider: 'apimart',
    costPerSecondUSD: 0.0488,
    category: 'talking-head',
    tag: 'Ultra Realista',
    description:
      'La mejor opción global. La familia Hailuo de MiniMax es mundialmente reconocida por generar rostros humanos con expresiones naturales y gestos creíbles.',
    recommendedPerformance: 'Ideal para ganchos de 3-5s y testimonios frontales de alta credibilidad.',
    apiMinDurationSeconds: 4,
    apiMaxClipDurationSeconds: 15,
    apiDefaultDurationSeconds: 6,
    supportedClipDurations: [5, 10, 15],
    multiClipCompositionSupported: true,
  },
  {
    id: 'kling-v3-omni',
    name: 'kling-v3-omni',
    provider: 'apimart',
    costPerSecondUSD: 0.0672,
    category: 'cinematic',
    tag: 'Ultra Realista',
    description:
      'Kling tiene una de las mejores físicas de movimiento en IA. Punto dulce entre costo y cinemática para interacción fluida de personas con productos u objetos.',
    recommendedPerformance: 'Óptimo para planos dinámicos, unboxing e interacción física con productos.',
    apiMinDurationSeconds: 3,
    apiMaxClipDurationSeconds: 15,
    apiDefaultDurationSeconds: 5,
    supportedClipDurations: [5, 10, 15],
    multiClipCompositionSupported: true,
  },
  {
    id: 'seedance-2.0',
    name: 'seedance-2.0',
    provider: 'apimart',
    costPerSecondUSD: 0.066,
    category: 'talking-head',
    tag: 'Ultra Realista',
    description:
      'La opción estratégica para UGC vertical. Diseñado y calibrado específicamente para directivas y prompts orientados a retención de audiencia.',
    recommendedPerformance: 'Especial para anuncios verticales nativos con ritmo acelerado.',
    apiMinDurationSeconds: 4,
    apiMaxClipDurationSeconds: 15,
    apiDefaultDurationSeconds: 5,
    supportedClipDurations: [5, 10, 15],
    multiClipCompositionSupported: true,
  },

  // ===========================================================================
  // BLOQUE 2: OPENROUTER (Documentación Oficial: openrouter.ai/docs/videos)
  // ===========================================================================
  {
    id: 'bytedance/seedance-1.5-pro',
    name: 'ByteDance: Seedance 1.5 Pro',
    provider: 'openrouter',
    costPerSecondUSD: 0.02306,
    category: 'talking-head',
    tag: 'Mejor Presupuesto',
    description:
      'El rey del presupuesto UGC. Desarrollado por ByteDance (TikTok), altamente optimizado para estética social y costes menores a $2 por anuncio completo.',
    recommendedPerformance: 'Ideal para ganchos rápidos de 3s y pruebas A/B masivas de bajo presupuesto.',
    apiMinDurationSeconds: 5,
    apiMaxClipDurationSeconds: 15,
    apiDefaultDurationSeconds: 5,
    supportedClipDurations: [5, 10, 15],
    multiClipCompositionSupported: true,
  },
  {
    id: 'bytedance/seedance-2.0-fast',
    name: 'ByteDance: Seedance 2.0 Fast',
    provider: 'openrouter',
    costPerSecondUSD: 0.04035,
    category: 'talking-head',
    tag: 'Ultra Realista',
    description:
      'Mejor equilibrio calidad/precio. Gran consistencia facial en ojos y boca de los creadores sintéticos sin disparar costos de renderizado.',
    recommendedPerformance: 'Óptimo para creadores sintéticos recurrentes y pitchs de venta directos.',
    apiMinDurationSeconds: 5,
    apiMaxClipDurationSeconds: 15,
    apiDefaultDurationSeconds: 5,
    supportedClipDurations: [5, 10, 15],
    multiClipCompositionSupported: true,
  },
  {
    id: 'alibaba/wan-2.6',
    name: 'Alibaba: Wan 2.6',
    provider: 'openrouter',
    costPerSecondUSD: 0.04,
    category: 'b-roll',
    tag: 'B-Roll',
    description:
      'Especialista en B-Roll y texturas. Genera planos de detalle de productos sobre mesas, texturas de empaques y fondos ambientales hiperrealistas.',
    recommendedPerformance: 'Óptimo para planos secundarios, tomas macro de producto y cortes de apoyo.',
    apiMinDurationSeconds: 5,
    apiMaxClipDurationSeconds: 10, // Wan genera clips de 5 a 10s según documentación oficial
    apiDefaultDurationSeconds: 5,
    supportedClipDurations: [5, 10],
    multiClipCompositionSupported: true,
  },
];

export const DEFAULT_UGC_MODEL: AIModelConfig = UGC_MODELS_CATALOG[0];

export function getModelById(id: string): AIModelConfig | undefined {
  return UGC_MODELS_CATALOG.find((m) => m.id === id);
}

export function getModelsByProvider(provider: 'apimart' | 'openrouter'): AIModelConfig[] {
  return UGC_MODELS_CATALOG.filter((m) => m.provider === provider);
}

export function getModelsByCategory(
  category: 'talking-head' | 'b-roll' | 'cinematic'
): AIModelConfig[] {
  return UGC_MODELS_CATALOG.filter((m) => m.category === category);
}

/**
 * Calcula la descomposición técnica de clips según la documentación de la API.
 * Si la duración solicitada supera el máximo permitido en una sola llamada de API,
 * calcula cuántas tomas individuales se concatenarán en el pipeline UGC.
 */
export function getClipBreakdown(durationSeconds: number, model: AIModelConfig) {
  const maxClip = model.apiMaxClipDurationSeconds;
  const isDirectSingleClip = durationSeconds <= maxClip;

  if (isDirectSingleClip) {
    return {
      isDirectSingleClip: true,
      totalClips: 1,
      clipDurationSeconds: durationSeconds,
      summary: `Toma continua directa (${durationSeconds}s)`,
      apiNotice: `Compatible con API nativa (límite: ${maxClip}s por toma).`,
    };
  }

  // Composición multi-toma para anuncios UGC (15s, 30s, 60s, 120s)
  const totalClips = Math.ceil(durationSeconds / maxClip);
  const avgClipDuration = Math.round(durationSeconds / totalClips);

  return {
    isDirectSingleClip: false,
    totalClips,
    clipDurationSeconds: avgClipDuration,
    summary: `${totalClips} escenas de ~${avgClipDuration}s concatenadas`,
    apiNotice: `Multi-toma: La API genera hasta ${maxClip}s por llamada; el pipeline concatena ${totalClips} escenas.`,
  };
}
