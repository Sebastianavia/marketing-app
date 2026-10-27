import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { getAvatar } from '@/lib/avatars/avatar-store';
import { BROLL_MODELS, DEFAULT_BROLL_MODEL } from '@/config/broll-models';
import { sttCost } from '@/config/cost-rates';
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
import { alignedScriptPrompt, promptsPrompt, questionsPrompt, redoPromptPrompt, redoScenePrompt, scriptPrompt, tagProposalPrompt } from './prompts';
import { renameMention, tagSignature, uniqueMention } from './mentions';
import { ChatBody, ChatReplySchema, chatPrompt, planChatAction, type ChatPlan } from './chat';
import { buildAlignedScenes, isAligned, maxClipSeg, refitAlignedClips, snapToSilences, wordsToPhrases } from './voiceover';
import { detectSilences, transcribeWithGemini } from './voiceover-audio';
import { transcribeWithElevenLabs } from '@/lib/generation/transcribe';
import { DailyLimitError } from '@/lib/usage/usage-store';
import { imageForModel, refAbsPath, trashRefFile, validateIncoming, writeRefFiles, type IncomingRef } from './references';
import {
  ActionBody,
  OnePromptSchema,
  OneSceneSchema,
  PromptsSchema,
  QuestionsSchema,
  AlignedScriptSchema,
  ScriptSchema,
  TagProposalSchema,
  type ActionInput,
  type InputBodyInput,
  type SettingsInput,
} from './schemas';
import { ACTIVE_ORDER, invalidateAfter, previousApproved, promptIsStale, remember, touch, unlockNext } from './stages';
import type { ActiveStageId, DirectorRef, DirectorScene, DirectorSceneType, DirectorSettings, DirectorState, DirectorTag, StageState } from './types';

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

type ModelFile = { data: Uint8Array; mediaType: string; filename?: string };

/** PDF de referencia que cuentan como material: los de todo el proyecto y, si se indica, los de esa escena (máx. 3). */
function materialRefs(d: DirectorState, sceneId?: string): DirectorRef[] {
  return (d.referencias ?? []).filter((r) => r.medio === 'pdf' && (!r.escenaId || r.escenaId === sceneId)).slice(0, 3);
}

/** ¿Hay algún PDF que la IA debe leer? (el de la Idea o los de + Ref) */
function hasMaterial(d: DirectorState, sceneId?: string) {
  return (d.entrada.tipo === 'pdf' && Boolean(d.entrada.pdf)) || materialRefs(d, sceneId).length > 0;
}

async function pdfFiles(p: Production, d: DirectorState, sceneId?: string): Promise<ModelFile[] | undefined> {
  const out: ModelFile[] = [];
  if (d.entrada.tipo === 'pdf' && d.entrada.pdf) {
    const file = path.join(/*turbopackIgnore: true*/ p.carpeta, d.entrada.pdf);
    if (!fsSync.existsSync(file)) throw new ProductionError('No encuentro el PDF de esta producción en su carpeta. Vuelve a subirlo en la etapa Idea.', 404);
    out.push({ data: new Uint8Array(await fs.readFile(file)), mediaType: 'application/pdf', filename: d.entrada.pdfNombre || 'material.pdf' });
  }
  for (const r of materialRefs(d, sceneId)) {
    const file = refAbsPath(p.carpeta, r.archivo);
    // Un PDF de referencia que ya no está no frena el trabajo
    if (fsSync.existsSync(file)) out.push({ data: new Uint8Array(await fs.readFile(file)), mediaType: 'application/pdf', filename: r.nombreOriginal });
  }
  return out.length ? out : undefined;
}

