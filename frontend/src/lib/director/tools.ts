import { z } from 'zod';
import { listAvatars } from '@/lib/avatars/avatar-store';
import { getStoredVoices } from '@/lib/storage/voice-storage';
import { getAllProjects } from '@/lib/storage/project-storage';
import { getJob, listJobs, type RenderJob } from '@/lib/jobs/job-store';
import { getSettings } from '@/lib/data/settings';
import { spentToday } from '@/lib/usage/usage-store';
import { getConfiguredVoiceId } from '@/services/elevenlabs/elevenlabs.service';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '@/config/image-models';
import { BROLL_MODELS, DEFAULT_BROLL_MODEL } from '@/config/broll-models';
import { ELEVEN_MODELS, DEFAULT_ELEVEN_MODEL } from '@/config/elevenlabs-models';
import { videoRate } from '@/config/cost-rates';
import { projectCategoryLabel } from '@/config/project-categories';
import { AVATAR_MODEL, DEFAULT_BUDGET_USD, EstimateError, estimatePlan } from './estimate';
import { DailyLimitError } from '@/lib/usage/usage-store';
import { GenerationError } from '@/lib/generation/errors';
import { AvatarError } from '@/lib/avatars/avatar-store';
import { errorMessage } from '@/lib/errors';
import {
  ProductionError,
  currentFiles,
  listProductions,
  pendingApproval,
  productionSpent,
  type Production,
} from './production-store';
import { reconcileProduction } from './production-jobs';
import { changeScene, createProduction, runAvatarScene, runBrollScene, runImageScene, runVoiceScene } from './production';

/**
 * Herramientas del Director. Fase 1: solo lectura + estimar costo (gasto $0).
 * Fase 2: producciones (crear, ver, cambiar) y las que generan, que solo ejecutan escenas
 * aprobadas por una persona desde la app (reglas en production.ts).
 * Se exponen dos veces: al servidor MCP vía /api/director/tools y, más adelante,
 * al chat Director de la app como herramientas del AI SDK.
 */

export class DirectorToolError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface DirectorTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** true si la herramienta gasta dinero en proveedores. */
  spends: boolean;
  schema: S;
  run(input: z.infer<S>): Promise<unknown>;
}

function defineTool<S extends z.ZodType>(tool: DirectorTool<S>): DirectorTool<S> {
  return tool;
}

// ── ver_catalogo ──────────────────────────────────────────────────────────────

const CATALOG_SECTIONS = ['todo', 'avatares', 'voces', 'modelos', 'proyectos', 'producciones'] as const;

async function todaySpend() {
  const [settings, spent] = await Promise.all([getSettings(), spentToday()]);
  const limit = settings.dailyLimitUSD ?? 0;
  return {
    hoyUSD: Math.round(spent * 10000) / 10000,
    limiteDiarioUSD: limit || null,
    restanteHoyUSD: limit > 0 ? Math.max(0, Math.round((limit - spent) * 10000) / 10000) : null,
  };
}

async function catalogAvatars() {
  const avatars = await listAvatars();
  return avatars.map((a) => ({
    id: a.id,
    nombre: a.name,
    descripcion: a.description || undefined,
    fotos: a.photos.length,
    tienePortada: !!a.cover,
  }));
}

async function catalogVoices() {
  // Solo el registro local: no llama a ElevenLabs (rápido y sin gasto).
  const voices = await getStoredVoices();
  const configured = getConfiguredVoiceId();
  const list = voices.map((v) => ({
    id: v.id,
    nombre: v.name,
    tipo: v.id === configured ? 'clonada (predeterminada)' : v.category === 'cloned' ? 'clonada' : 'de ElevenLabs',
    descripcion: v.description || undefined,
  }));
  if (configured && !list.some((v) => v.id === configured)) {
    list.unshift({ id: configured, nombre: 'Voz clonada configurada', tipo: 'clonada (predeterminada)', descripcion: undefined });
  }
  return list;
}

