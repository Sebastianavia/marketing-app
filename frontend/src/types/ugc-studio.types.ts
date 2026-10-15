/**
 * Tipos del UGC Studio multi-agente: referencias etiquetadas, storyboard por escenas,
 * eventos de los agentes y estado de render por escena.
 */

export type ReferenceRole = 'personaje' | 'producto' | 'locacion' | 'estilo' | 'otro';

export const REFERENCE_ROLE_LABELS: Record<ReferenceRole, string> = {
  personaje: 'Personaje',
  producto: 'Producto',
  locacion: 'Locación',
  estilo: 'Estilo',
  otro: 'Otro',
};

export interface UgcReference {
  id: string; // ej. "ref1" — así lo citan los agentes
  url: string; // URL pública https (Cloudinary), requerida por OpenRouter
  role: ReferenceRole;
  label: string; // lo que el usuario dijo que representa
  description?: string; // descripción visual generada por el Analista de referencias
}

export type VideoResolution = '480p' | '768p';
export type StudioAspectRatio = '9:16' | '16:9' | '1:1';

export interface StudioSettings {
  resolution: VideoResolution;
  aspectRatio: StudioAspectRatio;
  maxScenes: number;
  maxTotalSeconds: number;
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  resolution: '480p',
  aspectRatio: '9:16',
  maxScenes: 2,
  maxTotalSeconds: 20,
};

/** Normaliza ajustes que llegan del cliente a rangos válidos. */
export function sanitizeSettings(input: Partial<StudioSettings> | undefined): StudioSettings {
  const s = { ...DEFAULT_STUDIO_SETTINGS, ...input };
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    resolution: s.resolution === '768p' ? '768p' : '480p',
    aspectRatio: (['9:16', '16:9', '1:1'] as const).includes(s.aspectRatio) ? s.aspectRatio : '9:16',
    maxScenes: clamp(s.maxScenes, 1, 8, DEFAULT_STUDIO_SETTINGS.maxScenes),
    maxTotalSeconds: clamp(s.maxTotalSeconds, 5, 120, DEFAULT_STUDIO_SETTINGS.maxTotalSeconds),
  };
}

/** heygen-video-1 acepta clips de 5 a 15 s (enteros). */
export const SCENE_MIN_SECONDS = 5;
export const SCENE_MAX_SECONDS = 15;
export const UGC_VIDEO_MODEL = 'heygen/heygen-video-1';

export interface CharacterBible {
  characters: {
    name: string;
    referenceIds: string[];
    appearance: string;
    wardrobe: string;
    voice: string;
  }[];
  product: { name: string; referenceIds: string[]; description: string } | null;
  locations: { name: string; referenceIds: string[]; description: string }[];
  style: string;
}

/** Lo que el Estratega de producto entiende del producto y del objetivo del video (contexto para todo el equipo). */
export interface ProductStrategy {
  productName: string;
  spokenName?: string; // cómo escribirlo en el diálogo para que la voz lo pronuncie bien (ej. "Multi Ohh" → "Multi Oh")
  whatItIs: string;
  audience: string;
  videoGoal: string;
  keyMessage: string;
  usage: {
    packaging?: string; // lo que se ve en la foto (ej. caja de cartón)
    useUnit?: string; // lo que realmente se usa y de dónde sale (ej. tubo que se saca de la caja)
    howItIsUsed: string;
    applicationArea: string;
    onCameraGesture: string;
    illogicalUses: string[];
  };
  sensitivity: { level: 'normal' | 'sensible'; guidelines: string };
  allowedClaims: string[];
}

export type TransitionType ='apertura' | 'continua' | 'corte_con_referencias';

export interface SupervisorReview {
  department: string;
  score: number; // puntuación de la primera entrega
  notes: string;
  revised: boolean; // true si el departamento corrigió su trabajo tras esta revisión
}

export type SceneStatus = 'draft' | 'approved' | 'rendering' | 'rendered' | 'failed';

export interface SceneRender {
  taskId?: string;
  videoUrl?: string;
  lastFrameUrl?: string;
  costUSD?: number;
  usedFirstFrame?: boolean;
  usedReferences?: boolean;
  error?: string;
  stale?: boolean; // la escena anterior cambió después de renderizar esta: conviene re-renderizar
}

export interface StoryboardScene {
  id: string;
  index: number; // 1-based
  title: string;
  objective: string;
  durationSeconds: number;
  referenceIds: string[];
  dialogue: { speaker: string; line: string }[];
  visual: { shot: string; camera: string; action: string; setting: string };
  referenceUsage: { referenceId: string; how: string }[];
  audio: { voiceTone: string; ambience: string; music: string };
  sfx: { at: string; sound: string }[];
  transition: { type: TransitionType; rationale: string; startState: string; endState: string; visualEffects: string };
  continuityNotes: string;
  videoPrompt: string;
  status: SceneStatus;
  render?: SceneRender;
  seed?: number; // semilla propia tras "repetir toma"; si no, la del storyboard
}

/**
 * Una escena "continua" que muestra el producto no puede usar primer fotograma: heygen rechaza
 * first_frame junto con input_references (400). En su lugar se envía el último fotograma de la
 * escena anterior como PRIMERA referencia, más el personaje y el producto (verificado 2026-10-15:
 * arranca casi idéntica y el empaque sale fiel). Cuesta la tarifa con referencias.
 */
export function continuesWithReferences(
  scene: Pick<StoryboardScene, 'referenceIds' | 'transition'>,
  references: Pick<UgcReference, 'id' | 'role'>[]
): boolean {
  return (
    scene.transition.type === 'continua' &&
    scene.referenceIds.some((id) => references.find((r) => r.id === id)?.role === 'producto')
  );
}