async function think<S extends z.ZodType>(
  p: Production,
  d: DirectorState,
  schema: S,
  built: { system: string; prompt: string },
  description: string,
  opts: { orchestrator?: unknown; withPdf?: boolean; sceneId?: string; files?: ModelFile[]; temperature?: number } = {}
) {
  const pdfs = opts.withPdf ? await pdfFiles(p, d, opts.sceneId) : undefined;
  const all = [...(pdfs ?? []), ...(opts.files ?? [])];
  const files = all.length ? all : undefined;
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
      return generateScript(id, orchestrator, a.indicacion);
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
    case 'proponer_etiquetas':
      return proposeTags(id, a.refIds, orchestrator);
    case 'guardar_etiqueta':
      return saveTag(id, a);
    case 'borrar_etiqueta':
      return deleteTag(id, a.etiquetaId);
    case 'unir_etiquetas':
      return mergeTags(id, a.desde, a.hacia);
    case 'mover_referencia':
      return moveRef(id, a.refId, a.etiquetaId, a.escenaId);
    case 'borrar_referencia':
      return deleteRef(id, a.refId);
    case 'usar_locucion':
      return chooseVoiceover(id, a.refId, a.usarComoVoz);
    case 'quitar_locucion':
      return removeVoiceover(id);
    case 'transcribir_locucion':
      return transcribeVoiceover(id, a.motor, a.costoVisto);
    case 'editar_transcripcion':
      return editTranscript(id, a.frases);
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
  const { object, meta } = await think(p, d, QuestionsSchema, questionsPrompt(d, hasMaterial(d)), 'preguntas de dirección', {
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
    // Con la locución propia como voz: la duración la fija el audio y no hay voz nativa
    if (d.locucion?.usarComoVoz) {
      if (next.modoVoz === 'native') {
        throw new ProductionError('Con tu locución como voz no se puede usar «Los personajes hablan» (esos modelos ponen su propia voz). Elige voz en off o presentador.');
      }
      next.duracionSeg = lockedDuration(d.locucion.duracionSeg);
    }
    const contentChanged =
      prev.formato !== next.formato || prev.duracionSeg !== next.duracionSeg || prev.modoVoz !== next.modoVoz || prev.avatarId !== next.avatarId;
    if (JSON.stringify(prev) !== JSON.stringify(next)) remember(d, 'ajustes', prev);
    d.ajustes = next;
    p.formato = next.formato;
    p.presupuestoUSD = next.presupuestoUSD;
    // El modelo define las duraciones admitidas: se reajustan siempre
    if (d.guion) {
      retime(d.guion.escenas, next);
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

/** Ajusta duraciones al modelo; si el guion sigue la locución, solo recalcula el clip de cada escena. */
function retime(escenas: DirectorScene[], ajustes: DirectorSettings) {
  if (isAligned(escenas)) refitAlignedClips(escenas, ajustes);
  else retimeScenes(escenas, ajustes);
}

/** Duración del video con locución propia (lo que admite Ajustes: 5 a 180 s). */
function lockedDuration(seconds: number) {
  return Math.min(180, Math.max(5, Math.round(seconds)));
}

function assertSameWords(original: string, result: string) {
  if (normalizeWords(original) !== normalizeWords(result)) {
    throw new ProductionError('La IA cambió palabras de tu guion, así que se descartó. Vuelve a intentarlo.', 422);
  }
}

async function generateScript(id: string, orchestrator: unknown, indicacion = ''): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  requirePrevious(d, 'guion', 'escribir el guion');
  if (d.locucion?.usarComoVoz && d.locucion.transcripcion?.frases.length) return generateAlignedScript(p, orchestrator, indicacion);
  const rev = d.etapas.guion.rev;
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const { object, meta } = await think(p, d, ScriptSchema, scriptPrompt(d, hasMaterial(d), indicacion), 'guion por escenas', {
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
    adoptOrphanRefs(d2);
    touch(d2, 'guion', 'por_revisar', { modelo: meta.model, costoUSD: meta.costUSD });
    invalidateAfter(d2, 'guion');
  });
  return { production };
}

/** Guion sobre la locución propia: la IA elige qué se ve y agrupa frases; el código pone tiempos y diálogo. */
async function generateAlignedScript(p: Production, orchestrator: unknown, indicacion: string): Promise<ActionResult> {
  const d = p.director!;
  const loc = d.locucion!;
  const t = loc.transcripcion!;
  const rev = d.etapas.guion.rev;
  const max = maxClipSeg('broll', d.ajustes);
  const { object, meta } = await think(p, d, AlignedScriptSchema, alignedScriptPrompt(d, t.frases, max, indicacion, hasMaterial(d)), 'guion sobre tu locución', {
    orchestrator,
    withPdf: true,
    temperature: 0.5,
  });

  const { production } = await updateProduction(p.id, (p2) => {
    const d2 = needDirector(p2);
    if (d2.etapas.guion.rev !== rev || d2.locucion?.transcripcion?.creada !== t.creada) conflict();
    const escenas = buildAlignedScenes(
      d2.locucion!.transcripcion!.frases,
      object.escenas.map((e) => ({ desde: e.desde, hasta: e.hasta, tipo: e.tipo, queSeVe: e.queSeVe })),
      d2.locucion!.duracionSeg,
      d2.ajustes,
      (tipo) => allowedType(d2, tipo)
    );
    if (!escenas.length) throw new ProductionError('La IA no devolvió escenas válidas. Vuelve a intentarlo.', 502);
    if (d2.guion) remember(d2, 'guion', d2.guion);
    d2.guion = { titulo: object.titulo.trim().slice(0, 80) || p2.nombre, generacion: (d2.guion?.generacion ?? 0) + 1, escenas };
    p2.nombre = d2.guion.titulo;
    adoptOrphanRefs(d2);
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
  // Alineada a la locución: el diálogo y los tiempos los manda el audio; solo cambia lo que se ve
  const aligned = Boolean(scene.audio);
  const keep = !aligned && d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const { object, meta } = await think(p, d, OneSceneSchema, redoScenePrompt(d, scene, indicacion, hasMaterial(d, scene.id), aligned), `rehacer escena ${scene.orden}`, {
    orchestrator,
    withPdf: true,
    sceneId: scene.id,
  });
  if (keep) assertSameWords(scene.dialogo, object.escena.dialogo);

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    const s = findScene(d2, escenaId);
    if (d2.guion!.generacion !== generacion || s.version !== version) conflict();
    remember(d2, `guion.${s.id}`, s);
    s.tipo = allowedType(d2, object.escena.tipo);
    s.queSeVe = object.escena.queSeVe.trim();
    if (!s.audio) {
      s.dialogo = object.escena.dialogo.trim();
      s.duracionSeg = object.escena.duracionSeg;
      s.duracionPedidaSeg = undefined;
    }
    s.version += 1;
    retime(d2.guion!.escenas, d2.ajustes);
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
    if (s.audio && ((c.dialogo !== undefined && c.dialogo.trim() !== s.dialogo) || (c.duracionSeg !== undefined && c.duracionSeg !== s.duracionSeg))) {
      throw new ProductionError('Esta escena sigue tu locución: el diálogo y la duración los manda el audio. Corrige las palabras en la transcripción.');
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
    retime(d.guion!.escenas, d.ajustes);
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
  const targets = soloFaltantes ? all.filter((s) => promptIsStale(s, d)) : all;
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
      s.prompt = { texto: text, deVersion: s.version, deEtiquetas: tagSignature(d2, s), modelo: meta.model };
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
    s.prompt = { texto: text, deVersion: s.version, deEtiquetas: tagSignature(d2, s), modelo: meta.model };
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
    s.prompt = { texto: texto.trim(), deVersion: s.version, deEtiquetas: tagSignature(d, s), modelo: 'manual' };
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
      const stale = (d.guion?.escenas ?? []).filter((s) => promptIsStale(s, d)).map((s) => s.orden);
      if (!d.guion?.escenas.length) throw new ProductionError('Todavía no hay guion.');
      if (stale.length) throw new ProductionError(`Falta o está desactualizado el prompt de la escena ${stale.join(', ')}.`);
    }
    touch(d, etapa, 'aprobada');
    unlockNext(d, etapa);
  });
  return { production };
}

// ---------------------------------------------------------------------------
// Chat libre (v2, paso 2): responde con el contexto y propone una acción; el código decide si se ejecuta sola
// ---------------------------------------------------------------------------

/** $0.0040 → "$0.004"; menos de una milésima → "< $0.001". */
export function formatUSD(n: number): string {
  if (n > 0 && n < 0.001) return '< $0.001';
  return `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
}

export interface ChatResult {
  respuesta: string;
  plan: ChatPlan | null;
  /** Por qué no se propone nada aunque la IA quería (etapa sin aprobar, escena que no existe…). */
  motivo?: string;
  modelo: string;
  costoUSD: number;
}

export async function chatWithDirector(id: string, raw: unknown, orchestrator?: unknown): Promise<ChatResult> {
  const input = ChatBody.parse(raw);
  const p = await getDirectorProduction(id);
  const d = p.director!;
  const { object, meta } = await think(p, d, ChatReplySchema, chatPrompt(d, p.nombre, input), 'chat', { orchestrator, withPdf: true, temperature: 0.4 });
  const textCost = meta.costUSD > 0 || meta.mode !== 'free' ? '< 1 ¢' : '$0';
  const elevenCost = d.locucion ? `≈ ${formatUSD(sttCost(d.locucion.duracionSeg))}` : undefined;
  const { plan, motivo } = planChatAction(d, object.accion, { textCost, elevenCost, enfoque: input.enfoque });
  return { respuesta: object.respuesta.trim().slice(0, 1500), plan, motivo, modelo: meta.model, costoUSD: meta.costUSD };
}

// ---------------------------------------------------------------------------
// Referencias y etiquetas (v2, paso 2) — $0 salvo la visión con "confidencial" (Claude Haiku)
// ---------------------------------------------------------------------------

const MAX_TAGS = 30;
const newRefId = () => `ref_${crypto.randomUUID().slice(0, 8)}`;
const newTagId = () => `tag_${crypto.randomUUID().slice(0, 8)}`;

function findRef(d: DirectorState, refId: string): DirectorRef {
  const r = d.referencias?.find((x) => x.id === refId);
  if (!r) throw new ProductionError('Esa referencia ya no existe.', 404);
  return r;
}

function findTagById(d: DirectorState, tagId: string): DirectorTag {
  const t = d.etiquetas?.find((x) => x.id === tagId);
  if (!t) throw new ProductionError('Esa etiqueta ya no existe.', 404);
  return t;
}

const VISUAL_KINDS: DirectorTag['tipo'][] = ['personaje', 'lugar', 'producto', 'estilo'];

/** Fotos → etiquetas visuales; audio → voz o música; PDF → producto. */
function fits(medio: DirectorRef['medio'], tipo: DirectorTag['tipo']): boolean {
  if (medio === 'imagen') return VISUAL_KINDS.includes(tipo);
  if (medio === 'audio') return tipo === 'voz' || tipo === 'musica';
  return tipo === 'producto';
}

function fitError(r: DirectorRef, t: { tipo: DirectorTag['tipo']; nombre: string }): ProductionError {
  const que = r.medio === 'imagen' ? 'Una foto' : r.medio === 'audio' ? 'Un audio' : 'Un PDF';
  const va = r.medio === 'imagen' ? 'personaje, lugar, producto o estilo' : r.medio === 'audio' ? 'voz o música' : 'producto';
  return new ProductionError(`${que} no puede ir en «${t.nombre}» (${t.tipo}): solo en ${va}.`);
}

/** Cambia @Viejo por @Nuevo en la idea y en las escenas (sin tocar versiones: la etiqueta ya sube su rev). */
function rewriteMentions(d: DirectorState, from: string, to: string) {
  d.entrada.texto = renameMention(d.entrada.texto, from, to);
  for (const s of d.guion?.escenas ?? []) {
    s.queSeVe = renameMention(s.queSeVe, from, to);
    s.dialogo = renameMention(s.dialogo, from, to);
  }
}

/** Algo cambió en las etiquetas: si los prompts estaban aprobados y alguno quedó viejo, hay que revisarlos. */
function afterTagChange(d: DirectorState) {
  const stale = (d.guion?.escenas ?? []).some((s) => s.prompt && promptIsStale(s, d));
  if (stale && d.etapas.prompts.estado === 'aprobada') touch(d, 'prompts', 'por_revisar');
}

/** Referencias de escenas que ya no existen (se rehízo el guion con menos escenas) pasan a todo el proyecto. */
function adoptOrphanRefs(d: DirectorState) {
  const ids = new Set((d.guion?.escenas ?? []).map((s) => s.id));
  for (const r of d.referencias ?? []) if (r.escenaId && !ids.has(r.escenaId)) delete r.escenaId;
}

export interface AddRefsOptions {
  /** Solo para esa escena (si no, todo el proyecto). */
  escenaId?: string;
  /** Directamente a esa etiqueta (si el tipo encaja). */
  etiquetaId?: string;
}

/** Guarda los archivos de + Ref en la carpeta y los registra. Devuelve los ids nuevos. */
export async function addReferences(id: string, files: IncomingRef[], o: AddRefsOptions = {}): Promise<ActionResult & { nuevas: string[] }> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  validateIncoming(files, d.referencias?.length ?? 0);
  if (o.escenaId) findScene(d, o.escenaId);
  const tag = o.etiquetaId ? findTagById(d, o.etiquetaId) : undefined;

  const written = await writeRefFiles(p.carpeta, files);
  const now = new Date().toISOString();
  const refs: DirectorRef[] = written.map((w) => ({
    id: newRefId(),
    ...w,
    subida: now,
    ...(o.escenaId ? { escenaId: o.escenaId } : {}),
    ...(tag && fits(w.medio, tag.tipo) ? { etiquetaId: tag.id } : {}),
  }));
  try {
    const { production } = await updateProduction(id, (p2) => {
      const d2 = needDirector(p2);
      const list = (d2.referencias ??= []);
      validateIncoming(files, list.length);
      if (o.escenaId) findScene(d2, o.escenaId);
      if (tag && !d2.etiquetas?.some((t) => t.id === tag.id)) for (const r of refs) delete r.etiquetaId;
      list.push(...refs);
      afterTagChange(d2);
    });
    return { production, nuevas: refs.map((r) => r.id) };
  } catch (err) {
    await Promise.all(written.map((w) => fs.rm(path.join(/*turbopackIgnore: true*/ p.carpeta, w.archivo), { force: true })));
    throw err;
  }
}

/** El agente mira las fotos sin etiqueta (o las indicadas) y propone etiquetas sin confirmar. */
async function proposeTags(id: string, refIds: string[] | undefined, orchestrator: unknown): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  const pool = (d.referencias ?? []).filter((r) => r.medio === 'imagen' && (refIds ? refIds.includes(r.id) : !r.etiquetaId)).slice(0, 14);
  if (!pool.length) throw new ProductionError('No hay fotos sin etiqueta para revisar.');
  const files = await Promise.all(pool.map((r) => imageForModel(p.carpeta, r)));
  const { object } = await think(p, d, TagProposalSchema, tagProposalPrompt(d, pool.length), `etiquetas de ${pool.length} foto(s)`, {
    orchestrator,
    files,
    temperature: 0.3,
  });

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    const tags = (d2.etiquetas ??= []);
    const used = new Set<number>();
    for (const g of object.grupos) {
      const idx = g.fotos.map((n) => Math.round(n)).filter((n) => n >= 1 && n <= pool.length && !used.has(n));
      if (!idx.length) continue;
      const wanted = g.existente?.replace(/^@/, '').toLowerCase();
      const existing = wanted ? tags.find((t) => t.mencion.toLowerCase() === wanted) : undefined;
      let tag = existing && VISUAL_KINDS.includes(existing.tipo) ? existing : undefined;
      if (!tag) {
        if (tags.length >= MAX_TAGS) break;
        const nombre = g.nombre.trim().slice(0, 60) || 'Sin nombre';
        tag = { id: newTagId(), tipo: g.tipo, nombre, mencion: uniqueMention(tags, nombre), descripcion: g.descripcion.trim().slice(0, 600), confirmada: false, rev: 1 };
        tags.push(tag);
      }
      for (const n of idx) {
        used.add(n);
        // Solo si sigue sin etiqueta (la persona pudo moverla mientras la IA miraba)
        const r = d2.referencias?.find((x) => x.id === pool[n - 1].id);
        if (r && !r.etiquetaId) r.etiquetaId = tag.id;
      }
    }
    afterTagChange(d2);
  });
  return { production };
}

type SaveTagInput = Extract<ActionInput, { accion: 'guardar_etiqueta' }>;

/** Crear o corregir una etiqueta. Guardarla = confirmarla. */
async function saveTag(id: string, a: SaveTagInput): Promise<ActionResult> {
  let avatarNombre: string | undefined;
  if (a.avatarId) {
    if (a.tipo !== 'personaje') throw new ProductionError('Solo un personaje se puede enlazar a un avatar.');
    avatarNombre = (await getAvatar(a.avatarId).catch(() => null))?.name;
    if (!avatarNombre) throw new ProductionError('No encuentro ese avatar.', 404);
  }
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const tags = (d.etiquetas ??= []);
    const nombre = a.nombre.trim();
    const descripcion = a.descripcion.trim();
    let t = a.etiquetaId ? findTagById(d, a.etiquetaId) : undefined;
    if (!t) {
      if (tags.length >= MAX_TAGS) throw new ProductionError(`Máximo ${MAX_TAGS} etiquetas por proyecto.`);
      t = { id: newTagId(), tipo: a.tipo, nombre, mencion: uniqueMention(tags, nombre), descripcion, confirmada: true, rev: 1 };
      tags.push(t);
    } else {
      remember(d, `etiquetas.${t.id}`, t);
      const changed = t.tipo !== a.tipo || t.nombre !== nombre || t.descripcion !== descripcion || (t.avatarId ?? null) !== a.avatarId;
      if (t.nombre !== nombre) {
        const m = uniqueMention(tags, nombre, t.id);
        if (m !== t.mencion) rewriteMentions(d, t.mencion, m);
        t.mencion = m;
        t.nombre = nombre;
      }
      t.tipo = a.tipo;
      t.descripcion = descripcion;
      t.confirmada = true;
      if (changed) t.rev += 1;
    }
    if (a.avatarId) {
      t.avatarId = a.avatarId;
      t.avatarNombre = avatarNombre;
    } else {
      delete t.avatarId;
      delete t.avatarNombre;
    }
    for (const refId of a.refIds ?? []) {
      const r = findRef(d, refId);
      if (!fits(r.medio, t.tipo)) throw fitError(r, t);
      r.etiquetaId = t.id;
    }
    const tagId = t.id;
    const wrong = (d.referencias ?? []).find((r) => r.etiquetaId === tagId && !fits(r.medio, a.tipo));
    if (wrong) throw fitError(wrong, t);
    afterTagChange(d);
  });
  return { production };
}

/** Borra la etiqueta; sus archivos quedan sin etiqueta y las @ pasan a ser texto normal. */
async function deleteTag(id: string, tagId: string): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const t = findTagById(d, tagId);
    remember(d, `etiquetas.${t.id}`, t);
    d.etiquetas = d.etiquetas!.filter((x) => x.id !== tagId);
    for (const r of d.referencias ?? []) if (r.etiquetaId === tagId) delete r.etiquetaId;
    afterTagChange(d);
  });
  return { production };
}

/** Une dos etiquetas (p. ej. la IA separó a la misma persona en dos). */
async function mergeTags(id: string, desde: string, hacia: string): Promise<ActionResult> {
  if (desde === hacia) throw new ProductionError('Elige dos etiquetas distintas.');
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const from = findTagById(d, desde);
    const to = findTagById(d, hacia);
    for (const r of d.referencias ?? []) {
      if (r.etiquetaId !== from.id) continue;
      if (!fits(r.medio, to.tipo)) throw fitError(r, to);
      r.etiquetaId = to.id;
    }
    remember(d, `etiquetas.${from.id}`, from);
    rewriteMentions(d, from.mencion, to.mencion);
    d.etiquetas = d.etiquetas!.filter((x) => x.id !== from.id);
    to.rev += 1;
    afterTagChange(d);
  });
  return { production };
}

async function moveRef(id: string, refId: string, etiquetaId: string | null | undefined, escenaId: string | null | undefined): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const r = findRef(d, refId);
    if (etiquetaId !== undefined) {
      if (etiquetaId === null) delete r.etiquetaId;
      else {
        const t = findTagById(d, etiquetaId);
        if (!fits(r.medio, t.tipo)) throw fitError(r, t);
        r.etiquetaId = t.id;
      }
    }
    if (escenaId !== undefined) {
      if (escenaId === null) delete r.escenaId;
      else r.escenaId = findScene(d, escenaId).id;
    }
    afterTagChange(d);
  });
  return { production };
}

// ---------------------------------------------------------------------------
// Video desde mi audio (v2, paso 2). Usar la locución en el montaje es de la Fase 4: aquí se guarda y se respeta.
// ---------------------------------------------------------------------------

const MIN_VOICEOVER_SEG = 3;
const MAX_VOICEOVER_SEG = 180;

/** El guion que había ya no sigue al audio: hay que rehacerlo. */
function staleScript(d: DirectorState) {
  if (!d.guion?.escenas.length) return;
  if (d.etapas.guion.estado !== 'desactualizada' && d.etapas.guion.estado !== 'bloqueada') touch(d, 'guion', 'desactualizada');
  invalidateAfter(d, 'guion');
}

/** Elige un audio de + Ref como locución del video (FFmpeg ya midió su duración al subirlo). */
async function chooseVoiceover(id: string, refId: string, usar: boolean): Promise<ActionResult> {
  let aviso: string | undefined;
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const ref = findRef(d, refId);
    if (ref.medio !== 'audio') throw new ProductionError('La locución tiene que ser un audio.');
    const dur = ref.duracionSeg;
    if (!dur) throw new ProductionError('No pude medir la duración de este audio. ¿Está FFmpeg instalado? Vuelve a subirlo.');
    if (dur < MIN_VOICEOVER_SEG) throw new ProductionError(`La locución dura ${dur.toFixed(1)} s: es demasiado corta.`);
    if (dur > MAX_VOICEOVER_SEG) throw new ProductionError(`La locución dura ${Math.round(dur)} s: el modo Director admite hasta ${MAX_VOICEOVER_SEG / 60} minutos.`);
    const same = d.locucion?.refId === refId;
    if (d.locucion) remember(d, 'locucion', d.locucion);
    d.locucion = { refId, duracionSeg: dur, usarComoVoz: usar, ...(same && d.locucion?.transcripcion ? { transcripcion: d.locucion.transcripcion } : {}) };
    let changed = !same;
    if (usar) {
      const total = lockedDuration(dur);
      if (d.ajustes.duracionSeg !== total) {
        d.ajustes.duracionSeg = total;
        changed = true;
      }
      if (d.ajustes.modoVoz === 'native') {
        // Los modelos con voz propia no pueden usar tu audio
        d.ajustes.modoVoz = 'voiceover';
        const models = brollModelsFor('voiceover', d.ajustes.formato);
        if (!models.some((m) => m.id === d.ajustes.modeloBroll)) d.ajustes.modeloBroll = models[0]?.id ?? d.ajustes.modeloBroll;
        aviso = 'Cambié la voz a «Voz en off»: con «Los personajes hablan» el modelo pondría su propia voz.';
        changed = true;
      }
    }
    if (changed) staleScript(d);
  });
  return { production, aviso };
}

async function removeVoiceover(id: string): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    if (!d.locucion) return;
    remember(d, 'locucion', d.locucion);
    delete d.locucion;
    // Las escenas dejan de seguir al audio: vuelven a las duraciones del modelo
    if (isAligned(d.guion?.escenas)) {
      for (const s of d.guion!.escenas) {
        delete s.audio;
        delete s.clipSeg;
      }
      retimeScenes(d.guion!.escenas, d.ajustes);
      staleScript(d);
    }
  });
  return { production };
}

async function transcribeVoiceover(id: string, motor: 'gemini' | 'elevenlabs', costoVisto?: number): Promise<ActionResult> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  const loc = d.locucion;
  if (!loc) throw new ProductionError('Primero elige tu locución (un audio de + Ref → «Locución del video»).');
  const ref = findRef(d, loc.refId);
  const file = refAbsPath(p.carpeta, ref.archivo);
  if (!fsSync.existsSync(file)) throw new ProductionError('El audio de la locución ya no está en la carpeta de la producción.', 404);

  let frases;
  let modelo: string;
  let costoUSD = 0;
  let ajustadaASilencios = false;
  if (motor === 'gemini') {
    if (d.confidencial) throw new ProductionError('Con «Confidencial» el audio no se envía a Gemini gratis. Usa la transcripción de ElevenLabs (de pago).');
    ({ frases, modelo } = await transcribeWithGemini(file, loc.duracionSeg));
    // Gemini da tiempos aproximados: cada corte se lleva al silencio real más cercano
    const silences = await detectSilences(file).catch(() => []);
    const snapped = snapToSilences(frases, silences);
    frases = snapped.frases;
    ajustadaASilencios = snapped.movidos > 0;
  } else {
    const expected = sttCost(loc.duracionSeg);
    if (costoVisto !== undefined && Math.abs(costoVisto - expected) > 0.0005) {
      throw new ProductionError(`El precio cambió: ahora son unos ${formatUSD(expected)}. Vuelve a confirmarlo.`, 409);
    }
    try {
      const r = await transcribeWithElevenLabs(file, { seconds: loc.duracionSeg, productionId: p.id, label: ref.nombreOriginal });
      frases = wordsToPhrases(r.words);
      modelo = r.model;
      costoUSD = r.costUSD;
      // Las palabras con tiempos quedan aparte (no inflan produccion.json)
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, 'referencias', 'locucion-palabras.json'), JSON.stringify(r.words, null, 1)).catch(() => undefined);
    } catch (err) {
      if (err instanceof DailyLimitError) throw new ProductionError(err.message, 402);
      throw err;
    }
  }
  if (!frases.length) throw new ProductionError('La transcripción salió vacía. ¿El audio tiene voz?', 502);

  const { production } = await updateProduction(id, (p2) => {
    const d2 = needDirector(p2);
    if (d2.locucion?.refId !== loc.refId) conflict();
    if (d2.locucion.transcripcion) remember(d2, 'locucion.transcripcion', d2.locucion.transcripcion);
    d2.locucion.transcripcion = { motor, modelo, costoUSD, frases, ajustadaASilencios, creada: new Date().toISOString() };
    if (d2.locucion.usarComoVoz) staleScript(d2);
  });
  return { production };
}

/** Corregir palabras mal oídas sin mover los tiempos. Si el guion sigue al audio, sus diálogos se actualizan. */
async function editTranscript(id: string, textos: string[]): Promise<ActionResult> {
  const { production } = await updateProduction(id, (p) => {
    const d = needDirector(p);
    const t = d.locucion?.transcripcion;
    if (!t) throw new ProductionError('Todavía no hay transcripción.');
    if (textos.length !== t.frases.length) throw new ProductionError('La transcripción cambió mientras la editabas. Vuelve a abrirla.', 409);
    if (textos.some((x) => !x.trim())) throw new ProductionError('Ninguna frase puede quedar vacía.');
    remember(d, 'locucion.transcripcion', t);
    t.frases = t.frases.map((f, i) => ({ ...f, texto: textos[i].replace(/\s+/g, ' ').trim() }));
    if (isAligned(d.guion?.escenas)) {
      let changed = false;
      for (const s of d.guion!.escenas) {
        const dialogo = t.frases.slice(s.audio!.desde - 1, s.audio!.hasta).map((f) => f.texto).join(' ');
        if (dialogo !== s.dialogo) {
          s.dialogo = dialogo;
          s.version += 1;
          changed = true;
        }
      }
      if (changed) afterSceneChange(d);
    }
  });
  return { production };
}

/** El archivo no se pierde: pasa a referencias/_borradas. */
async function deleteRef(id: string, refId: string): Promise<ActionResult> {
  const { production } = await updateProduction(id, async (p) => {
    const d = needDirector(p);
    const r = findRef(d, refId);
    await trashRefFile(p.carpeta, r.archivo);
    d.referencias = d.referencias!.filter((x) => x.id !== refId);
    if (d.locucion?.refId === refId) delete d.locucion;
    afterTagChange(d);
  });
  return { production };
}
