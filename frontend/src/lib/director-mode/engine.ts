import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { getAvatar } from '@/lib/avatars/avatar-store';
import { BROLL_MODELS, DEFAULT_BROLL_MODEL } from '@/config/broll-models';
import { getDirectorSkill } from '@/config/director-skills';
import { normalizeWords } from '@/lib/scenes/scene-plan';
import {
  createProductionFolder,
  listProductions,
  newProductionId,
  ProductionError,
  requireProduction,
  saveNewProduction,
  updateProduction,
  type Production,
} from '@/lib/director/production-store';
import { brollModelsFor, retimeScenes } from './durations';
import { promptsPrompt, questionsPrompt, redoPromptPrompt, redoScenePrompt, scriptPrompt } from './prompts';
import {
  ActionBody,
  OnePromptSchema,
  OneSceneSchema,
  PromptsSchema,
  QuestionsSchema,
  ScriptSchema,
  type ActionInput,
  type InputBodyInput,
  type SettingsInput,
} from './schemas';
import { ACTIVE_ORDER, invalidateAfter, previousApproved, promptIsStale, remember, touch, unlockNext } from './stages';
import type { ActiveStageId, DirectorScene, DirectorSceneType, DirectorSettings, DirectorState, StageState } from './types';

/**
 * Motor del modo Director (Fase 1, solo texto). Cada acción:
 * 1) lee la producción y comprueba que la etapa se puede tocar;
 * 2) si hace falta, llama a la IA FUERA del candado (Gemini puede tardar);
 * 3) guarda bajo el candado comprobando que nada cambió mientras tanto.
 * Nunca gasta en imagen, voz ni video: eso llega en las Fases 3 y 4, siempre con aprobación.
 */

const PDF_PREFIX = 'entrada';

export const DEFAULT_SETTINGS: DirectorSettings = {
  formato: '9:16',
  duracionSeg: 30,
  modoVoz: 'voiceover',
  modeloBroll: DEFAULT_BROLL_MODEL,
  avatarId: null,
  presupuestoUSD: 3,
};

function stage(estado: StageState['estado']): StageState {
  return { estado, rev: 0 };
}

function needDirector(p: Production): DirectorState {
  if (!p.director) throw new ProductionError('Esta producción no es del modo Director de Guion a video.', 400);
  return p.director;
}

function conflict(): never {
  throw new ProductionError('Algo cambió mientras la IA pensaba (¿otra ventana?). Revisa y vuelve a intentarlo.', 409);
}

function requirePrevious(d: DirectorState, id: ActiveStageId, verbo: string) {
  if (!previousApproved(d, id)) {
    const falta = ACTIVE_ORDER.slice(0, ACTIVE_ORDER.indexOf(id)).find((s) => d.etapas[s].estado !== 'aprobada');
    throw new ProductionError(`Para ${verbo} primero aprueba la etapa "${falta}".`, 409);
  }
}

function findScene(d: DirectorState, escenaId: string): DirectorScene {
  const s = d.guion?.escenas.find((x) => x.id === escenaId);
  if (!s) throw new ProductionError(`No existe la escena "${escenaId}".`, 404);
  return s;
}

/** Tipo que admite el modo de voz: solo el modo "Tu persona habla" usa escenas de HeyGen. */
function allowedType(d: DirectorState, tipo: DirectorSceneType): DirectorSceneType {
  return d.ajustes.modoVoz === 'avatar' ? tipo : 'broll';
}

async function savePdf(p: Production, base64: string): Promise<string> {
  let name = `${PDF_PREFIX}.pdf`;
  for (let i = 2; fsSync.existsSync(path.join(/*turbopackIgnore: true*/ p.carpeta, name)); i++) name = `${PDF_PREFIX}-${i}.pdf`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, name), Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
  return name;
}

async function pdfFiles(p: Production, d: DirectorState) {
  if (d.entrada.tipo !== 'pdf' || !d.entrada.pdf) return undefined;
  const file = path.join(/*turbopackIgnore: true*/ p.carpeta, d.entrada.pdf);
  if (!fsSync.existsSync(file)) throw new ProductionError('No encuentro el PDF de esta producción en su carpeta. Vuelve a subirlo en la etapa Idea.', 404);
  return [{ data: new Uint8Array(await fs.readFile(file)), mediaType: 'application/pdf', filename: d.entrada.pdfNombre || 'material.pdf' }];
}

