/**
 * Modelos de imagen (Apimart Image API y OpenRouter Image API).
 * - Apimart (POST /v1/images/generations + GET /v1/tasks/{task_id}):
 *   · GPT Image 2 (`gpt-image-2` / `gpt-image-2-ext`): 15 refs (20 MB c/u), 15 proporciones + auto, 1k/2k/4k.
 *   · Nano Banana Pro (`gemini-3-pro-image-preview` / `nano-banana-pro-ext`): 14 refs (30 MB c/u), 11 proporciones, 1K/2K/4K.
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
    // Tarifas por nivel de resolución en Apimart (el valor exacto dinámico llega en data.cost y data.credits_cost al completar la tarea)
    pricePerImage: { '1K': 0.0352, '2K': 0.05279, '4K': 0.10558 },
    creditsPerImage: { '1K': 0.352, '2K': 0.5279, '4K': 1.0558 },
    pixelDimensions: GPT_IMAGE_2_PIXELS,
    note: 'Apimart (asíncrono): hasta 15 referencias (URL o base64, máx. 20 MB c/u), 15 proporciones (9:16 vertical por defecto) y salida hasta 4K.',
  },
  {
    id: 'gemini-3-pro-image-preview',
    aliases: ['nano-banana-pro-ext', 'gemini-3-pro-image-preview-official', 'nano-banana-pro'],
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
    note: 'Apimart (Gemini 3 Pro Image): creación profesional de alta calidad, hasta 14 imágenes de referencia (máx. 30 MB c/u) y resolución 1K/2K/4K.',
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
