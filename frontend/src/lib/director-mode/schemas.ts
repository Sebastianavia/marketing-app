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

/** Transcripción de la locución propia (Gemini con audio). */
export const TranscriptSchema = z.object({
  frases: z.array(
    z.object({
      texto: z.string().describe('Lo que se dice, exacto'),
      inicio: z.number().describe('Segundo en que empieza'),
      fin: z.number().describe('Segundo en que termina'),
    })
  ),
});

/** Guion repartido sobre las frases de la locución. */
export const AlignedScriptSchema = z.object({
  titulo: z.string().describe('Título corto del video (máximo 60 caracteres)'),
  escenas: z
    .array(
      z.object({
        desde: z.number().describe('Primera frase de la escena (empieza en 1)'),
        hasta: z.number().describe('Última frase de la escena (incluida)'),
        tipo: z.enum(['avatar', 'broll']),
        queSeVe: z.string().describe('Qué se ve: una toma concreta y filmable'),
      })
    )
    .min(1)
    .max(40),
});

const TagKindEnum =z.enum(['personaje', 'lugar', 'producto', 'estilo', 'voz', 'musica']);

/** Propuesta de etiquetas a partir de las fotos (visión). */
export const TagProposalSchema = z.object({
  grupos: z.array(
    z.object({
      fotos: z.array(z.number()).describe('Números de las fotos de este grupo (empiezan en 1)'),
      tipo: z.enum(['personaje', 'lugar', 'producto', 'estilo']),
      nombre: z.string().describe('Nombre corto en español (personaje: un nombre propio)'),
      descripcion: z.string().describe('Descripción visual breve EN INGLÉS, 10 a 30 palabras'),
      existente: z.string().optional().describe('Si es una etiqueta ya existente: su mención sin @'),
    })
  ),
});

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
const RefId = z.string().min(1).max(40);

/** Acciones sobre una producción en modo Director. `orchestrator` lo añade postOrchestrated al aceptar Claude. */
export const ActionBody = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('guardar_idea'), entrada: InputBody }),
  z.object({ accion: z.literal('generar_preguntas') }),
  z.object({ accion: z.literal('responder_preguntas'), respuestas: z.record(z.string(), z.string().max(500)) }),
  z.object({ accion: z.literal('saltar_preguntas') }),
  z.object({ accion: z.literal('guardar_ajustes'), ajustes: SettingsBody }),
  z.object({ accion: z.literal('generar_guion'), indicacion: z.string().max(1000).optional() }),
  z.object({ accion: z.literal('rehacer_escena'), escenaId: z.string().max(20), indicacion: z.string().max(1000).default('') }),
  z.object({ accion: z.literal('editar_escena'), escenaId: z.string().max(20), cambios: SceneEdit }),
  z.object({ accion: z.literal('generar_prompts'), soloFaltantes: z.boolean().default(false) }),
  z.object({ accion: z.literal('rehacer_prompt'), escenaId: z.string().max(20), indicacion: z.string().max(1000).default('') }),
  z.object({ accion: z.literal('editar_prompt'), escenaId: z.string().max(20), texto: z.string().min(1).max(4000) }),
  z.object({ accion: z.literal('aprobar'), etapa: Stage }),
  // Referencias y etiquetas (paso 2). Subir archivos va por /api/director-mode/[id]/referencias (multipart).
  z.object({ accion: z.literal('proponer_etiquetas'), refIds: z.array(RefId).max(40).optional() }),
  z.object({
    accion: z.literal('guardar_etiqueta'),
    etiquetaId: RefId.optional(),
    tipo: TagKindEnum,
    nombre: z.string().trim().min(1, 'Ponle un nombre a la etiqueta.').max(60),
    descripcion: z.string().max(600).default(''),
    avatarId: z.string().max(100).nullable().default(null),
    /** Fotos que pasan a esta etiqueta. */
    refIds: z.array(RefId).max(40).optional(),
  }),
  z.object({ accion: z.literal('borrar_etiqueta'), etiquetaId: RefId }),
  z.object({ accion: z.literal('unir_etiquetas'), desde: RefId, hacia: RefId }),
  z.object({
    accion: z.literal('mover_referencia'),
    refId: RefId,
    /** null = sin etiqueta; ausente = no cambia. */
    etiquetaId: RefId.nullable().optional(),
    /** null = todo el proyecto; ausente = no cambia. */
    escenaId: z.string().max(20).nullable().optional(),
  }),
  z.object({ accion: z.literal('borrar_referencia'), refId: RefId }),
  // Video desde mi audio (paso 2)
  z.object({ accion: z.literal('usar_locucion'), refId: RefId, usarComoVoz: z.boolean().default(true) }),
  z.object({ accion: z.literal('quitar_locucion') }),
  z.object({
    accion: z.literal('transcribir_locucion'),
    motor: z.enum(['gemini', 'elevenlabs']),
    /** ElevenLabs es de pago: la interfaz manda el precio que mostró (si cambió → 409). */
    costoVisto: z.number().min(0).optional(),
  }),
  z.object({ accion: z.literal('editar_transcripcion'), frases: z.array(z.string().max(1000)).max(400) }),
]);

export type ActionInput = z.infer<typeof ActionBody>;
export type InputBodyInput = z.infer<typeof InputBody>;
export type SettingsInput = z.infer<typeof SettingsBody>;
