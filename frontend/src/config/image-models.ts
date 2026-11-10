/**
 * Modelos de imagen (Apimart Image API y OpenRouter Image API).
 * - Apimart (POST /v1/images/generations + GET /v1/tasks/{task_id}):
 *   · GPT Image 2 (`gpt-image-2` / `gpt-image-2-ext`): 15 refs (20 MB c/u), 15 proporciones + auto, 1k/2k/4k.
 *   · Nano Banana Pro (`gemini-3-pro-image-preview` / `nano-banana-pro-ext`): 14 refs (30 MB c/u), 11 proporciones, 1K/2K/4K.
 *   · Seedream 5.0 Pro (`seedream-5-0-pro` / `seedream-5.0-pro`): 10 refs (30 MB c/u), 10 proporciones + auto, 1K/1.5K/2K.
 * - OpenRouter (POST /api/v1/images): Seedream 5.0 Flash (10 refs), Nano Banana 2.1 (14 refs), Seedream 4.5 (14 refs).
 */
export type ImageProvider = 'openrouter' | 'apimart';

export interface ImageModelSpec {
  id: string;
  aliases?: string[];
  name: string;
  provider: ImageProvider;
  maxRefs: number;
  /** Tamaño máximo por imagen de referencia en MB. */
  maxRefSizeMB?: number;
  resolutions: string[];
  /** Si el proveedor exige resolution en minúsculas ('1k') o mayúsculas ('1K'). */
  resolutionCase?: 'lower' | 'upper';
  defaultResolution?: string;
  aspectRatios?: readonly string[];
  defaultAspectRatio?: string;
  /** USD estimado por imagen según resolución (el costo real dinámico lo devuelve Apimart en data.cost u OpenRouter en usage.cost). */
  pricePerImage: Record<string, number>;
  /** Créditos estimados por imagen según resolución (Apimart: credits_cost). */
  creditsPerImage?: Record<string, number>;
  /** Mapa opcional size × resolution → dimensiones reales en píxeles. */
  pixelDimensions?: Record<string, Record<string, string>>;
  note: string;
}

export const IMAGE_ASPECTS = ['9:16', '16:9', '1:1', '4:5', '3:4'] as const;

/** 15 proporciones oficiales admitidas por GPT-Image-2 en Apimart (+ auto), con 9:16 primero como predeterminado para redes sociales. */
export const GPT_IMAGE_2_ASPECTS = [
  '9:16',
  '16:9',
  '1:1',
  '4:5',
  '5:4',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21',
  'auto',
] as const;

/** Proporciones oficiales admitidas por Nano Banana Pro (`gemini-3-pro-image-preview`) en Apimart, con 9:16 primero por defecto. */
export const NANO_BANANA_PRO_ASPECTS = [
  '9:16',
  '16:9',
  '1:1',
  '4:5',
  '5:4',
  '3:4',
  '4:3',
  '2:3',
  '3:2',
  '21:9',
  'auto',
] as const;

/** Proporciones oficiales admitidas por Seedream-5.0-Pro (`seedream-5-0-pro`) en Apimart, con 9:16 primero por defecto. */
export const SEEDREAM_5_PRO_ASPECTS = [
  '9:16',
  '16:9',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '21:9',
  'auto',
] as const;

export const SEEDREAM_5_PRO_PIXELS: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024×1024', '1.5K': '1536×1536', '2K': '2048×2048' },
  '4:3': { '1K': '1152×864', '1.5K': '1792×1344', '2K': '2304×1728' },
  '3:4': { '1K': '864×1152', '1.5K': '1344×1792', '2K': '1728×2304' },
  '16:9': { '1K': '1312×736', '1.5K': '2048×1152', '2K': '2560×1440' },
  '9:16': { '1K': '736×1312', '1.5K': '1152×2048', '2K': '1440×2560' },
  '3:2': { '1K': '1248×832', '1.5K': '1872×1248', '2K': '2496×1664' },
  '2:3': { '1K': '832×1248', '1.5K': '1248×1872', '2K': '1664×2496' },
  '2:1': { '1K': '1440×720', '1.5K': '2176×1088', '2K': '2880×1440' },
  '1:2': { '1K': '720×1440', '1.5K': '1088×2176', '2K': '1440×2880' },
  '21:9': { '1K': '1568×672', '1.5K': '2352×1008', '2K': '3024×1296' },
  auto: { '1K': 'Auto (≤1K)', '1.5K': 'Auto (≤1.5K)', '2K': 'Auto (≤2K)' },
};