function catalogModels() {
  return {
    avatar: [{ id: AVATAR_MODEL, nombre: 'HeyGen Avatar IV (foto + voz, labios sincronizados)', precioPorSegundoUSD: videoRate(AVATAR_MODEL) }],
    tomaDeApoyo: BROLL_MODELS.map((m) => ({
      id: m.id,
      nombre: m.name,
      predeterminado: m.id === DEFAULT_BROLL_MODEL,
      precioPorSegundoUSD: m.pricePerSecond,
      precioPorSegundoConAudioUSD: m.audio ? m.pricePerSecondAudio ?? m.pricePerSecond : null,
      duracionesSeg: m.durations,
      resolucion: m.resolution,
      formatos: m.aspectRatios,
      nota: m.note,
    })),
    imagen: IMAGE_MODELS.map((m) => ({
      id: m.id,
      nombre: m.name,
      predeterminado: m.id === DEFAULT_IMAGE_MODEL,
      precioPorImagenUSD: m.pricePerImage,
      maxReferencias: m.maxRefs,
      nota: m.note,
    })),
    voz: ELEVEN_MODELS.map((m) => ({
      id: m.id,
      nombre: m.name,
      predeterminado: m.id === DEFAULT_ELEVEN_MODEL,
      precioPor1000CaracteresUSD: m.pricePer1k,
      maxCaracteresPorPeticion: m.charLimit,
      etiquetasDeEmocion: m.audioTags,
    })),
  };
}

async function catalogProjects(limit: number) {
  const projects = await getAllProjects();
  return projects
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map((p) => ({
      categoria: projectCategoryLabel(p.category),
      titulo: p.title || p.name,
      fecha: p.createdAt,
      tieneVideo: !!p.videoPath,
      imagenes: p.imagePaths?.length || undefined,
      carpeta: p.path,
    }));
}

const verCatalogo = defineTool({
  name: 'ver_catalogo',
  description:
    'Muestra lo que hay en Lulo Studio: avatares, voces, modelos con precios, proyectos recientes, producciones y el gasto de hoy frente al límite diario. No gasta dinero.',
  spends: false,
  schema: z.object({
    seccion: z
      .enum(CATALOG_SECTIONS)
      .default('todo')
      .describe('Qué parte del catálogo ver. "todo" devuelve todas las secciones.'),
    limite: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe('Cuántos proyectos recientes devolver (de 1 a 100).'),
  }),
  async run({ seccion, limite }) {
    const want = (s: (typeof CATALOG_SECTIONS)[number]) => seccion === 'todo' || seccion === s;
    const result: Record<string, unknown> = {};
    if (want('avatares')) result.avatares = await catalogAvatars();
    if (want('voces')) result.voces = await catalogVoices();
    if (want('modelos')) result.modelos = catalogModels();
    if (want('proyectos')) result.proyectos = await catalogProjects(limite);
    if (want('producciones')) {
      result.producciones = (await listProductions()).slice(0, limite).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        estado: p.estado,
        escenas: p.escenas.length,
        gastadoUSD: productionSpent(p),
        presupuestoUSD: p.presupuestoUSD,
        creada: p.creada,
      }));
    }
    result.gasto = await todaySpend();
    return result;
  },
});

// ── estimar_costo ─────────────────────────────────────────────────────────────

