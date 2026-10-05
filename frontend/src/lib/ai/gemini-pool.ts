/**
 * Gestor de Pool y Rotación de API Keys de Google Gemini
 * Permite failover automático: si una llave llega al límite de cuota (429/Quota Exceeded),
 * el sistema conmuta instantáneamente a la siguiente llave sin interrumpir al usuario.
 */

export function parseGeminiKeys(rawInput?: string): string[] {
  if (!rawInput) return [];
  return rawInput
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 10 && (k.startsWith('AIzaSy') || !k.startsWith('sk-')));
}

export function getGeminiKeyPool(customKeys?: string): string[] {
  const keysSet = new Set<string>();

  // 1. Llaves ingresadas por el usuario en la interfaz
  if (customKeys) {
    parseGeminiKeys(customKeys).forEach((k) => keysSet.add(k));
  }

  // 2. Variable con múltiples llaves separadas por comas en .env.local
  if (process.env.GEMINI_API_KEYS) {
    parseGeminiKeys(process.env.GEMINI_API_KEYS).forEach((k) => keysSet.add(k));
  }

  // 3. Variables de llave única tradicionales
  if (process.env.GEMINI_API_KEY?.trim()) {
    keysSet.add(process.env.GEMINI_API_KEY.trim());
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    keysSet.add(process.env.GOOGLE_GENERATIVE_AI_API_KEY.trim());
  }

  return Array.from(keysSet);
}

export function maskApiKey(key: string): string {
  if (key.length <= 10) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
