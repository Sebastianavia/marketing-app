import type { ModelMessage, UserContent } from 'ai';
import { geminiRouter } from '@/lib/ai/gemini/gemini-router';
import {
  AgentDefinition,
  audioDesignerAgent,
  cinematographerAgent,
  continuitySupervisorAgent,
  makeSupervisorAgent,
  orchestratorAgent,
  productStrategistAgent,
  promptEngineerAgent,
  referenceAnalystAgent,
  sceneReviserAgent,
  screenwriterAgent,
  sfxAgent,
  SUPERVISOR_RUBRICS,
  SupervisorOutput,
  vfxTransitionsAgent,
} from './agents';
import {
  chainReferenceIds,
  ProductStrategy,
  SCENE_MAX_SECONDS,
  SCENE_MIN_SECONDS,
  SceneRevisionRequest,
  Storyboard,
  StoryboardRequest,
  StoryboardScene,
  StudioEvent,
  StudioSettings,
  SupervisorReview,
  UgcReference,
} from '@/types/ugc-studio.types';

/**
 * Orquestador del equipo de agentes. Grafo:
 * [referencias ∥ estratega de producto] → director creativo → guionista → [fotografía ∥ audio ∥ sfx] → vfx/transiciones
 * → [supervisores ∥] → revisiones (una vez, solo si < 7) → continuidad → ingeniero de prompts.
 * Los pasos en paralelo caen en slots distintos del router de Gemini (round-robin).
 */

export type Emit = (event: StudioEvent) => void;

const APPROVAL_SCORE = 7;

async function runAgent<T>(
  agent: AgentDefinition<T>,
  content: UserContent,
  emit: Emit,
  signal?: AbortSignal,
  label?: string
): Promise<T> {
  const agentId = label ? `${agent.id}:${label}` : agent.id;
  emit({ type: 'agent_start', agentId, agentName: label ? `${agent.name} (${label})` : agent.name });
  try {
    const messages: ModelMessage[] = [{ role: 'user', content }];
    const result = await geminiRouter.generateObject({
      agentId,
      system: agent.system,
      messages,
      schema: agent.schema,
      temperature: agent.temperature,
      abortSignal: signal,
      onSlot: (s) => emit({ type: 'agent_slot', agentId, keyIndex: s.keyIndex, model: s.model }),
    });
    emit({ type: 'agent_done', agentId });
    return result;
  } catch (err: any) {
    emit({ type: 'agent_error', agentId, detail: err?.message || 'Error del agente' });
    throw err;
  }
}

/**
 * Gemini no acepta URLs externas como imagen (las trata como fileUri y responde un 503
 * engañoso), así que se descargan y se envían los bytes.
 */
async function downloadImage(url: string): Promise<{ data: Uint8Array; mediaType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`No se pudo descargar la referencia ${url} (HTTP ${res.status})`);
  const mediaType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return { data: new Uint8Array(await res.arrayBuffer()), mediaType };
}

const json = (value: unknown) => JSON.stringify(value, null, 1);

function strategyBlock(strategy: ProductStrategy | undefined): string {
  return strategy ? `\n\nESTRATEGIA DE PRODUCTO (qué es, para qué sirve y cómo se usa en cámara):\n${json(strategy)}` : '';
}

function referencesBlock(references: UgcReference[]): string {
  if (references.length === 0) return '(ninguna: no hay imágenes de referencia, así que no cites IDs como "ref1" ni pidas parecerse a una referencia)';
  return references
    .map((r) => `- ${r.id} [${r.role}] según el usuario: "${r.label}"${r.description ? `\n  Descripción: ${r.description}` : ''}`)
    .join('\n');
}