const sceneSchema = z.object({
  tipo: z
    .enum(['avatar', 'toma_de_apoyo', 'imagen', 'voz'])
    .describe('avatar = persona hablando con labios sincronizados (HeyGen + voz ElevenLabs); toma_de_apoyo = clip de video sin nadie hablando; imagen = imagen fija; voz = locución sola.'),
  duracionSeg: z.number().positive().max(300).optional().describe('Segundos de la escena (avatar, toma_de_apoyo o voz).'),
  texto: z.string().max(40000).optional().describe('Lo que se dice en la escena; se cuentan sus caracteres para la voz.'),
  modelo: z.string().optional().describe('Id del modelo (ver_catalogo → modelos). Si falta, se usa el predeterminado más barato.'),
  modeloVoz: z.string().optional().describe('Solo avatar: id del modelo de voz de ElevenLabs.'),
  conAudio: z.boolean().optional().describe('Solo toma_de_apoyo: el modelo genera su propia voz/sonido.'),
  resolucion: z.string().optional().describe('Solo imagen: 1K, 2K o 4K según el modelo.'),
  cantidad: z.number().int().min(1).max(20).optional().describe('Solo imagen: cuántas imágenes.'),
});

const estimarCosto = defineTool({
  name: 'estimar_costo',
  description:
    'Calcula cuánto costaría un plan de escenas antes de generar nada, con las tarifas de la app. Devuelve el costo por escena, el total, si cabe en el presupuesto y en lo que queda del límite diario, y alternativas más baratas. No gasta dinero.',
  spends: false,
  schema: z.object({
    escenas: z.array(sceneSchema).min(1).max(50).describe('Escenas del plan, en orden.'),
    presupuestoUSD: z
      .number()
      .positive()
      .optional()
      .describe(`Presupuesto de la producción en USD. Por defecto ${DEFAULT_BUDGET_USD}.`),
  }),
  async run({ escenas, presupuestoUSD }) {
    let estimate;
    try {
      estimate = estimatePlan(escenas, presupuestoUSD ?? DEFAULT_BUDGET_USD);
    } catch (err) {
      if (err instanceof EstimateError) throw new DirectorToolError(err.message);
      throw err;
    }
    const gasto = await todaySpend();
    const cabeHoy = gasto.restanteHoyUSD === null ? true : estimate.totalUSD <= gasto.restanteHoyUSD;
    return {
      ...estimate,
      gastoHoy: gasto,
      cabeEnLimiteDiario: cabeHoy,
      nota: 'Estimación con precios de lista; el costo real lo cobra cada proveedor y queda en Costos.',
    };
  },
});

// ── estado_trabajo ────────────────────────────────────────────────────────────

const JOB_ID = /^[a-f0-9-]{36}$/i;

function jobSummary(j: RenderJob) {
  return {
    id: j.id,
    titulo: j.title,
    herramienta: j.tool,
    tipo: j.kind ?? 'avatar',
    estado: j.status,
    fase: j.phase,
    modelo: j.model,
    intentos: j.attempts,
    costoEstimadoUSD: j.estimatedCostUSD ?? null,
    costoUSD: j.costUSD ?? null,
    duracionSeg: j.durationSec ?? null,
    error: j.error ?? null,
    archivo: j.outputPath ?? null,
    carpetaProyecto: j.projectPath ?? null,
    creado: j.createdAt,
    terminado: j.completedAt ?? null,
  };
}

const estadoTrabajo = defineTool({
  name: 'estado_trabajo',
  description:
    'Muestra el avance de un trabajo de render (video de avatar o toma de apoyo) por su id, o los últimos trabajos si no se da id. No gasta dinero.',
  spends: false,
  schema: z.object({
    id: z.string().regex(JOB_ID, 'Id de trabajo no válido (uuid de 36 caracteres).').optional().describe('Id del trabajo.'),
    ultimos: z.number().int().min(1).max(50).default(5).describe('Si no hay id: cuántos trabajos recientes devolver.'),
  }),
  async run({ id, ultimos }) {
    if (id) {
      const job = await getJob(id);
      if (!job) throw new DirectorToolError('Trabajo no encontrado.', 404);
      return { trabajo: jobSummary(job) };
    }
    const jobs = await listJobs();
    return { trabajos: jobs.slice(0, ultimos).map(jobSummary), total: jobs.length };
  },
});

// ── Producciones ──────────────────────────────────────────────────────────────

