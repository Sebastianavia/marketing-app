import { z } from 'zod';

/** Respuestas de la IA en formato fijo. Los límites exactos (2 preguntas, 3 opciones) los aplica el código. */

export const QuestionsSchema = z.object({
  preguntas: z
    .array(
      z.object({
        pregunta: z.string().describe('Pregunta corta de dirección, en español'),
        opciones: z.array(z.string()).describe('Exactamente 3 opciones cortas (2 a 8 palabras)'),
      })
    )
    .describe('Exactamente 2 preguntas'),
});

const SceneShape = z.object({
  tipo: z.enum(['avatar', 'broll']).describe("'avatar' = la persona habla a cámara (HeyGen); 'broll' = toma de apoyo"),
  duracionSeg: z.number().describe('Duración en segundos, solo entre las admitidas'),
  queSeVe: z.string().describe('Qué se ve: una toma concreta y filmable'),
  dialogo: z.string().describe('Texto exacto que se dice en la escena; puede ir vacío'),
});

export const ScriptSchema = z.object({
  titulo: z.string().describe('Título corto del video (máximo 60 caracteres)'),
  escenas: z.array(SceneShape).min(1).max(20),
});

export const OneSceneSchema = z.object({ escena: SceneShape });

export const PromptsSchema = z.object({
  prompts: z.array(
    z.object({
      orden: z.number().describe('Número de la escena'),
      prompt: z.string().describe('Prompt de video en inglés'),
    })
  ),
});

export const OnePromptSchema = z.object({ prompt: z.string().describe('Prompt de video en inglés') });

// ---------- Lo que manda la interfaz ----------

const Aspect = z.enum(['9:16', '16:9', '1:1']);

export const InputBody = z.object({
  tipo: z.enum(['guion', 'idea', 'pdf']),
  texto: z.string().max(20_000).default(''),
  mantenerPalabras: z.boolean().default(false),
  confidencial: z.boolean().default(false),
  pdfBase64: z.string().max(30_000_000).optional(),
  pdfNombre: z.string().max(200).optional(),
  /** Solo al crear: plantilla de la caja de inicio. */
  skill: z.enum(['pelicula', 'ugc', 'presentador', 'explicativo']).optional(),
});

export const SettingsBody = z.object({
  formato: Aspect,
  duracionSeg: z.number().int().min(5).max(180),
  modoVoz: z.enum(['voiceover', 'native', 'avatar']),
  modeloBroll: z.string().min(1).max(100),
  avatarId: z.string().max(100).nullable(),
  presupuestoUSD: z.number().min(0.1).max(100),
});

const SceneEdit = z.object({
  tipo: z.enum(['avatar', 'broll']).optional(),
  duracionSeg: z.number().min(0.5).max(120).optional(),
  queSeVe: z.string().max(2000).optional(),
  dialogo: z.string().max(2000).optional(),
});

const Stage = z.enum(['idea', 'preguntas', 'ajustes', 'guion', 'prompts']);

/** Acciones sobre una producción en modo Director. `orchestrator` lo añade postOrchestrated al aceptar Claude. */
export const ActionBody = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('guardar_idea'), entrada: InputBody }),
  z.object({ accion: z.literal('generar_preguntas') }),
  z.object({ accion: z.literal('responder_preguntas'), respuestas: z.record(z.string(), z.string().max(500)) }),
  z.object({ accion: z.literal('saltar_preguntas') }),
  z.object({ accion: z.literal('guardar_ajustes'), ajustes: SettingsBody }),
  z.object({ accion: z.literal('generar_guion') }),
  z.object({ accion: z.literal('rehacer_escena'), escenaId: z.string().max(20), indicacion: z.string().max(1000).default('') }),
  z.object({ accion: z.literal('editar_escena'), escenaId: z.string().max(20), cambios: SceneEdit }),
  z.object({ accion: z.literal('generar_prompts'), soloFaltantes: z.boolean().default(false) }),
  z.object({ accion: z.literal('rehacer_prompt'), escenaId: z.string().max(20), indicacion: z.string().max(1000).default('') }),
  z.object({ accion: z.literal('editar_prompt'), escenaId: z.string().max(20), texto: z.string().min(1).max(4000) }),
  z.object({ accion: z.literal('aprobar'), etapa: Stage }),
]);

export type ActionInput = z.infer<typeof ActionBody>;
export type InputBodyInput = z.infer<typeof InputBody>;
export type SettingsInput = z.infer<typeof SettingsBody>;