/** Ajusta nº de escenas y duraciones a los límites de heygen-video-1 y del modo prueba. */
function fitDurations<T extends { index: number; durationSeconds: number }>(scenes: T[], settings: StudioSettings): T[] {
  // Cada escena dura al menos SCENE_MIN_SECONDS: no caben más escenas que eso en el total
  const maxByDuration = Math.max(1, Math.floor(settings.maxTotalSeconds / SCENE_MIN_SECONDS));
  const fitted = [...scenes]
    .sort((a, b) => a.index - b.index)
    .slice(0, Math.min(settings.maxScenes, maxByDuration))
    .map((s) => ({
      ...s,
      durationSeconds: Math.min(SCENE_MAX_SECONDS, Math.max(SCENE_MIN_SECONDS, Math.round(s.durationSeconds || SCENE_MIN_SECONDS))),
    }));
  let total = fitted.reduce((sum, s) => sum + s.durationSeconds, 0);
  while (total > settings.maxTotalSeconds) {
    const longest = fitted.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a));
    if (longest.durationSeconds <= SCENE_MIN_SECONDS) break;
    longest.durationSeconds -= 1;
    total -= 1;
  }
  return fitted;
}

/** Palabras que caben en una escena (≈2.5 palabras/s, dejando ~1 s de aire para el empalme). */
export function maxWordsFor(durationSeconds: number): number {
  return Math.floor((durationSeconds - 1) * 2.5);
}

/** Mínimo de palabras (≈1.8 palabras/s): con menos, el personaje se queda callado y quieto parte de la escena. */
export function minWordsFor(durationSeconds: number): number {
  return Math.floor((durationSeconds - 1) * 1.8);
}

/** Instrucción de ajuste si el diálogo se sale del rango de palabras de la duración; null si cabe bien. */
function lengthFix(words: number, durationSeconds: number): string | null {
  const min = minWordsFor(durationSeconds);
  const max = maxWordsFor(durationSeconds);
  if (words > max) return `acórtalo a máximo ${max} palabras (ahora tiene ${words})`;
  if (words < min) return `alárgalo a entre ${min} y ${max} palabras (ahora tiene ${words}), sin relleno: con datos o emoción del brief`;
  return null;
}

const countWords = (dialogue: { line: string }[]) =>
  dialogue.reduce((sum, d) => sum + d.line.split(/\s+/).filter(Boolean).length, 0);

function byIndex<T extends { index: number }>(items: T[], index: number): T | undefined {
  return items.find((i) => i.index === index);
}

