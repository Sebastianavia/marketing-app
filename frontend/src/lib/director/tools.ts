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

/**
 * Herramientas del Director (Fase 1: solo lectura + estimar costo, gasto $0).
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
  /** true si la herramienta gasta dinero en proveedores (Fase 2 en adelante). */
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
      result.producciones = [];
      result.notaProducciones = 'Las producciones del Director llegan en la Fase 2.';
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

// ── Registro ──────────────────────────────────────────────────────────────────

export const DIRECTOR_TOOLS: DirectorTool[] = [verCatalogo, estimarCosto, estadoTrabajo] as DirectorTool[];

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
  return tool.run(parsed.data);
}