const SCENE_ID = /^e\d{1,2}$/;

const sceneFields = {
  titulo: z.string().trim().max(120).optional().describe('Descripción corta de la escena para quien aprueba.'),
  duracionSeg: z.number().positive().max(60).optional().describe('Segundos (avatar, toma_de_apoyo, voz).'),
  texto: z.string().trim().max(5000).optional().describe('Lo que se dice (avatar y voz).'),
  prompt: z.string().trim().max(4000).optional().describe('Descripción visual (imagen y toma_de_apoyo).'),
  avatarId: z.string().max(120).optional().describe('Avatar guardado (ver_catalogo → avatares): su portada es la foto del avatar o el fotograma inicial.'),
  vozId: z.string().max(80).optional().describe('Voz de ElevenLabs (ver_catalogo → voces). Si falta, la clonada predeterminada.'),
  modelo: z.string().max(120).optional().describe('Modelo de imagen, de toma de apoyo o de voz (ver_catalogo → modelos). Si falta, el predeterminado más barato.'),
  modeloVoz: z.string().max(80).optional().describe('Solo avatar: modelo de voz de ElevenLabs.'),
  conAudio: z.boolean().optional().describe('Solo toma_de_apoyo: el modelo genera su propio sonido.'),
  resolucion: z.string().max(5).optional().describe('Solo imagen: 1K, 2K o 4K según el modelo.'),
  cantidad: z.number().int().min(1).max(4).optional().describe('Solo imagen: cuántas (1 a 4).'),
  imagenDeEscena: z
    .string()
    .regex(SCENE_ID, 'Id de escena no válido (p. ej. "e1").')
    .optional()
    .describe('Id de una escena de imagen ANTERIOR de esta producción cuya imagen se usa como foto (avatar) o fotograma inicial (toma de apoyo).'),
  movimiento: z.string().trim().max(500).optional().describe('Solo avatar: gestos y movimiento (motion prompt de HeyGen).'),
  expresividad: z.enum(['low', 'medium', 'high']).optional().describe('Solo avatar: expresividad de HeyGen.'),
};

const productionSceneSchema = z.object({
  tipo: z
    .enum(['avatar', 'toma_de_apoyo', 'imagen', 'voz'])
    .describe('avatar = persona hablando (voz ElevenLabs + HeyGen); toma_de_apoyo = clip sin nadie hablando; imagen = imagen fija; voz = locución sola.'),
  ...sceneFields,
});

const refSchema = {
  produccionId: z.string().regex(/^prod_[a-z0-9]{8,32}$/, 'Id de producción no válido.').describe('Id devuelto por crear_produccion.'),
  escenaId: z.string().regex(SCENE_ID, 'Id de escena no válido (p. ej. "e1").').describe('Id de la escena (e1, e2…).'),
};

function productionSummary(p: Production) {
  const a = pendingApproval(p);
  return {
    id: p.id,
    nombre: p.nombre,
    estado: p.estado,
    formato: p.formato,
    carpeta: p.carpeta,
    presupuestoUSD: p.presupuestoUSD,
    gastadoUSD: productionSpent(p),
    aprobacionPendiente: a ? { id: a.id, montoUSD: a.montoUSD, escenas: a.escenas, motivo: a.motivo } : null,
    escenas: p.escenas.map((s) => ({
      id: s.id,
      orden: s.orden,
      tipo: s.spec.tipo,
      titulo: s.spec.titulo,
      estado: s.estado,
      detalle: s.detalle,
      costoEstimadoUSD: s.estimadoUSD,
      aprobadoUSD: s.aprobadaUSD,
      gastadoUSD: s.gastoUSD,
      version: s.version,
      trabajo: s.estado === 'generando' ? s.jobId ?? null : undefined,
      error: s.error,
      duracionRealSeg: s.duracionRealSeg,
      archivos: currentFiles(s).map((f) => ({ rol: f.rol, ruta: f.ruta, modelo: f.modelo, costoUSD: f.costoUSD })),
    })),
  };
}