export async function generateStoryboard(
  req: StoryboardRequest,
  emit: Emit,
  signal?: AbortSignal
): Promise<Storyboard> {
  const { brief, settings } = req;
  let references = req.references;

  // ---------------------------------------------------------------------------
  // 1. Analista de referencias (ve las imágenes) ∥ estratega de producto (entiende producto y objetivo)
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Analizando referencias y entendiendo el producto' });
  const images = await Promise.all(references.map((r) => downloadImage(r.url)));
  const [analysis, strategy] = await Promise.all([
    runAgent(
      referenceAnalystAgent,
      [
        { type: 'text', text: `Brief del usuario:\n${brief}\n\nReferencias adjuntas:\n${referencesBlock(references)}` },
        ...references.flatMap((r, i) => [
          { type: 'text' as const, text: `Imagen ${r.id}:` },
          { type: 'file' as const, data: images[i].data, mediaType: images[i].mediaType },
        ]),
      ],
      emit,
      signal
    ),
    runAgent(
      productStrategistAgent,
      [
        { type: 'text', text: `Brief del usuario:\n${brief}\n\nReferencias adjuntas (según el usuario):\n${referencesBlock(references)}` },
        // Ve las fotos para saber el formato físico real (caja, frasco, sachet) y que el gesto sea posible
        ...references.flatMap((r, i) => [
          { type: 'text' as const, text: `Imagen ${r.id}:` },
          { type: 'file' as const, data: images[i].data, mediaType: images[i].mediaType },
        ]),
      ],
      emit,
      signal
    ),
  ]);
  references = references.map((r) => ({
    ...r,
    description: analysis.references.find((a) => a.id === r.id)?.description ?? r.description,
  }));
  emit({ type: 'references', references });
  const bible = analysis.bible;

  const baseContext = `BRIEF DEL USUARIO:\n${brief}\n\nREFERENCIAS:\n${referencesBlock(references)}\n\nBIBLIA DE CONTINUIDAD:\n${json(bible)}${strategyBlock(strategy)}`;

  // ---------------------------------------------------------------------------
  // 2. Director creativo: concepto + escenas + directivas
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Director creativo dividiendo el trabajo' });
  const plan = await runAgent(
    orchestratorAgent,
    `${baseContext}\n\nLÍMITES: máximo ${settings.maxScenes} escenas y ${settings.maxTotalSeconds} segundos en total. Formato ${settings.aspectRatio}.`,
    emit,
    signal
  );
  const planScenes = fitDurations(plan.scenes, settings).map((s, i) => ({ ...s, index: i + 1 }));
  if (planScenes.length === 0) throw new Error('El director creativo no propuso ninguna escena. Intenta con un brief más detallado.');
  const planContext = `${baseContext}\n\nPLAN DEL DIRECTOR:\n${json({ ...plan, scenes: planScenes })}`;

  // ---------------------------------------------------------------------------
  // 3. Guion primero (los demás departamentos dependen del diálogo)
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Guionista escribiendo diálogos' });
  let script = await runAgent(screenwriterAgent, `${planContext}\n\nDIRECTIVA PARA TI: ${plan.directives.guion}`, emit, signal);

  // ---------------------------------------------------------------------------
  // 4. Fotografía, audio y SFX en paralelo
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Fotografía, audio y SFX trabajando en paralelo' });
  const withScript = `${planContext}\n\nGUION:\n${json(script)}`;
  let [camera, audio, sfx] = await Promise.all([
    runAgent(cinematographerAgent, `${withScript}\n\nDIRECTIVA PARA TI: ${plan.directives.fotografia}`, emit, signal),
    runAgent(audioDesignerAgent, `${withScript}\n\nDIRECTIVA PARA TI: ${plan.directives.audio}`, emit, signal),
    runAgent(sfxAgent, `${withScript}\n\nDIRECTIVA PARA TI: ${plan.directives.sfx}`, emit, signal),
  ]);

  // ---------------------------------------------------------------------------
  // 5. VFX / transiciones (necesita saber qué pasa visualmente)
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Diseñando empalmes entre escenas' });
  const withDepartments = () =>
    `${planContext}\n\nGUION:\n${json(script)}\n\nFOTOGRAFÍA:\n${json(camera)}\n\nAUDIO:\n${json(audio)}\n\nSFX:\n${json(sfx)}`;
  let vfx = await runAgent(vfxTransitionsAgent, `${withDepartments()}\n\nDIRECTIVA PARA TI: ${plan.directives.vfx}`, emit, signal);

  // ---------------------------------------------------------------------------
  // 6. Supervisores en paralelo + una ronda de revisión para lo que no aprobó
  // ---------------------------------------------------------------------------
  emit({ type: 'phase', label: 'Supervisores revisando cada departamento' });
  const departments = {
    guion: () => json(script),
    fotografia: () => json(camera),
    audio: () => json({ audio, sfx }),
    vfx: () => json(vfx),
  } as const;
  type Dept = keyof typeof departments;

  const reviews = await Promise.all(
    (Object.keys(departments) as Dept[]).map(async (dept) => {
      const review = await runAgent(
        makeSupervisorAgent(dept, SUPERVISOR_RUBRICS[dept]),
        `${withDepartments()}\n\nVFX:\n${json(vfx)}\n\nTRABAJO A REVISAR (${dept}):\n${departments[dept]()}`,
        emit,
        signal
      );
      return [dept, review] as [Dept, SupervisorOutput];
    })
  );

  const toRevise = reviews.filter(([, r]) => r.score < APPROVAL_SCORE || !r.approved);
  if (toRevise.length > 0) {
    emit({ type: 'phase', label: `Aplicando correcciones (${toRevise.map(([d]) => d).join(', ')})` });
    const revisionPrompt = (previous: string, review: SupervisorOutput) =>
      `${withDepartments()}\n\nVFX:\n${json(vfx)}\n\nTU ENTREGA ANTERIOR:\n${previous}\n\nCORRECCIONES DEL SUPERVISOR (puntuación ${review.score}/10):\n${json(review.corrections)}\n\nEntrega la versión corregida completa.`;

    await Promise.all(
      toRevise.map(async ([dept, review]) => {
        if (dept === 'guion') script = await runAgent(screenwriterAgent, revisionPrompt(json(script), review), emit, signal, 'revisión');
        if (dept === 'fotografia') camera = await runAgent(cinematographerAgent, revisionPrompt(json(camera), review), emit, signal, 'revisión');
        if (dept === 'vfx') vfx = await runAgent(vfxTransitionsAgent, revisionPrompt(json(vfx), review), emit, signal, 'revisión');
        if (dept === 'audio') {
          [audio, sfx] = await Promise.all([
            runAgent(audioDesignerAgent, revisionPrompt(json(audio), review), emit, signal, 'revisión'),
            runAgent(sfxAgent, revisionPrompt(json(sfx), review), emit, signal, 'revisión'),
          ]);
        }
      })
    );
  }

  // Control determinista de longitud: el modelo de video corta el diálogo que no cabe en la escena,
  // y un diálogo muy corto deja segundos en silencio con el personaje quieto
  const fixes = planScenes
    .map((p) => ({ p, fix: lengthFix(countWords(byIndex(script.scenes, p.index)?.dialogue ?? []), p.durationSeconds) }))
    .filter((f): f is { p: (typeof planScenes)[number]; fix: string } => f.fix !== null);
  if (fixes.length > 0) {
    emit({ type: 'phase', label: 'Ajustando diálogos a la duración de cada escena' });
    script = await runAgent(
      screenwriterAgent,
      `${planContext}\n\nGUION ACTUAL:\n${json(script)}\n\nEstos diálogos no encajan en la duración de su escena; ajústalos sin perder el sentido:\n${fixes
        .map(({ p, fix }) => `- Escena ${p.index} (${p.durationSeconds} s): ${fix}.`)
        .join('\n')}\n\nEntrega el guion completo con esas escenas ajustadas y las demás sin cambios.`,
      emit,
      signal,
      'ajuste de longitud'
    );
  }

  const supervision: SupervisorReview[] = reviews.map(([dept, r]) => ({
    department: dept,
    score: r.score,
    notes: r.corrections.map((c) => `Escena ${c.sceneIndex}: ${c.note}`).join(' · ') || 'Aprobado sin correcciones',
    revised: toRevise.some(([d]) => d === dept),
  }));

  // ---------------------------------------------------------------------------
  // 7. Consolidar escenas
  // ---------------------------------------------------------------------------
  let scenes: StoryboardScene[] = planScenes.map((p) => {
    const cam = byIndex(camera.scenes, p.index);
    const aud = byIndex(audio.scenes, p.index);
    const tr = byIndex(vfx.scenes, p.index);
    return {
      id: `scene_${p.index}_${Date.now().toString(36)}`,
      index: p.index,
      title: p.title,
      objective: `${p.objective}\n${p.beats}`,
      durationSeconds: p.durationSeconds,
      referenceIds: p.referenceIds.filter((id) => references.some((r) => r.id === id)),
      dialogue: byIndex(script.scenes, p.index)?.dialogue ?? [],
      visual: { shot: cam?.shot ?? '', camera: cam?.camera ?? '', action: cam?.action ?? '', setting: cam?.setting ?? '' },
      referenceUsage: cam?.referenceUsage ?? [],
      audio: { voiceTone: aud?.voiceTone ?? '', ambience: aud?.ambience ?? '', music: aud?.music ?? '' },
      sfx: byIndex(sfx.scenes, p.index)?.cues ?? [],
      transition: {
        // La escena 1 siempre abre desde referencias; el resto nunca puede ser "apertura"
        type: p.index === 1 ? 'apertura' : tr?.transitionType === 'corte_con_referencias' ? 'corte_con_referencias' : 'continua',
        rationale: tr?.rationale ?? '',
        startState: tr?.startState ?? '',
        endState: tr?.endState ?? '',
        visualEffects: tr?.visualEffects ?? '',
      },
      continuityNotes: '',
      videoPrompt: '',
      status: 'draft',
    };
  });

  scenes = withChainReferences(scenes);

  // ---------------------------------------------------------------------------
  // 8. Continuidad + prompts finales
  // ---------------------------------------------------------------------------
  scenes = await finalizeScenes(scenes, references, bible, strategy, brief, emit, signal);

  return {
    id: `sb_${Date.now().toString(36)}`,
    title: plan.title,
    concept: plan.concept,
    hook: plan.hook,
    cta: plan.cta,
    tone: plan.tone,
    bible,
    brief,
    strategy,
    scenes,
    supervision,
    seed: Math.floor(Math.random() * 2_000_000_000),
    createdAt: new Date().toISOString(),
  };
}