async function think<S extends z.ZodType>(
  p: Production,
  d: DirectorState,
  schema: S,
  built: { system: string; prompt: string },
  description: string,
  opts: { orchestrator?: unknown; withPdf?: boolean; temperature?: number } = {}
) {
  const files = opts.withPdf ? await pdfFiles(p, d) : undefined;
  return orchestrateObject({
    tool: 'text-to-video',
    description: `Director · ${description}`,
    system: built.system,
    prompt: built.prompt,
    files,
    schema,
    temperature: opts.temperature ?? 0.7,
    mode: opts.orchestrator,
    confidential: d.confidencial,
  });
}

/** Errores de la IA que no son de cuota: se anotan en la etapa (la cuota la maneja la interfaz con 409). */
async function noteError(id: string, etapa: ActiveStageId, err: unknown) {
  if ((err as { code?: string })?.code === 'free_exhausted' || err instanceof ProductionError) return;
  const msg = err instanceof Error ? err.message : 'La IA no respondió.';
  await updateProduction(id, (p) => {
    const d = needDirector(p);
    const st = d.etapas[etapa];
    if (st.estado === 'pendiente') touch(d, etapa, 'error', { error: msg });
    else st.error = msg;
  }).catch(() => undefined);
}

/** Sube la revisión de la etapa sin cambiar su estado. */
function bump(d: DirectorState, id: ActiveStageId) {
  d.etapas[id] = { ...d.etapas[id], rev: d.etapas[id].rev + 1, actualizada: new Date().toISOString() };
  delete d.etapas[id].error;
}

/** Cambió una escena del guion: si los prompts estaban aprobados, hay que revisarlos otra vez. */
function afterSceneChange(d: DirectorState) {
  bump(d, 'guion');
  if (d.etapas.prompts.estado === 'aprobada') touch(d, 'prompts', 'por_revisar');
}

// ---------------------------------------------------------------------------
// Crear y leer
// ---------------------------------------------------------------------------

function validateInput(e: InputBodyInput, hasPdf: boolean) {
  if (e.tipo === 'pdf' && !hasPdf) throw new ProductionError('Sube el PDF.');
  if (e.tipo !== 'pdf' && !e.texto.trim()) throw new ProductionError(e.tipo === 'guion' ? 'Pega tu guion.' : 'Escribe la idea del video.');
}

function draftName(e: InputBodyInput): string {
  if (e.tipo === 'pdf' && e.pdfNombre) return e.pdfNombre.replace(/\.pdf$/i, '').slice(0, 50);
  const first = e.texto.trim().split(/\s+/).slice(0, 7).join(' ');
  return first.slice(0, 50) || 'Borrador';
}

export async function createDirectorDraft(e: InputBodyInput): Promise<Production> {
  validateInput(e, Boolean(e.pdfBase64));
  const now = new Date().toISOString();
  const skill = getDirectorSkill(e.skill);
  // La skill solo cambia los valores de partida; la persona los confirma en Ajustes
  const ajustes: DirectorSettings = skill ? { ...DEFAULT_SETTINGS, ...skill.ajustes } : { ...DEFAULT_SETTINGS };
  const p: Production = {
    id: newProductionId(),
    nombre: draftName(e),
    carpeta: '',
    formato: ajustes.formato,
    presupuestoUSD: ajustes.presupuestoUSD,
    estado: 'borrador',
    escenas: [],
    aprobaciones: [],
    creada: now,
    actualizada: now,
    director: {
      version: 1,
      ...(skill ? { skill: skill.id } : {}),
      confidencial: e.confidencial,
      etapas: {
        idea: { estado: 'aprobada', rev: 1, actualizada: now },
        preguntas: stage('pendiente'),
        ajustes: stage('bloqueada'),
        guion: stage('bloqueada'),
        prompts: stage('bloqueada'),
      },
      entrada: { tipo: e.tipo, texto: e.texto.trim(), mantenerPalabras: e.tipo === 'guion' && e.mantenerPalabras },
      preguntas: [],
      ajustes,
      guion: null,
      historial: [],
    },
  };
  p.carpeta = await createProductionFolder(p.nombre);
  if (e.tipo === 'pdf' && e.pdfBase64) {
    p.director!.entrada.pdf = await savePdf(p, e.pdfBase64);
    p.director!.entrada.pdfNombre = e.pdfNombre;
  }
  await saveNewProduction(p);
  return p;
}

