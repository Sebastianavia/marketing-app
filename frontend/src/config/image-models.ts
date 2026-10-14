/**
 * Modelos de imagen (OpenRouter Image API, POST /api/v1/images).
 * Datos de /api/v1/images/models y /endpoints, consultados el 13 oct 2026.
 * Todos aceptan hasta 14 imágenes de referencia (input_references).
 */
export interface ImageModelSpec {
  id: string;
  name: string;
  maxRefs: number;
  resolutions: string[];
  /** USD estimado por imagen según resolución (el costo real lo devuelve OpenRouter en usage.cost). */
  pricePerImage: Record<string, number>;
  note: string;
}

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: 'bytedance-seed/seedream-5-0-flash',
    name: 'Seedream 5.0 Flash',
    maxRefs: 14,
    resolutions: ['1K', '2K'],
    // $0.018 por imagen; las imágenes de entrada no se cobran
    pricePerImage: { '1K': 0.018, '2K': 0.018 },
    note: 'El más barato: $0.018 por imagen, referencias gratis.',
  },
  {
    id: 'google/gemini-nano-banana-2.1',
    name: 'Nano Banana 2.1 (Google)',
    maxRefs: 14,
    resolutions: ['1K', '2K', '4K'],
    // $30 por millón de tokens de salida: 1K ≈ $0.0336, 2K ≈ $0.0504, 4K ≈ $0.113 (precios de Google)
    pricePerImage: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 },
    note: 'Google, bueno recontextualizando productos. Desde $0.034.',
  },
  {
    id: 'bytedance-seed/seedream-4.5',
    name: 'Seedream 4.5',
    maxRefs: 14,
    resolutions: ['1K', '2K', '4K'],
    pricePerImage: { '1K': 0.04, '2K': 0.04, '4K': 0.04 },
    note: '$0.04 por imagen, hasta 4K.',
  },
];

export const DEFAULT_IMAGE_MODEL = 'bytedance-seed/seedream-5-0-flash';

export const IMAGE_ASPECTS = ['1:1', '4:5', '3:4', '9:16', '16:9'] as const;

export function getImageModel(id: string | undefined): ImageModelSpec {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

/** Indicación opcional para máximo realismo (se añade al final del prompt y se ve en pantalla). */
export const REALISM_SUFFIX =
  'Fotografía hiperrealista, aspecto de foto real tomada con cámara profesional, iluminación natural, texturas de piel y materiales detalladas, sin aspecto de ilustración ni 3D.';
