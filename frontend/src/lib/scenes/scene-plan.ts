import { z } from 'zod';

/** Lo que devuelve el orquestador al armar las escenas. */
export const ScenePlanSchema = z.object({
  title: z.string().describe('Título corto del video (máximo 60 caracteres)'),
  scenes: z
    .array(
      z.object({
        type: z.enum(['avatar', 'broll']).describe("'avatar' = la persona habla a cámara; 'broll' = toma de apoyo sin la persona hablando"),
        narration: z.string().describe('Texto exacto que dice la voz durante esta escena'),
        visualPrompt: z
          .string()
          .describe("Para 'broll': descripción visual de la toma (sujeto, acción, plano, luz, movimiento de cámara). Para 'avatar': cadena vacía."),
      })
    )
    .min(1)
    .max(20),
});

export type ScenePlan = z.infer<typeof ScenePlanSchema>;

/** Palabras sin puntuación, mayúsculas ni etiquetas: para comprobar que no se cambió el guion. */
export function normalizeWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Estimación de segundos de locución (~15 caracteres por segundo, como en el resto de la app). */
export function estimateSeconds(text: string): number {
  return Math.max(1, text.replace(/\[[^\]]*\]/g, '').trim().length / 15);
}