export async function getDirectorProduction(id: string): Promise<Production> {
  const p = await requireProduction(id);
  needDirector(p);
  return p;
}

export async function listDirectorDrafts() {
  return (await listProductions())
    .filter((p) => p.director)
    .map((p) => ({ id: p.id, nombre: p.nombre, estado: p.estado, creada: p.creada, actualizada: p.actualizada }));
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export interface ActionResult {
  production: Production;
  /** Mensaje para la persona (p. ej. una escena que la IA no devolvió). */
  aviso?: string;
}

export async function runDirectorAction(id: string, raw: unknown, orchestrator?: unknown): Promise<ActionResult> {
  const action = ActionBody.parse(raw);
  const etapa = stageOf(action);
  try {
    return await dispatch(id, action, orchestrator);
  } catch (err) {
    if (etapa) await noteError(id, etapa, err);
    throw err;
  }
}

function stageOf(a: ActionInput): ActiveStageId | null {
  switch (a.accion) {
    case 'generar_preguntas':
      return 'preguntas';
    case 'generar_guion':
    case 'rehacer_escena':
      return 'guion';
    case 'generar_prompts':
    case 'rehacer_prompt':
      return 'prompts';
    default:
      return null;
  }
}

async function dispatch(id: string, a: ActionInput, orchestrator: unknown): Promise<ActionResult> {
  switch (a.accion) {
    case 'guardar_idea':
      return saveIdea(id, a.entrada);
    case 'generar_preguntas':
      return generateQuestions(id, orchestrator);
    case 'responder_preguntas':
      return answerQuestions(id, a.respuestas, false);
    case 'saltar_preguntas':
      return answerQuestions(id, {}, true);
    case 'guardar_ajustes':
      return saveSettings(id, a.ajustes);
    case 'generar_guion':
      return generateScript(id, orchestrator);
    case 'rehacer_escena':
      return redoScene(id, a.escenaId, a.indicacion, orchestrator);
    case 'editar_escena':
      return editScene(id, a.escenaId, a.cambios);
    case 'generar_prompts':
      return generatePrompts(id, a.soloFaltantes, orchestrator);
    case 'rehacer_prompt':
      return redoPrompt(id, a.escenaId, a.indicacion, orchestrator);
    case 'editar_prompt':
      return editPrompt(id, a.escenaId, a.texto);
    case 'aprobar':
      return approve(id, a.etapa);
  }
}

// ----- 1. Idea -----

async function saveIdea(id: string, e: InputBodyInput): Promise<ActionResult> {
  const { production } = await updateProduction(id, async (p) => {
    const d = needDirector(p);
    const newPdf = e.tipo === 'pdf' && e.pdfBase64;
    validateInput(e, Boolean(newPdf || (e.tipo === 'pdf' && d.entrada.pdf)));
    remember(d, 'idea', { entrada: d.entrada, confidencial: d.confidencial });
    const pdf = newPdf ? await savePdf(p, e.pdfBase64!) : e.tipo === 'pdf' ? d.entrada.pdf : undefined;
    d.entrada = {
      tipo: e.tipo,
      texto: e.texto.trim(),
      mantenerPalabras: e.tipo === 'guion' && e.mantenerPalabras,
      ...(pdf ? { pdf, pdfNombre: newPdf ? e.pdfNombre : d.entrada.pdfNombre } : {}),
    };
    d.confidencial = e.confidencial;
    touch(d, 'idea', 'aprobada');
    invalidateAfter(d, 'idea');
  });
  return { production };
}

// ----- 2. Preguntas -----

async function generateQuestions(id: string, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'preguntas', 'pedir preguntas');
  const rev = d.etapas.preguntas.rev;
  const { object, meta } = await think(p, d, QuestionsSchema, questionsPrompt(d, d.entrada.tipo === 'pdf'), 'preguntas de dirección', {
    orchestrator,
    withPdf: true,
  });
  const preguntas = object.preguntas
    .map((q) => ({ pregunta: q.pregunta.trim(), opciones: q.opciones.map((o) => o.trim()).filter(Boolean).slice(0, 3) }))
    .filter((q) => q.pregunta && q.opciones.length >= 2)
    .slice(0, 2)
    .map((q, i) => ({ id: `q${i + 1}`, ...q }));
  if (!preguntas.length) throw new ProductionError('La IA no devolvió preguntas válidas. Vuelve a intentarlo o salta este paso.', 502);

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    if (d2.etapas.preguntas.rev !== rev) conflict();
    if (d2.preguntas.length) remember(d2, 'preguntas', d2.preguntas);
    d2.preguntas = preguntas;
    touch(d2, 'preguntas', 'por_revisar', { modelo: meta.model, costoUSD: meta.costUSD });
    invalidateAfter(d2, 'preguntas');
  });
  return { production };
}