/** La escena que abre cada cadena "continua" lleva las referencias de toda la cadena (ver chainReferenceIds). */
function withChainReferences(scenes: StoryboardScene[]): StoryboardScene[] {
  return scenes.map((s) => (s.transition.type === 'continua' ? s : { ...s, referenceIds: chainReferenceIds(scenes, s) }));
}

/**
 * La voz de heygen lee el diálogo tal cual: "Multi Ohh" sonaba "Multao" (verificado 2026-10-15).
 * Dentro del diálogo del prompt se cambia el nombre por su versión hablada; la descripción visual
 * (el texto de la caja) conserva la grafía real.
 */
function withSpokenName(videoPrompt: string, strategy: ProductStrategy | undefined): string {
  const { productName, spokenName } = strategy ?? {};
  if (!productName || !spokenName || productName.trim().toLowerCase() === spokenName.trim().toLowerCase()) return videoPrompt;
  const name = new RegExp(productName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  // Comillas rectas o tipográficas: el ingeniero de prompts no siempre usa las mismas
  return videoPrompt.replace(/(says in Spanish[^"“]*["“])([^"”]*)(["”])/gi, (_, open, line, close) => open + line.replace(name, spokenName.trim()) + close);
}

/** Supervisor de continuidad + ingeniero de prompts sobre las escenas indicadas (todas por defecto). */
async function finalizeScenes(
  scenes: StoryboardScene[],
  references: UgcReference[],
  bible: Storyboard['bible'],
  strategy: ProductStrategy | undefined,
  brief: string,
  emit: Emit,
  signal?: AbortSignal,
  onlyIndexes?: number[]
): Promise<StoryboardScene[]> {
  const target = onlyIndexes ? ` Trabaja SOLO sobre las escenas ${onlyIndexes.join(', ')}; las demás son contexto.` : '';
  const ctx = `BRIEF:\n${brief}\n\nREFERENCIAS:\n${referencesBlock(references)}\n\nBIBLIA:\n${json(bible)}${strategyBlock(strategy)}\n\nESCENAS:\n${json(
    scenes.map(({ id, status, render, videoPrompt, ...rest }) => rest)
  )}`;

  emit({ type: 'phase', label: 'Supervisor de continuidad verificando personaje y empalmes' });
  const continuity = await runAgent(continuitySupervisorAgent, `${ctx}${target}`, emit, signal);
  const withNotes = scenes.map((s) =>
    onlyIndexes && !onlyIndexes.includes(s.index)
      ? s
      : { ...s, continuityNotes: byIndex(continuity.scenes, s.index)?.continuityNotes ?? s.continuityNotes }
  );

  emit({ type: 'phase', label: 'Ingeniero de prompts compilando cada escena' });
  const prompts = await runAgent(
    promptEngineerAgent,
    `${ctx}\n\nNOTAS DE CONTINUIDAD:\n${json(continuity)}${target}`,
    emit,
    signal
  );
  return withNotes.map((s) =>
    onlyIndexes && !onlyIndexes.includes(s.index)
      ? s
      : { ...s, videoPrompt: withSpokenName(byIndex(prompts.scenes, s.index)?.videoPrompt ?? s.videoPrompt, strategy) }
  );
}

/** Reescribe una escena con el feedback del usuario, manteniendo continuidad con sus vecinas. */
export async function reviseScene(req: SceneRevisionRequest, emit: Emit, signal?: AbortSignal): Promise<Storyboard> {
  const { storyboard, references, sceneId, feedback, settings } = req;
  const scene = storyboard.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Escena no encontrada en el storyboard.');
  // Segundos disponibles para esta escena sin pasarse del total del modo prueba
  const otherSeconds = storyboard.scenes.filter((s) => s.id !== sceneId).reduce((sum, s) => sum + s.durationSeconds, 0);
  const maxSeconds = Math.max(SCENE_MIN_SECONDS, Math.min(SCENE_MAX_SECONDS, settings.maxTotalSeconds - otherSeconds));
  const fitSeconds = (v: number) => Math.min(maxSeconds, Math.max(SCENE_MIN_SECONDS, Math.round(v)));

  const neighbors = storyboard.scenes
    .filter((s) => Math.abs(s.index - scene.index) === 1)
    .map(({ index, transition, dialogue }) => ({ index, transition, dialogue }));

  emit({ type: 'phase', label: `Revisando escena ${scene.index}` });
  const revisionContext = `CONCEPTO: ${storyboard.concept}\nTONO: ${storyboard.tone}\n\nREFERENCIAS:\n${referencesBlock(references)}\n\nBIBLIA:\n${json(
    storyboard.bible
  )}${strategyBlock(storyboard.strategy)}\n\nESCENA ACTUAL (${scene.index}):\n${json(scene)}\n\nESCENAS VECINAS:\n${json(neighbors)}\n\nFEEDBACK DEL USUARIO:\n${feedback}\n\nLÍMITE: la escena puede durar como máximo ${maxSeconds} s.`;
  let revised = await runAgent(sceneReviserAgent, revisionContext, emit, signal);

  const revisedSeconds = fitSeconds(revised.durationSeconds);
  const revisionFix = lengthFix(countWords(revised.dialogue), revisedSeconds);
  if (revisionFix) {
    revised = await runAgent(
      sceneReviserAgent,
      `${revisionContext}\n\nTU PROPUESTA ANTERIOR:\n${json(revised)}\n\nEl diálogo no encaja en ${revisedSeconds} s: ${revisionFix}. Entrega la escena completa.`,
      emit,
      signal,
      'ajuste de longitud'
    );
  }

  const updated: StoryboardScene = {
    ...scene,
    title: revised.title,
    objective: revised.objective,
    durationSeconds: fitSeconds(revised.durationSeconds),
    referenceIds: revised.referenceIds.filter((id) => references.some((r) => r.id === id)),
    dialogue: revised.dialogue,
    visual: { shot: revised.shot, camera: revised.camera, action: revised.action, setting: revised.setting },
    referenceUsage: revised.referenceUsage,
    audio: { voiceTone: revised.voiceTone, ambience: revised.ambience, music: revised.music },
    sfx: revised.sfx,
    transition: { ...scene.transition, startState: revised.startState, endState: revised.endState, visualEffects: revised.visualEffects },
    status: 'draft',
    render: undefined,
  };

  const scenes = withChainReferences(storyboard.scenes.map((s) => (s.id === sceneId ? updated : s)));
  const finalized = await finalizeScenes(scenes, references, storyboard.bible, storyboard.strategy, storyboard.brief ?? storyboard.concept, emit, signal, [scene.index]);
  return { ...storyboard, scenes: finalized };
}
