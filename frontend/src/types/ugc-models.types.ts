export type VideoModelProvider = 'apimart' | 'openrouter';

export type RealismLevel = 'Alto / Fotorrealista' | 'Muy Alto / Cinemático' | 'Alto' | 'Alto / TikTok Native' | 'Muy Alto / Nueva Gen' | 'Cinemático / Texturas';

export interface UgcVideoModel {
  id: string;
  name: string;
  provider: VideoModelProvider;
  providerLabel: 'ApiMart' | 'OpenRouter';
  costPerSecond: number; // in USD
  creditsPerSecond?: number; // for ApiMart credits
  realismLevel: RealismLevel;
  badge: string;
  bestFor: string;
  justification: string;
  recommendedDurationSeconds?: number;
}

export const UGC_VIDEO_MODELS: UgcVideoModel[] = [
  // ==========================================
  // APIMART MODELS
  // ==========================================
  {
    id: 'minimax-hailuo-2.3',
    name: 'MiniMax-Hailuo-2.3',
    provider: 'apimart',
    providerLabel: 'ApiMart',
    costPerSecond: 0.0488,
    creditsPerSecond: 0.488,
    realismLevel: 'Alto / Fotorrealista',
    badge: 'Top Rostros',
    bestFor: 'Rostros humanos ultra-realistas, expresiones naturales y gestos faciales creíbles.',
    justification:
      'La mejor opción global. La familia Hailuo de MiniMax es mundialmente reconocida por generar rostros humanos increíblemente realistas y expresiones naturales. A menos de 5 centavos por segundo, te da una calidad que compite directamente con modelos que cuestan el doble.',
  },
  {
    id: 'kling-v3-omni',
    name: 'Kling v3 Omni',
    provider: 'apimart',
    providerLabel: 'ApiMart',
    costPerSecond: 0.0672,
    creditsPerSecond: 0.672,
    realismLevel: 'Muy Alto / Cinemático',
    badge: 'Física y Objetos',
    bestFor: 'Física de movimiento, interacción de personas con productos u objetos.',
    justification:
      'Kling tiene una de las mejores físicas de movimiento en IA. La versión v3-omni es el punto dulce: es más barata que la 3.0-turbo pero retiene la calidad de la tercera generación. Excelente para tomas de productos o personas interactuando con objetos.',
  },
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0 (ApiMart)',
    provider: 'apimart',
    providerLabel: 'ApiMart',
    costPerSecond: 0.066,
    creditsPerSecond: 0.66,
    realismLevel: 'Alto',
    badge: 'UGC Especializado',
    bestFor: 'Prompts y directivas probadas para anuncios verticales de alta retención.',
    justification:
      'La opción estratégica. Diseñado específicamente para UGC con prompts altamente optimizados y probados para el motor Seedance.',
  },

  // ==========================================
  // OPENROUTER MODELS
  // ==========================================
  {
    id: 'bytedance/seedance-1.5-pro',
    name: 'Seedance 1.5 Pro (ByteDance)',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    costPerSecond: 0.02306,
    realismLevel: 'Alto / TikTok Native',
    badge: 'Rey del Presupuesto',
    bestFor: 'Contenido vertical viral TikTok/Reels con presupuesto ajustado (~$2 por anuncio).',
    justification:
      'El rey del presupuesto UGC. Al ser desarrollado por ByteDance (la empresa matriz de TikTok), este motor está intrínsecamente entrenado para contenido vertical, rostros humanos y estéticas de redes sociales. Es el más económico y cercano al límite de $2.',
  },
  {
    id: 'bytedance/seedance-2.0-fast',
    name: 'Seedance 2.0 Fast (ByteDance)',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    costPerSecond: 0.04035,
    realismLevel: 'Muy Alto / Nueva Gen',
    badge: 'Equilibrio Calidad/Precio',
    bestFor: 'Consistencia facial rigurosa en ojos y boca de los creadores sintéticos.',
    justification:
      'Mejor equilibrio general. Es la versión optimizada de la nueva generación. Mejora drásticamente la consistencia de los ojos y la boca en los avatares sin disparar el precio a los niveles de la versión estándar.',
  },
  {
    id: 'alibaba/wan-2.6',
    name: 'Wan 2.6 (Alibaba)',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    costPerSecond: 0.04,
    realismLevel: 'Cinemático / Texturas',
    badge: 'Mejor para B-Roll',
    bestFor: 'Planos de apoyo de productos, fondos ambientales y tomas de detalle.',
    justification:
      'Ideal para B-Roll de productos. Aunque Seedance suele ser mejor para rostros (UGC), Wan 2.6 es brutalmente económico y excelente para generar los planos de apoyo del anuncio (ej. un producto sobre una mesa, un paisaje urbano de fondo).',
  },
];