async function answerQuestions(id: string, respuestas: Record<string, string>, skip: boolean): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    requirePrevious(d, 'preguntas', 'responder');
    if (!skip && !d.preguntas.length) throw new ProductionError('Primero pide las preguntas (o salta este paso).');
    const before = JSON.stringify(d.preguntas);
    for (const q of d.preguntas) {
      const r = skip ? '' : (respuestas[q.id] ?? '').trim();
      if (r) q.respuesta = r;
      else delete q.respuesta;
    }
    const wasApproved = d.etapas.preguntas.estado === 'aprobada';
    if (before !== JSON.stringify(d.preguntas)) remember(d, 'preguntas', JSON.parse(before));
    touch(d, 'preguntas', 'aprobada');
    // Si solo se vuelve a confirmar lo mismo, no se invalida lo posterior
    if (!wasApproved || before !== JSON.stringify(d.preguntas)) invalidateAfter(d, 'preguntas');
    unlockNext(d, 'preguntas');
  });
  return { production };
}

// ----- 3. Ajustes -----

async function saveSettings(id: string, s: SettingsInput): Promise<ActionResult> {
  if (!BROLL_MODELS.some((m) => m.id === s.modeloBroll)) throw new ProductionError('Ese modelo de video no existe.');
  if (!brollModelsFor(s.modoVoz, s.formato).some((m) => m.id === s.modeloBroll)) {
    throw new ProductionError(
      s.modoVoz === 'native'
        ? 'Con "Los personajes hablan" el modelo debe generar audio y admitir el formato elegido.'
        : `Ese modelo no admite el formato ${s.formato}.`
    );
  }
  let avatarNombre: string | undefined;
  if (s.avatarId) {
    avatarNombre = (await getAvatar(s.avatarId).catch(() => null))?.name;
    if (!avatarNombre) throw new ProductionError('No encuentro ese avatar.', 404);
  }

  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    requirePrevious(d, 'ajustes', 'guardar los ajustes');
    const prev = d.ajustes;
    const next: DirectorSettings = { ...s, avatarNombre };
    const contentChanged =
      prev.formato !== next.formato || prev.duracionSeg !== next.duracionSeg || prev.modoVoz !== next.modoVoz || prev.avatarId !== next.avatarId;
    if (JSON.stringify(prev) !== JSON.stringify(next)) remember(d, 'ajustes', prev);
    d.ajustes = next;
    p.formato = next.formato;
    p.presupuestoUSD = next.presupuestoUSD;
    // El modelo define las duraciones admitidas: se reajustan siempre
    if (d.guion) {
      retimeScenes(d.guion.escenas, next);
      bump(d, 'guion');
    }
    const wasApproved = d.etapas.ajustes.estado === 'aprobada';
    touch(d, 'ajustes', 'aprobada');
    if (contentChanged || !wasApproved) invalidateAfter(d, 'ajustes');
    unlockNext(d, 'ajustes');
  });
  return { production };
}

// ----- 5. Guion -----

function buildScenes(d: DirectorState, raw: z.infer<typeof ScriptSchema>['escenas']): DirectorScene[] {
  const escenas: DirectorScene[] = raw.map((s, i) => ({
    id: `e${i + 1}`,
    orden: i + 1,
    tipo: allowedType(d, s.tipo),
    duracionSeg: s.duracionSeg,
    inicio: 0,
    fin: 0,
    queSeVe: s.queSeVe.trim(),
    dialogo: s.dialogo.trim(),
    version: 1,
    prompt: null,
  }));
  retimeScenes(escenas, d.ajustes);
  return escenas;
}