export const GPT_IMAGE_2_PIXELS: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024×1024', '2K': '2048×2048', '4K': '2880×2880' },
  '3:2': { '1K': '1536×1024', '2K': '2048×1360', '4K': '3520×2336' },
  '2:3': { '1K': '1024×1536', '2K': '1360×2048', '4K': '2336×3520' },
  '4:3': { '1K': '1024×768', '2K': '2048×1536', '4K': '3312×2480' },
  '3:4': { '1K': '768×1024', '2K': '1536×2048', '4K': '2480×3312' },
  '5:4': { '1K': '1280×1024', '2K': '2560×2048', '4K': '3216×2576' },
  '4:5': { '1K': '1024×1280', '2K': '2048×2560', '4K': '2576×3216' },
  '16:9': { '1K': '1536×864', '2K': '2048×1152', '4K': '3840×2160' },
  '9:16': { '1K': '864×1536', '2K': '1152×2048', '4K': '2160×3840' },
  '2:1': { '1K': '2048×1024', '2K': '2688×1344', '4K': '3840×1920' },
  '1:2': { '1K': '1024×2048', '2K': '1344×2688', '4K': '1920×3840' },
  '3:1': { '1K': '1881×836', '2K': '3072×1024', '4K': '3840×1280' },
  '1:3': { '1K': '887×1774', '2K': '1024×3072', '4K': '1280×3840' },
  '21:9': { '1K': '2016×864', '2K': '2688×1152', '4K': '3840×1648' },
  '9:21': { '1K': '864×2016', '2K': '1152×2688', '4K': '1648×3840' },
  auto: { '1K': '1024×1024 (auto)', '2K': '2048×2048 (auto)', '4K': '2880×2880 (auto)' },
};

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: 'gpt-image-2',
    aliases: ['gpt-image-2-ext'],
    name: 'GPT Image 2 (Apimart)',
    provider: 'apimart',
    maxRefs: 15,
    maxRefSizeMB: 20,
    resolutions: ['1K', '2K', '4K'],
    resolutionCase: 'lower',
    defaultResolution: '2K',
    aspectRatios: GPT_IMAGE_2_ASPECTS,
    defaultAspectRatio: '9:16',
    // Precio de lista de GET https://api.apimart.ai/api/pricing/model?model=gpt-image-2 (8 nov 2026): 1K 0.0085 pagado
    // con el 20 % de descuento de la cuenta → 0.010625 de lista. Se estima por lo alto; el real llega en data.cost.
    pricePerImage: { '1K': 0.010625, '2K': 0.01875, '4K': 0.0275 },
    creditsPerImage: { '1K': 0.10625, '2K': 0.1875, '4K': 0.275 },
    pixelDimensions: GPT_IMAGE_2_PIXELS,
    note: 'Apimart (asíncrono): hasta 15 referencias (URL o base64, máx. 20 MB c/u), 15 proporciones (9:16 vertical por defecto) y salida hasta 4K.',
  },
  {
    id: 'gemini-3-pro-image-preview',
    aliases: ['nano-banana-pro-ext'],
    name: 'Nano Banana Pro (Apimart)',
    provider: 'apimart',
    maxRefs: 14,
    maxRefSizeMB: 30,
    resolutions: ['1K', '2K', '4K'],
    resolutionCase: 'upper',
    defaultResolution: '1K',
    aspectRatios: NANO_BANANA_PRO_ASPECTS,
    defaultAspectRatio: '9:16',
    // Tarifas por nivel de resolución en Apimart (el costo exacto dinámico llega en data.cost y data.credits_cost al completar la tarea)
    pricePerImage: { '1K': 0.068, '2K': 0.102, '4K': 0.155 },
    creditsPerImage: { '1K': 0.68, '2K': 1.02, '4K': 1.55 },
    note: 'Apimart (Gemini 3 Pro Image · alias nano-banana-pro-ext): hasta 14 imágenes de referencia (máx. 30 MB c/u) y resolución 1K/2K/4K.',
  },
  {
    id: 'gemini-3-pro-image-preview-official',
    aliases: ['nano-banana-pro'],
    name: 'Nano Banana Pro Oficial (Apimart)',
    provider: 'apimart',
    maxRefs: 14,
    maxRefSizeMB: 30,
    resolutions: ['1K', '2K', '4K'],
    resolutionCase: 'upper',
    defaultResolution: '1K',
    aspectRatios: NANO_BANANA_PRO_ASPECTS,
    defaultAspectRatio: '9:16',
    pricePerImage: { '1K': 0.068, '2K': 0.102, '4K': 0.155 },
    creditsPerImage: { '1K': 0.68, '2K': 1.02, '4K': 1.55 },
    note: 'Apimart Canal Oficial (alias nano-banana-pro): hasta 14 imágenes de referencia (máx. 30 MB c/u) y resolución 1K/2K/4K.',
  },
  {
    id: 'seedream-5-0-pro',
    aliases: ['seedream-5.0-pro'],
    name: 'Seedream 5.0 Pro (Apimart)',
    provider: 'apimart',
    maxRefs: 10,
    maxRefSizeMB: 30,
    resolutions: ['1K', '1.5K', '2K'],
    resolutionCase: 'upper',
    defaultResolution: '1.5K',
    aspectRatios: SEEDREAM_5_PRO_ASPECTS,
    defaultAspectRatio: '9:16',
    // ≤ 2.61M px (1K y 1.5K) = $0.045/imagen; > 2.61M px (2K) = $0.09/imagen. 1.5K cuesta lo mismo que 1K con mejor calidad.
    pricePerImage: { '1K': 0.045, '1.5K': 0.045, '2K': 0.09 },
    creditsPerImage: { '1K': 0.45, '1.5K': 0.45, '2K': 0.9 },
    pixelDimensions: SEEDREAM_5_PRO_PIXELS,
    note: 'Apimart (Seedream 5.0 Pro): hasta 10 referencias (máx. 30 MB c/u; 1.ª ref gratis), resoluciones 1K/1.5K/2K (1.5K cuesta igual que 1K: $0.045) y 10 proporciones (9:16 por defecto).',
  },
  {
    id: 'bytedance-seed/seedream-5-0-flash',
    name: 'Seedream 5.0 Flash (OpenRouter)',
    provider: 'openrouter',
    maxRefs: 10,
    maxRefSizeMB: 10,
    resolutions: ['1K', '2K'],
    aspectRatios: IMAGE_ASPECTS,
    defaultAspectRatio: '9:16',
    // $0.018 por imagen; las imágenes de entrada no se cobran
    pricePerImage: { '1K': 0.018, '2K': 0.018 },
    note: 'El más barato: $0.018 por imagen, referencias gratis. Máximo 10 referencias (avatar + extras).',
  },
  {
    id: 'google/gemini-nano-banana-2.1',
    name: 'Nano Banana 2.1 (OpenRouter)',
    provider: 'openrouter',
    maxRefs: 14,
    maxRefSizeMB: 10,
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: IMAGE_ASPECTS,
    defaultAspectRatio: '9:16',
    // $30 por millón de tokens de salida: 1K ≈ $0.0336, 2K ≈ $0.0504, 4K ≈ $0.113 (precios de Google)
    pricePerImage: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 },
    note: 'Google vía OpenRouter, bueno recontextualizando productos. Desde $0.034.',
  },
  {
    id: 'bytedance-seed/seedream-4.5',
    name: 'Seedream 4.5 (OpenRouter)',
    provider: 'openrouter',
    maxRefs: 14,
    maxRefSizeMB: 10,
    // El proveedor exige al menos 3.686.400 píxeles de salida: 1K no se admite.
    resolutions: ['2K', '4K'],
    aspectRatios: IMAGE_ASPECTS,
    defaultAspectRatio: '9:16',
    pricePerImage: { '2K': 0.04, '4K': 0.04 },
    note: '$0.04 por imagen, hasta 4K y 14 referencias: úsalo si tu avatar tiene más de 10 fotos.',
  },
];

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

export function isValidImageModelId(id: string | undefined): boolean {
  if (!id) return false;
  return IMAGE_MODELS.some((m) => m.id === id || m.aliases?.includes(id));
}

export function getImageModel(id: string | undefined): ImageModelSpec {
  if (!id) return IMAGE_MODELS[0];
  return IMAGE_MODELS.find((m) => m.id === id || m.aliases?.includes(id)) ?? IMAGE_MODELS[0];
}

export function getModelAspectRatios(spec: ImageModelSpec): readonly string[] {
  return spec.aspectRatios ?? IMAGE_ASPECTS;
}

export function getModelPixelDimensions(spec: ImageModelSpec, aspect: string, resolution: string): string | null {
  return spec.pixelDimensions?.[aspect]?.[resolution] ?? null;
}

/** Indicación opcional para máximo realismo (se añade al final del prompt y se ve en pantalla). */
export const REALISM_SUFFIX =
  'Fotografía hiperrealista, aspecto de foto real tomada con cámara profesional, iluminación natural, texturas de piel y materiales detalladas, sin aspecto de ilustración ni 3D.';