/**
 * Referencias que se envían al renderizar una escena (sin contar el último fotograma).
 * - "continua" con producto: las asignadas a la escena (ver continuesWithReferences).
 * - "continua" sin producto: ninguna, arranca desde el último fotograma.
 * - escena que abre una cadena: las de toda la cadena, para que lo que se use después
 *   ya esté en su último fotograma.
 */
export function sentReferenceIds(
  scenes: Pick<StoryboardScene, 'index' | 'referenceIds' | 'transition'>[],
  scene: Pick<StoryboardScene, 'index' | 'referenceIds' | 'transition'>,
  references: Pick<UgcReference, 'id' | 'role'>[]
): string[] {
  if (scene.transition.type === 'continua') return continuesWithReferences(scene, references) ? scene.referenceIds : [];
  return chainReferenceIds(scenes, scene);
}

/** Referencias de una escena que abre cadena: las suyas más las de las escenas "continua" que la siguen. */
export function chainReferenceIds(scenes: Pick<StoryboardScene, 'index' | 'referenceIds' | 'transition'>[], scene: Pick<StoryboardScene, 'index' | 'referenceIds' | 'transition'>): string[] {
  if (scene.transition.type === 'continua') return [];
  const ids = new Set(scene.referenceIds);
  const ordered = [...scenes].sort((a, b) => a.index - b.index);
  for (const next of ordered.filter((s) => s.index > scene.index)) {
    if (next.transition.type !== 'continua') break;
    next.referenceIds.forEach((id) => ids.add(id));
  }
  return [...ids];
}

export interface Storyboard {
  id: string;
  title: string;
  concept: string;
  hook: string;
  cta: string;
  tone: string;
  bible: CharacterBible;
  brief?: string; // brief completo del usuario (opcional: storyboards guardados antes de guardarlo)
  strategy?: ProductStrategy; // opcional: storyboards guardados antes de existir el estratega
  scenes: StoryboardScene[];
  supervision: SupervisorReview[];
  seed: number;
  createdAt: string;
}

export interface AgentActivity {
  agentId: string;
  agentName: string;
  keyIndex?: number;
  model?: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export type StudioEvent =
  | { type: 'phase'; label: string }
  | { type: 'agent_start'; agentId: string; agentName: string }
  | { type: 'agent_slot'; agentId: string; keyIndex: number; model: string }
  | { type: 'agent_done'; agentId: string; detail?: string }
  | { type: 'agent_error'; agentId: string; detail: string }
  | { type: 'references'; references: UgcReference[] }
  | { type: 'storyboard'; storyboard: Storyboard }
  | { type: 'agent_reply'; reply: string; actions: AgentAction[] }
  | { type: 'error'; message: string };

export interface StoryboardRequest {
  brief: string;
  references: UgcReference[];
  settings: StudioSettings;
}

export interface SceneInsertRequest {
  storyboard: Storyboard;
  references: UgcReference[];
  settings: StudioSettings;
  afterIndex: number; // 0 = al inicio
  instructions: string;
}

// -----------------------------------------------------------------------------
// Agente creativo (chat): decide acciones sobre el storyboard
// -----------------------------------------------------------------------------
export const AGENT_ACTION_TYPES = [
  'generate_storyboard',
  'revise_scene',
  'insert_scene',
  'delete_scene',
  'relight_scene',
  'change_angle',
  'retake_scene',
  'approve_scenes',
  'render_scenes',
  'assemble_video',
  'update_settings',
  'move_scene',
  'duplicate_scene',
  'set_transition',
  'rename_project',
  'open_project',
  'stop_render',
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export interface AgentAction {
  type: AgentActionType;
  scenes: number[]; // índices afectados (insert_scene: [escena tras la que se inserta]); vacío = todas
  instructions: string; // brief, cambio pedido, iluminación, ángulo o nombre del proyecto
  settings?: Partial<StudioSettings>;
}

export interface AgentRequest {
  message: string;
  history: { role: 'user' | 'agent'; content: string }[];
  storyboard: Storyboard | null;
  references: UgcReference[];
  settings: StudioSettings;
}

export interface AgentResponse {
  reply: string;
  actions: AgentAction[];
}

export interface SceneRevisionRequest {
  storyboard: Storyboard;
  references: UgcReference[];
  settings: StudioSettings;
  sceneId: string;
  feedback: string;
}

// -----------------------------------------------------------------------------
// Estimación de costo en el cliente (misma lógica que planSceneRender en el servidor)
// -----------------------------------------------------------------------------
export interface LivePricingInfo {
  discount: number;
  live: boolean;
  extraImageUSD: number;
  freeReferenceImages: number;
  rates: Record<VideoResolution, { base: number; references: number }>;
}

/** Costo aproximado de renderizar una escena con las tarifas actuales. */
export function estimateSceneRenderUSD(
  scenes: StoryboardScene[],
  scene: StoryboardScene,
  references: UgcReference[],
  pricing: LivePricingInfo,
  resolution: VideoResolution
): number {
  let images = 0;
  if (scene.transition.type === 'continua') {
    // Con producto: último fotograma + referencias asignadas; sin producto: solo primer fotograma (tarifa base)
    if (continuesWithReferences(scene, references)) {
      images = 1 + references.filter((r) => scene.referenceIds.includes(r.id)).length;
    }
  } else {
    const ids = sentReferenceIds(scenes, scene, references);
    const assigned = references.filter((r) => ids.includes(r.id)).length;
    images = assigned > 0 ? assigned : references.filter((r) => r.role === 'personaje').length;
  }
  const rate = images > 0 ? pricing.rates[resolution].references : pricing.rates[resolution].base;
  const extra = Math.max(0, images - pricing.freeReferenceImages) * pricing.extraImageUSD;
  return Number((rate * scene.durationSeconds + extra).toFixed(4));
}