function assertSameWords(original: string, result: string) {
  if (normalizeWords(original) !== normalizeWords(result)) {
    throw new ProductionError('La IA cambió palabras de tu guion, así que se descartó. Vuelve a intentarlo.', 422);
  }
}

async function generateScript(id: string, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'guion', 'escribir el guion');
  const rev = d.etapas.guion.rev;
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const { object, meta } = await think(p, d, ScriptSchema, scriptPrompt(d, d.entrada.tipo === 'pdf'), 'guion por escenas', {
    orchestrator,
    withPdf: true,
    temperature: keep ? 0.2 : 0.7,
  });
  if (keep) assertSameWords(d.entrada.texto, object.escenas.map((s) => s.dialogo).join(' '));

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    if (d2.etapas.guion.rev !== rev) conflict();
    if (d2.guion) remember(d2, 'guion', d2.guion);
    d2.guion = { titulo: object.titulo.trim().slice(0, 80) || p2.nombre, generacion: (d2.guion?.generacion ?? 0) + 1, escenas: buildScenes(d2, object.escenas) };
    p2.nombre = d2.guion.titulo;
    touch(d2, 'guion', 'por_revisar', { modelo: meta.model, costoUSD: meta.costUSD });
    invalidateAfter(d2, 'guion');
  });
  return { production };
}

async function redoScene(id: string, escenaId: string, indicacion: string, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'guion', 'rehacer una escena');
  const scene = findScene(d, escenaId);
  const { version } = scene;
  const generacion = d.guion!.generacion;
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const { object, meta } = await think(p, d, OneSceneSchema, redoScenePrompt(d, scene, indicacion, d.entrada.tipo === 'pdf'), `rehacer escena ${scene.orden}`, {
    orchestrator,
    withPdf: true,
  });
  if (keep) assertSameWords(scene.dialogo, object.escena.dialogo);

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    const s = findScene(d2, escenaId);
    if (d2.guion!.generacion !== generacion || s.version !== version) conflict();
    remember(d2, `guion.${s.id}`, s);
    s.tipo = allowedType(d2, object.escena.tipo);
    s.queSeVe = object.escena.queSeVe.trim();
    s.dialogo = object.escena.dialogo.trim();
    s.duracionSeg = object.escena.duracionSeg;
    s.duracionPedidaSeg = undefined;
    s.version += 1;
    retimeScenes(d2.guion!.escenas, d2.ajustes);
    afterSceneChange(d2);
    d2.etapas.guion.modelo = meta.model;
  });
  return { production };
}

async function editScene(id: string, escenaId: string, c: { tipo?: DirectorSceneType; duracionSeg?: number; queSeVe?: string; dialogo?: string }): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    requirePrevious(d, 'guion', 'editar una escena');
    const s = findScene(d, escenaId);
    if (c.tipo && c.tipo !== s.tipo && allowedType(d, c.tipo) !== c.tipo) {
      throw new ProductionError('Con este modo de voz todas las escenas son tomas de apoyo. Cambia el modo en Ajustes.');
    }
    remember(d, `guion.${s.id}`, s);
    let content = false;
    if (c.tipo && c.tipo !== s.tipo) {
      s.tipo = c.tipo;
      content = true;
    }
    if (c.queSeVe !== undefined && c.queSeVe.trim() !== s.queSeVe) {
      s.queSeVe = c.queSeVe.trim();
      content = true;
    }
    if (c.dialogo !== undefined && c.dialogo.trim() !== s.dialogo) {
      s.dialogo = c.dialogo.trim();
      content = true;
    }
    if (c.duracionSeg !== undefined) {
      s.duracionSeg = c.duracionSeg;
      s.duracionPedidaSeg = undefined;
    }
    // Solo los cambios de contenido dejan viejo el prompt; la duración se ajusta sola
    if (content) s.version += 1;
    retimeScenes(d.guion!.escenas, d.ajustes);
    if (content) afterSceneChange(d);
    else bump(d, 'guion');
  });
  return { production };
}

// ----- 8. Prompts -----