const ASK_APPROVAL =
  'Nada se genera hasta que una persona lo apruebe en Lulo Studio (aviso «El Director pide…» en la barra superior). ' +
  'Tú no puedes aprobar. Cuando esté aprobado, consulta ver_produccion y ejecuta cada escena con su herramienta.';

const crearProduccion = defineTool({
  name: 'crear_produccion',
  description:
    'Crea una producción con su plan de escenas, su carpeta en Proyectos → Producciones y una solicitud de aprobación con el costo. ' +
    'No gasta dinero. Rechaza el plan si supera el presupuesto. Después, una persona debe aprobarlo en la app.',
  spends: false,
  schema: z.object({
    nombre: z.string().trim().min(1).max(80).describe('Nombre de la producción.'),
    formato: z.enum(['9:16', '16:9', '1:1']).default('9:16').describe('Formato del video.'),
    presupuestoUSD: z.number().positive().max(50).default(DEFAULT_BUDGET_USD).describe(`Presupuesto en USD (por defecto ${DEFAULT_BUDGET_USD}).`),
    escenas: z.array(productionSceneSchema).min(1).max(20).describe('Escenas en orden; reciben los ids e1, e2…'),
  }),
  async run(input) {
    const { production, approval, suposiciones } = await createProduction(input);
    return {
      produccion: productionSummary(production),
      aprobacion: { id: approval.id, montoUSD: approval.montoUSD },
      suposiciones,
      siguientePaso: ASK_APPROVAL,
    };
  },
});

const verProduccion = defineTool({
  name: 'ver_produccion',
  description:
    'Muestra una producción: estado y costo de cada escena, archivos generados, gasto frente al presupuesto y si hay una aprobación pendiente. No gasta dinero.',
  spends: false,
  schema: z.object({ produccionId: refSchema.produccionId }),
  async run({ produccionId }) {
    return { produccion: productionSummary(await reconcileProduction(produccionId)) };
  },
});

const cambiarEscena = defineTool({
  name: 'cambiar_escena',
  description:
    'Cambia una escena (texto, prompt, modelo, duración…) o la rehace tal cual con rehacer: true. Sus archivos actuales pasan a _versiones y ' +
    'la escena vuelve a necesitar aprobación de una persona en la app. No gasta dinero.',
  spends: false,
  schema: z.object({
    ...refSchema,
    cambios: z.object(sceneFields).default({}).describe('Solo los campos que cambian. El tipo no se puede cambiar.'),
    rehacer: z.boolean().default(false).describe('Repetir la escena aunque no cambie nada (p. ej. tras un fallo con cobro).'),
  }),
  async run({ produccionId, escenaId, cambios, rehacer }) {
    const { production, result } = await changeScene(produccionId, escenaId, cambios, rehacer);
    return {
      produccion: productionSummary(production),
      aprobacion: { id: result.approval.id, montoUSD: result.approval.montoUSD },
      suposiciones: result.suposiciones,
      siguientePaso: ASK_APPROVAL,
    };
  },
});

const SPENDS_NOTE = 'GASTA DINERO. Solo funciona si una persona aprobó la escena en la app; ejecuta exactamente lo aprobado.';

const crearVoz = defineTool({
  name: 'crear_voz',
  description: `Genera la locución de una escena de tipo "voz" con ElevenLabs y la guarda (MP3 + tiempos para subtítulos) en la carpeta de la producción. ${SPENDS_NOTE}`,
  spends: true,
  schema: z.object(refSchema),
  async run({ produccionId, escenaId }) {
    const r = await runVoiceScene(produccionId, escenaId);
    return { produccion: productionSummary(r.production), duracionSeg: r.duracionSeg, costoUSD: r.costoUSD };
  },
});