async function generatePrompts(id: string, soloFaltantes: boolean, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'prompts', 'escribir los prompts');
  const all = d.guion?.escenas ?? [];
  const targets = soloFaltantes ? all.filter(promptIsStale) : all;
  if (!targets.length) throw new ProductionError('Todos los prompts están al día.');
  const versions = new Map(targets.map((s) => [s.id, s.version]));
  const generacion = d.guion!.generacion;

  const { object, meta } = await think(p, d, PromptsSchema, promptsPrompt(d, targets), `prompts de ${targets.length} escena(s)`, { orchestrator });
  const byOrder = new Map(object.prompts.map((x) => [Math.round(x.orden), x.prompt.trim()]));

  const missing: number[] = [];
  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    if (d2.guion?.generacion !== generacion) conflict();
    remember(
      d2,
      'prompts',
      d2.guion.escenas.map((s) => ({ id: s.id, prompt: s.prompt }))
    );
    for (const s of d2.guion.escenas) {
      if (!versions.has(s.id)) continue;
      const text = byOrder.get(s.orden);
      // Si la escena cambió mientras tanto, su prompt nuevo ya no sirve
      if (!text || versions.get(s.id) !== s.version) {
        missing.push(s.orden);
        continue;
      }
      s.prompt = { texto: text, deVersion: s.version, modelo: meta.model };
    }
    touch(d2, 'prompts', 'por_revisar', { modelo: meta.model, costoUSD: meta.costUSD });
  });
  return {
    production,
    aviso: missing.length ? `Faltó el prompt de la escena ${missing.join(', ')}. Usa "Rehacer" en esa escena.` : undefined,
  };
}

async function redoPrompt(id: string, escenaId: string, indicacion: string, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'prompts', 'rehacer un prompt');
  const scene = findScene(d, escenaId);
  const { version } = scene;
  const generacion = d.guion!.generacion;
  const { object, meta } = await think(p, d, OnePromptSchema, redoPromptPrompt(d, scene, indicacion), `prompt escena ${scene.orden}`, { orchestrator });
  const text = object.prompt.trim();
  if (!text) throw new ProductionError('La IA devolvió un prompt vacío. Vuelve a intentarlo.', 502);

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    const s = findScene(d2, escenaId);
    if (d2.guion!.generacion !== generacion || s.version !== version) conflict();
    remember(d2, `prompts.${s.id}`, s.prompt);
    s.prompt = { texto: text, deVersion: s.version, modelo: meta.model };
    touch(d2, 'prompts', 'por_revisar', { modelo: meta.model });
  });
  return { production };
}

async function editPrompt(id: string, escenaId: string, texto: string): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    requirePrevious(d, 'prompts', 'editar un prompt');
    const s = findScene(d, escenaId);
    remember(d, `prompts.${s.id}`, s.prompt);
    s.prompt = { texto: texto.trim(), deVersion: s.version, modelo: 'manual' };
    touch(d, 'prompts', 'por_revisar');
  });
  return { production };
}

// ----- Aprobar -----

async function approve(id: string, etapa: ActiveStageId): Promise<ActionResult> {
  if (etapa === 'preguntas') {
    const p = await getDirectorProduction(id);
    const respuestas = Object.fromEntries(p.director!.preguntas.map((q) => [q.id, q.respuesta ?? '']));
    return answerQuestions(id, respuestas, !p.director!.preguntas.length);
  }
  if (etapa === 'ajustes') {
    const p = await getDirectorProduction(id);
    return saveSettings(id, p.director!.ajustes);
  }
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    requirePrevious(d, etapa, 'aprobar');
    if (etapa === 'guion') {
      const escenas = d.guion?.escenas ?? [];
      if (!escenas.length) throw new ProductionError('Todavía no hay guion.');
      if (d.ajustes.modoVoz !== 'avatar' && escenas.some((s) => s.tipo === 'avatar')) {
        throw new ProductionError('El guion tiene escenas de persona hablando, pero el modo de voz ya no lo permite. Rehaz el guion.');
      }
    }
    if (etapa === 'prompts') {
      const stale = (d.guion?.escenas ?? []).filter(promptIsStale).map((s) => s.orden);
      if (!d.guion?.escenas.length) throw new ProductionError('Todavía no hay guion.');
      if (stale.length) throw new ProductionError(`Falta o está desactualizado el prompt de la escena ${stale.join(', ')}.`);
    }
    touch(d, etapa, 'aprobada');
    unlockNext(d, etapa);
  });
  return { production };
}