const crearImagen = defineTool({
  name: 'crear_imagen',
  description: `Genera la imagen de una escena de tipo "imagen" (con el avatar si la escena lo indica) y la guarda en la carpeta de la producción. Tarda hasta ~1 min. ${SPENDS_NOTE}`,
  spends: true,
  schema: z.object(refSchema),
  async run({ produccionId, escenaId }) {
    const r = await runImageScene(produccionId, escenaId);
    return { produccion: productionSummary(r.production), imagenes: r.imagenes, avisos: r.avisos };
  },
});

const videoAvatar = defineTool({
  name: 'video_avatar',
  description:
    'Lanza el video de una escena de tipo "avatar": genera su voz (o reutiliza la ya hecha), sube foto y voz y crea el render de HeyGen Avatar IV. ' +
    'Responde al instante con el id del trabajo; sigue el avance con ver_produccion o estado_trabajo. ' +
    `Si la voz real dura más de lo aprobado, se detiene y pide aprobar el nuevo monto. ${SPENDS_NOTE}`,
  spends: true,
  schema: z.object(refSchema),
  async run({ produccionId, escenaId }) {
    const r = await runAvatarScene(produccionId, escenaId);
    return { produccion: productionSummary(r.production), trabajo: r.jobId, aviso: r.aviso };
  },
});

const tomaDeApoyo = defineTool({
  name: 'toma_de_apoyo',
  description:
    'Lanza el clip de una escena de tipo "toma_de_apoyo" (imagen→video o texto→video, sin nadie hablando). ' +
    `Responde al instante con el id del trabajo; sigue el avance con ver_produccion o estado_trabajo. ${SPENDS_NOTE}`,
  spends: true,
  schema: z.object(refSchema),
  async run({ produccionId, escenaId }) {
    const r = await runBrollScene(produccionId, escenaId);
    return { produccion: productionSummary(r.production), trabajo: r.jobId };
  },
});

// ── Registro ──────────────────────────────────────────────────────────────────

export const DIRECTOR_TOOLS: DirectorTool[] = [
  verCatalogo,
  estimarCosto,
  estadoTrabajo,
  crearProduccion,
  verProduccion,
  cambiarEscena,
  crearVoz,
  crearImagen,
  videoAvatar,
  tomaDeApoyo,
] as DirectorTool[];

export function getDirectorTool(name: string): DirectorTool | undefined {
  return DIRECTOR_TOOLS.find((t) => t.name === name);
}

/** Lista para clientes externos (MCP): nombre, descripción y JSON Schema de la entrada. */
export function directorToolsManifest() {
  return DIRECTOR_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    spends: t.spends,
    inputSchema: z.toJSONSchema(t.schema, { io: 'input' }),
  }));
}

/** Valida la entrada con zod y ejecuta la herramienta. */
export async function runDirectorTool(name: string, rawInput: unknown): Promise<unknown> {
  const tool = getDirectorTool(name);
  if (!tool) throw new DirectorToolError(`Herramienta desconocida: "${name}".`, 404);
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
    throw new DirectorToolError(`Datos no válidos — ${issues}`);
  }
  try {
    return await tool.run(parsed.data);
  } catch (err) {
    throw toToolError(err);
  }
}

/** Traduce los errores de cada capa a un mensaje y código HTTP para el agente. */
function toToolError(err: unknown): unknown {
  if (err instanceof DirectorToolError) return err;
  if (err instanceof ProductionError || err instanceof GenerationError || err instanceof AvatarError) {
    return new DirectorToolError(err.message, err.status);
  }
  if (err instanceof DailyLimitError) return new DirectorToolError(err.message, 402);
  if (err instanceof z.ZodError) return new DirectorToolError(err.issues.map((i) => i.message).join(' '));
  const e = err as { httpStatus?: number };
  if (typeof e?.httpStatus === 'number') return new DirectorToolError(errorMessage(err, 'Error del proveedor.'), e.httpStatus);
  return err;
}
