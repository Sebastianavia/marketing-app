'use client';

import { create } from 'zustand';
import { formatById, LANGUAGE_INFO, VISUAL_STYLE_INFO } from '@/config/ugc-formats';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AgentAction,
  AgentActivity,
  DEFAULT_STUDIO_SETTINGS,
  estimateSceneRenderUSD,
  JointCheck,
  JointFix,
  JointIssue,
  LivePricingInfo,
  ReferenceRole,
  sanitizeSettings,
  SceneRender,
  Storyboard,
  StoryboardScene,
  StudioEvent,
  StudioSettings,
  UgcReference,
} from '@/types/ugc-studio.types';

/**
 * Tarjeta de confirmación dentro del chat: lo que gasta dinero o descarta trabajo no se ejecuta
 * hasta que el usuario lo confirma (guarda solo datos serializables para sobrevivir recargas).
 */
export interface ChatCard {
  kind: 'regenerate' | 'render' | 'delete' | 'open' | 'joint';
  title: string;
  detail: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  brief?: string; // regenerate
  settings?: Partial<StudioSettings>; // regenerate: ajustes que solo se aplican si se confirma
  sceneIds?: string[]; // render / delete / joint (una escena)
  costUSD?: number; // render
  // render: el render que tenía cada escena al crear la tarjeta. Si cambió al confirmar, esa escena ya se
  // renderizó por otro camino y no se vuelve a pagar
  sceneTasks?: Record<string, string | null>;
  projectName?: string; // open: carpeta del proyecto a abrir
  jointFix?: JointFix; // joint: lo que sugiere el revisor de empalmes
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'studio';
  content: string;
  card?: ChatCard;
}

export interface RenderEstimate {
  sceneId: string;
  estimatedCostUSD: number;
  ratePerSecondUSD: number;
  discount: number; // descuento vigente de OpenRouter (0.5 = 50%)
  livePricing: boolean; // false = precio de respaldo, OpenRouter no respondió
  usesFirstFrame: boolean;
  continuityReference: boolean; // continúa usando el último fotograma como referencia, junto al producto
  referenceCount: number;
}

type Busy = 'agent' | 'storyboard' | 'revision' | 'insert' | 'joints' | null;
type SceneTransition = 'continua' | 'corte_con_referencias';

interface UgcStudioState {
  messages: ChatMessage[];
  references: UgcReference[];
  settings: StudioSettings;
  storyboard: Storyboard | null;
  activities: AgentActivity[];
  phase: string | null;
  busy: Busy;
  uploading: boolean;
  estimate: RenderEstimate | null;
  renderQueue: string[]; // escenas en cola de "renderizar todo" (en orden)
  actionsRunning: boolean; // el agente está ejecutando sus acciones (entre pasos busy vuelve a null)
  insertDraft: { afterIndex: number; anchorId: string } | null; // "+" entre escenas: dónde se abre el formulario
  edgeMenu: { sceneId: string; kind: 'transition' | 'joint' } | null; // menú del empalme que llega a una escena
  finalVideoUrl: string | null;
  savedProjectPath: string | null;
  assembling: boolean;
  error: string | null;

  /** Mensaje al agente creativo: responde y ejecuta acciones sobre el storyboard. */
  sendMessage: (text: string) => Promise<void>;
  /** `choice` = respuesta alternativa de la tarjeta (empalme: pasar a corte en vez de reescribir). */
  confirmCard: (messageId: string, choice?: 'corte') => Promise<void>;
  cancelCard: (messageId: string) => void;
  cancel: () => void;
  addReference: (file: File, role: ReferenceRole, label: string) => Promise<boolean>;
  updateReference: (id: string, patch: Partial<Pick<UgcReference, 'role' | 'label'>>) => void;
  removeReference: (id: string) => void;
  setSettings: (patch: Partial<StudioSettings>) => void;
  approveScene: (sceneId: string) => void;
  reviseScene: (sceneId: string, feedback: string) => Promise<boolean>;
  relightScene: (sceneId: string, lighting: string) => Promise<boolean>;
  changeAngle: (sceneId: string, angle: string) => Promise<boolean>;
  insertScene: (afterIndex: number, instructions: string) => Promise<void>;
  setInsertDraft: (draft: { afterIndex: number; anchorId: string } | null) => void;
  setEdgeMenu: (menu: { sceneId: string; kind: 'transition' | 'joint' } | null) => void;
  requestDeleteScenes: (sceneIds: string[]) => void;
  moveScene: (sceneId: string, to: number) => Promise<void>;
  duplicateScene: (sceneId: string) => Promise<void>;
  setTransition: (sceneId: string, type: SceneTransition) => Promise<void>;
  /** Decide sobre un empalme que no encaja: reescribir el inicio, pasar a corte o dejarlo así. */
  resolveJoint: (sceneId: string, choice: JointFix | 'ignorar') => Promise<void>;
  renameProject: (title: string) => void;
  stopRenderQueue: () => void;
  requestRenderPending: () => Promise<void>;
  retakeScene: (sceneId: string) => Promise<void>;
  requestRenderEstimate: (sceneId: string) => Promise<void>;
  dismissEstimate: () => void;
  confirmRender: () => Promise<void>;
  assemble: (projectName?: string) => Promise<void>;
  hydrate: (
    data: { storyboard: Storyboard; references: UgcReference[]; settings: StudioSettings },
    saved?: { path: string; videoUrl?: string }
  ) => void;
  resumeRenders: () => void;
  reset: () => void;
  clearError: () => void;
}

const POLL_INTERVAL_MS = 6000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // HeyGen suele tardar 1-5 min; pasado esto se da por fallido
let abortController: AbortController | null = null;
// "Detener" debe frenar también los pasos que el agente aún no ejecutó, no solo la llamada en curso
let stopActions = false;

const serverStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const uid = () => Math.random().toString(36).slice(2, 10);
const usd = (n: number) => `$${n.toFixed(2)}`;
const byIndex = (scenes: StoryboardScene[]) => [...scenes].sort((a, b) => a.index - b.index);
const describeSettings = (st: Partial<StudioSettings>) => {
  const parts = [
    st.resolution && st.resolution,
    st.aspectRatio && st.aspectRatio,
    st.maxScenes && `máx. ${st.maxScenes} escenas`,
    st.maxTotalSeconds && `máx. ${st.maxTotalSeconds} s`,
    st.language && `diálogo en ${LANGUAGE_INFO[st.language].label.toLowerCase()}`,
    st.visualStyle && `estilo ${VISUAL_STYLE_INFO[st.visualStyle].label.toLowerCase()}`,
    st.format && `formato ${st.format === 'auto' ? 'automático' : (formatById(st.format)?.label ?? st.format)}`,
  ].filter(Boolean);
  return parts.length > 0 ? ` Ajustes: ${parts.join(', ')}.` : '';
};

/** Instrucciones para cambios locales: el revisor debe tocar solo lo pedido. */
const RELIGHT_FEEDBACK = (lighting: string) =>
  `Cambia SOLO la iluminación de la escena a: ${lighting}. Mantén igual el diálogo, la acción, el encuadre, el personaje, el vestuario, el producto y la duración.`;
const ANGLE_FEEDBACK = (angle: string) =>
  `Cambia SOLO el ángulo o plano de cámara a: ${angle}. Mantén igual el diálogo, la acción, la iluminación, el personaje, el vestuario, el producto y la duración.`;
const CUT_FEEDBACK =
  'Ahora esta escena es un PLANO NUEVO (corte): no continúa el último fotograma de la anterior. Ajusta su inicio, encuadre y prompt para un plano nuevo con el mismo personaje y producto.';
const CONTINUE_FEEDBACK =
  'Ahora esta escena CONTINÚA desde el último fotograma de la anterior (mismo lugar y encuadre de partida). Ajusta su inicio y su prompt para que empalme sin corte.';
const JOINT_FEEDBACK = (problem: string, opening: boolean) =>
  `Ajusta SOLO el empalme con la escena anterior. Problema detectado: ${problem} Reescribe el inicio (startState), la primera acción y lo necesario del prompt para que ${
    opening ? 'abra el video por sí sola, sin continuar de ningún plano previo' : 'arranque exactamente donde termina la escena anterior'
  }. Mantén el objetivo, la duración y el final de la escena. Si el problema es de la historia (lo que dice no tiene sentido en esta posición), ajusta también el diálogo lo mínimo necesario.`;

const DUPLICATE_FEEDBACK =
  'Esta escena es una COPIA de la escena anterior y ahora va justo después de ella. Ajusta SOLO su inicio (startState, la primera acción y el arranque del prompt) para que empiece donde termina la anterior. Conserva el diálogo y el resto de la acción: el usuario dirá qué variación quiere.';

/**
 * Escenas cuya escena anterior cambió (o que son nuevas): sus empalmes hay que revisarlos.
 * `exclude`: escenas que los agentes acaban de crear ya mirando a sus vecinas.
 */
function changedJointIds(before: StoryboardScene[], after: StoryboardScene[], exclude: string[] = []): string[] {
  const sortedBefore = byIndex(before);
  const prevBefore = new Map(sortedBefore.map((s, i) => [s.id, sortedBefore[i - 1]?.id ?? null]));
  const sortedAfter = byIndex(after);
  return sortedAfter
    .filter((s, i) => !exclude.includes(s.id) && (!prevBefore.has(s.id) || prevBefore.get(s.id) !== (sortedAfter[i - 1]?.id ?? null)))
    .map((s) => s.id);
}

/** Lee un stream NDJSON de StudioEvent y llama onEvent por cada línea. */
async function readEventStream(res: Response, onEvent: (e: StudioEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

/**
 * Marca como desactualizadas las escenas "continua" que siguen a una escena que cambió,
 * porque su primer fotograma salió del último fotograma anterior.
 */
function markDownstreamStale(scenes: StoryboardScene[], changedIndex: number): StoryboardScene[] {
  let chainBroken = false;
  return byIndex(scenes).map((s) => {
    if (s.index <= changedIndex || chainBroken) return s;
    if (s.transition.type !== 'continua') {
      chainBroken = true;
      return s;
    }
    return s.render?.videoUrl ? { ...s, render: { ...s.render, stale: true } } : s;
  });
}

/**
 * Tras mover, duplicar o eliminar escenas: renumera, deja la primera como apertura (una apertura que
 * ya no va primero pasa a continuar) y marca desactualizadas las escenas renderizadas que ahora
 * arrancan desde otro fotograma, junto con las continuas que dependen de ellas.
 */
function restitch(before: StoryboardScene[], ordered: StoryboardScene[]): StoryboardScene[] {
  const sortedBefore = byIndex(before);
  const prevOf = new Map(sortedBefore.map((s, i) => [s.id, sortedBefore[i - 1]?.id]));
  let firstChanged = Infinity;
  const scenes = ordered.map((s, i) => {
    const type = i === 0 ? 'apertura' : s.transition.type === 'apertura' ? 'continua' : s.transition.type;
    const next: StoryboardScene = { ...s, index: i + 1, transition: { ...s.transition, type } };
    const typeChanged = type !== s.transition.type;
    const newPrevious = prevOf.get(s.id) !== ordered[i - 1]?.id;
    if (typeChanged || (type === 'continua' && newPrevious)) {
      firstChanged = Math.min(firstChanged, i + 1);
      return next.render?.videoUrl ? { ...next, render: { ...next.render, stale: true } } : next;
    }
    return next;
  });
  return firstChanged === Infinity ? scenes : markDownstreamStale(scenes, firstChanged);
}

let pricingCache: { at: number; pricing: LivePricingInfo } | null = null;
async function fetchPricing(): Promise<LivePricingInfo> {
  if (pricingCache && Date.now() - pricingCache.at < 60_000) return pricingCache.pricing;
  const res = await fetch('/api/ugc-studio/pricing');
  if (!res.ok) throw new Error('No se pudieron leer los precios de OpenRouter.');
  const pricing = (await res.json()) as LivePricingInfo;
  pricingCache = { at: Date.now(), pricing };
  return pricing;
}

export const useUgcStudioStore = create<UgcStudioState>()(
  persist(
    (set, get) => {
      const patchScene = (sceneId: string, patch: Partial<StoryboardScene> | ((s: StoryboardScene) => Partial<StoryboardScene>)) =>
        set((state) => {
          if (!state.storyboard) return {};
          return {
            storyboard: {
              ...state.storyboard,
              scenes: state.storyboard.scenes.map((s) =>
                s.id === sceneId ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s
              ),
            },
          };
        });

      const addMessage = (message: Omit<ChatMessage, 'id'>): string => {
        const id = uid();
        set((st) => ({ messages: [...st.messages, { ...message, id }] }));
        return id;
      };
      const say = (content: string) => addMessage({ role: 'studio', content });

      const handleEvent = (event: StudioEvent) => {
        switch (event.type) {
          case 'phase':
            set({ phase: event.label });
            break;
          case 'agent_start':
            set((st) => ({
              activities: [
                ...st.activities.filter((a) => a.agentId !== event.agentId),
                { agentId: event.agentId, agentName: event.agentName, status: 'running' },
              ],
            }));
            break;
          case 'agent_slot':
            set((st) => ({
              activities: st.activities.map((a) =>
                a.agentId === event.agentId ? { ...a, keyIndex: event.keyIndex, model: event.model } : a
              ),
            }));
            break;
          case 'agent_done':
            set((st) => ({ activities: st.activities.map((a) => (a.agentId === event.agentId ? { ...a, status: 'done' } : a)) }));
            break;
          case 'agent_error':
            set((st) => ({
              activities: st.activities.map((a) =>
                a.agentId === event.agentId ? { ...a, status: 'error', detail: event.detail } : a
              ),
            }));
            break;
          case 'references':
            set({ references: event.references });
            break;
          case 'storyboard':
            set({ storyboard: event.storyboard });
            break;
          case 'error':
            set({ error: event.message });
            break;
        }
      };

      /**
       * Une la respuesta de una edición (revisión o inserción) con el estado actual: la edición tarda
       * y mientras tanto otras escenas pudieron terminar de renderizar. De la respuesta se toman las
       * escenas editadas/nuevas y la posición, transición y referencias de las demás; su render y
       * estado se conservan para no perder clips ya pagados.
       */
      const mergeEdited = (incoming: Storyboard, editedIds: string[]) =>
        set((st) => {
          if (!st.storyboard || st.storyboard.id !== incoming.id) return {};
          const current = st.storyboard.scenes;
          return {
            storyboard: {
              ...incoming,
              scenes: incoming.scenes.map((s) => {
                const local = current.find((l) => l.id === s.id);
                if (!local || editedIds.includes(s.id)) return s;
                return { ...local, index: s.index, transition: s.transition, referenceIds: s.referenceIds };
              }),
            },
          };
        });

      /** Ejecuta una edición en el servidor (revisión o inserción) mostrando el trabajo de los agentes. */
      const runEdit = async (busy: Busy, url: string, body: unknown, onStoryboard: (sb: Storyboard) => void): Promise<boolean> => {
        set({ busy, activities: [], error: null });
        abortController = new AbortController();
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          });
          let ok = false;
          await readEventStream(res, (event) => {
            if (event.type === 'storyboard') {
              onStoryboard(event.storyboard);
              ok = true;
            } else handleEvent(event);
          });
          return ok && !get().error;
        } catch (err: any) {
          if (err.name !== 'AbortError') set({ error: err.message });
          return false;
        } finally {
          set({ busy: null, phase: null });
          abortController = null;
        }
      };

      /** Genera un storyboard nuevo con el equipo de agentes a partir de un brief completo. */
      const runStoryboard = async (brief: string) => {
        const hadRenders = get().storyboard?.scenes.some((sc) => sc.render?.videoUrl) ?? false;
        set({ busy: 'storyboard', activities: [], phase: 'Preparando equipo de agentes', error: null, finalVideoUrl: null });
        abortController = new AbortController();
        try {
          const res = await fetch('/api/ugc-studio/storyboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brief, references: get().references, settings: get().settings }),
            signal: abortController.signal,
          });
          await readEventStream(res, handleEvent);
          const sb = get().storyboard;
          if (sb && !get().error) {
            set({ savedProjectPath: null });
            say(
              `Storyboard listo: "${sb.title}", ${sb.scenes.length} escena(s) y ${sb.scenes.reduce((a, s) => a + s.durationSeconds, 0)} s.${
                hadRenders ? ' Los clips del storyboard anterior ya no forman parte de este.' : ''
              } Pídeme cambios o dime "renderiza todo" cuando te guste.`
            );
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') set({ error: err.message });
        } finally {
          set({ busy: null, phase: null });
          abortController = null;
        }
      };

      /** Sigue un render hasta que termina. Devuelve si quedó completo. */
      const pollRender = async (sceneId: string, taskId: string): Promise<boolean> => {
        const startedAt = Date.now();
        while (true) {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            patchScene(sceneId, (s) => ({
              status: 'failed',
              render: { ...s.render, error: 'El render tardó más de 20 minutos. Revisa tu panel de OpenRouter antes de reintentar: un nuevo render se cobra de nuevo.' },
            }));
            return false;
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const scene = get().storyboard?.scenes.find((s) => s.id === sceneId);
          if (!scene || scene.render?.taskId !== taskId) return false; // escena cambiada o re-lanzada
          try {
            const res = await fetch(`/api/ugc-studio/scene/status/${taskId}`);
            const data = await res.json();
            if (data.status === 'completed') {
              patchScene(sceneId, (s) => ({
                status: 'rendered',
                render: {
                  ...s.render,
                  videoUrl: data.videoUrl,
                  lastFrameUrl: data.lastFrameUrl,
                  costUSD: data.costUSD ?? s.render?.costUSD,
                  stale: false,
                  error: undefined,
                },
              }));
              // Posición actual de la escena (la de cuando empezó el render pudo cambiar)
              set((st) => {
                const index = st.storyboard?.scenes.find((s) => s.id === sceneId)?.index;
                return st.storyboard && index ? { storyboard: { ...st.storyboard, scenes: markDownstreamStale(st.storyboard.scenes, index) } } : {};
              });
              return true;
            }
            if (data.status === 'failed') {
              patchScene(sceneId, (s) => ({ status: 'failed', render: { ...s.render, error: data.error || 'El render falló.' } }));
              return false;
            }
          } catch {
            // error de red transitorio: seguir consultando
          }
        }
      };

      /**
       * Lanza el render de una escena ya confirmada y espera a que termine (si `wait`).
       * Si el envío falla, el clip anterior (ya pagado) no se pierde.
       */
      const dispatchRender = async (sceneId: string, wait: boolean): Promise<boolean> => {
        const { storyboard, references, settings } = get();
        const previous = storyboard?.scenes.find((s) => s.id === sceneId);
        if (!storyboard || !previous) return false;
        patchScene(sceneId, { status: 'rendering', render: undefined });
        try {
          const res = await fetch('/api/ugc-studio/scene/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storyboard: { ...storyboard, scenes: storyboard.scenes.map((s) => (s.id === sceneId ? { ...s, status: 'approved' } : s)) },
              references,
              settings,
              sceneId,
              confirm: true,
            }),
          });
          const data = await res.json();
          let taskId: string;
          if (res.status === 409 && data.taskId) {
            // Ya había un render en curso para esta escena: retomar su seguimiento en vez de pagar otro
            taskId = data.taskId;
            patchScene(sceneId, { render: { taskId, resolution: settings.resolution, aspectRatio: settings.aspectRatio } });
          } else {
            if (!res.ok) throw new Error(data.error);
            taskId = data.taskId;
            const render: SceneRender = {
              taskId,
              costUSD: data.estimatedCostUSD,
              usedFirstFrame: data.usedFirstFrame,
              usedReferences: data.usedReferences,
              resolution: settings.resolution,
              aspectRatio: settings.aspectRatio,
            };
            patchScene(sceneId, { render });
          }
          const done = pollRender(sceneId, taskId);
          return wait ? await done : true;
        } catch (err: any) {
          if (previous.render?.videoUrl) {
            patchScene(sceneId, { status: previous.status, render: previous.render });
            set({ error: `No se pudo renderizar la escena ${previous.index}: ${err.message}` });
          } else {
            patchScene(sceneId, { status: 'failed', render: { error: err.message } });
          }
          return false;
        }
      };

      /** Renderiza varias escenas en orden: cada escena continua necesita el último fotograma de la anterior. */
      const runRenderQueue = async (sceneIds: string[]) => {
        const order = byIndex(get().storyboard?.scenes ?? [])
          .filter((s) => sceneIds.includes(s.id))
          .map((s) => s.id);
        set({ renderQueue: order });
        try {
          for (const id of order) {
            if (!get().renderQueue.includes(id)) return; // cola cancelada
            const scene = get().storyboard?.scenes.find((s) => s.id === id);
            if (!scene) continue;
            const ok = await dispatchRender(id, true);
            set((st) => ({ renderQueue: st.renderQueue.filter((q) => q !== id) }));
            if (!ok) {
              say(`El render de la escena ${scene.index} falló, así que detuve la cola: las siguientes dependen de ella.`);
              return;
            }
          }
          if (order.length > 1) say('Listo: todas las escenas de la cola están renderizadas. Cuando quieras, pídeme "une el video".');
        } finally {
          set({ renderQueue: [] });
        }
      };

      /** Arma la tarjeta de confirmación de un render (con el costo estimado actual). */
      const proposeRender = async (sceneIds: string[], reason?: string) => {
        const { storyboard, references, settings } = get();
        if (!storyboard || sceneIds.length === 0) return;
        const scenes = byIndex(storyboard.scenes).filter((s) => sceneIds.includes(s.id));
        let cost: number | undefined;
        try {
          const pricing = await fetchPricing();
          cost = scenes.reduce((sum, s) => sum + estimateSceneRenderUSD(storyboard.scenes, s, references, pricing, settings.resolution), 0);
        } catch {
          cost = undefined;
        }
        const seconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
        addMessage({
          role: 'studio',
          content: reason ?? '',
          card: {
            kind: 'render',
            title: `Renderizar ${scenes.length === 1 ? `la escena ${scenes[0].index}` : `${scenes.length} escenas (${scenes.map((s) => s.index).join(', ')})`}`,
            detail: `${seconds} s a ${settings.resolution}${cost !== undefined ? `, unos ${usd(cost)} con las tarifas actuales de OpenRouter` : ''}. Se renderizan en orden.`,
            status: 'pending',
            sceneIds: scenes.map((s) => s.id),
            costUSD: cost,
            sceneTasks: Object.fromEntries(scenes.map((s) => [s.id, s.render?.taskId ?? null])),
          },
        });
      };

      /** Elimina escenas (ya confirmado): reindexa y marca como desactualizado lo que dependía de ellas. */
      const deleteScenes = (sceneIds: string[]) =>
        set((st) => {
          if (!st.storyboard || !st.storyboard.scenes.some((s) => sceneIds.includes(s.id))) return {};
          const remaining = byIndex(st.storyboard.scenes.filter((s) => !sceneIds.includes(s.id)));
          return { storyboard: { ...st.storyboard, scenes: restitch(st.storyboard.scenes, remaining) } };
        });

      /** Mueve una escena a la posición `to` (1-based). */
      const moveSceneLocal = (sceneId: string, to: number) =>
        set((st) => {
          if (!st.storyboard) return {};
          const ordered = byIndex(st.storyboard.scenes);
          const from = ordered.findIndex((s) => s.id === sceneId);
          if (from < 0) return {};
          const [scene] = ordered.splice(from, 1);
          ordered.splice(Math.max(0, Math.min(ordered.length, to - 1)), 0, scene);
          return { storyboard: { ...st.storyboard, scenes: restitch(st.storyboard.scenes, ordered) } };
        });

      /** Duplica una escena justo después de sí misma (la copia queda en borrador, sin render). */
      const duplicateSceneLocal = (sceneId: string) =>
        set((st) => {
          if (!st.storyboard) return {};
          const ordered = byIndex(st.storyboard.scenes);
          const at = ordered.findIndex((s) => s.id === sceneId);
          if (at < 0) return {};
          const original = ordered[at];
          const copy: StoryboardScene = {
            ...original,
            id: `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            title: `${original.title} (copia)`,
            // La copia sigue a la original: continúa desde su último fotograma
            transition: { ...original.transition, type: 'continua' },
            status: 'draft',
            render: undefined,
            seed: undefined,
          };
          ordered.splice(at + 1, 0, copy);
          return { storyboard: { ...st.storyboard, scenes: restitch(st.storyboard.scenes, ordered) } };
        });

      /** Abre un proyecto guardado por el nombre de su carpeta (o su título). */
      const openProjectByName = async (name: string): Promise<boolean> => {
        try {
          const res = await fetch('/api/projects');
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'No se pudo leer el historial.');
          const wanted = name.trim().toLowerCase();
          const ugc = (data.projects as any[]).filter((p) => p.category === 'UGC' && p.ugcStudio?.storyboard);
          const project =
            ugc.find((p) => p.name.toLowerCase() === wanted) ??
            ugc.find((p) => (p.ugcStudio.storyboard as Storyboard).title.toLowerCase() === wanted) ??
            ugc.find((p) => p.name.toLowerCase().includes(wanted));
          if (!project) {
            say(`No encontré un proyecto llamado "${name}". Puedes verlos todos en Historial (arriba a la izquierda).`);
            return false;
          }
          get().hydrate(
            { storyboard: project.ugcStudio.storyboard, references: project.ugcStudio.references, settings: project.ugcStudio.settings },
            { path: project.path, videoUrl: project.videoUrl }
          );
          return true;
        } catch (err: any) {
          set({ error: err.message });
          return false;
        }
      };

      /**
       * Con una cola de render en marcha no se insertan, eliminan ni revisan escenas: cada escena de la
       * cola arranca del último fotograma de la anterior y cambiar el orden desencadenaría el video.
       */
      const blockedByQueue = (): boolean => {
        if (get().renderQueue.length === 0) return false;
        set({ error: 'Hay escenas renderizándose en cola. Espera a que terminen (o detén la cola) antes de editar escenas.' });
        return true;
      };

      /**
       * Bloquea el chat y los botones mientras corre una secuencia de pasos (edición + revisión de
       * empalmes). Dentro de un plan del agente el bloqueo ya está puesto.
       */
      const withLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
        if (get().actionsRunning) return fn();
        stopActions = false;
        set({ actionsRunning: true });
        try {
          return await fn();
        } finally {
          set({ actionsRunning: false });
        }
      };

      /** Pide al revisor de empalmes su diagnóstico. Si falla no bloquea nada: solo avisa. */
      const fetchJointChecks = async (sceneIds: string[]): Promise<JointCheck[] | null> => {
        const { storyboard, references } = get();
        if (!storyboard) return null;
        set({ busy: 'joints', activities: [], error: null, phase: 'Revisando los empalmes entre escenas' });
        abortController = new AbortController();
        let joints: JointCheck[] | null = null;
        let failure: string | null = null;
        try {
          const res = await fetch('/api/ugc-studio/scene/joints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyboard, references, sceneIds }),
            signal: abortController.signal,
          });
          await readEventStream(res, (event) => {
            if (event.type === 'joints') joints = event.joints;
            else if (event.type === 'error') failure = event.message;
            else handleEvent(event);
          });
        } catch (err: any) {
          if (err.name !== 'AbortError') failure = err.message;
        } finally {
          set({ busy: null, phase: null });
          abortController = null;
        }
        if (failure) {
          const numbers = byIndex(get().storyboard?.scenes ?? []).filter((s) => sceneIds.includes(s.id)).map((s) => s.index);
          say(`No pude revisar los empalmes (${failure}). Revisa a mano el inicio de la escena ${numbers.join(', ')}.`);
        }
        return joints;
      };

      /** Cambia cómo arranca una escena y deja que los agentes reescriban su inicio y su prompt. */
      const applyTransition = async (sceneId: string, type: SceneTransition): Promise<boolean> => {
        const scene = get().storyboard?.scenes.find((s) => s.id === sceneId);
        if (!scene) return false;
        if (scene.index === 1) {
          say('La escena 1 siempre abre el video desde las referencias.');
          return false;
        }
        if (scene.transition.type === type) return true;
        const previousType = scene.transition.type;
        patchScene(sceneId, { transition: { ...scene.transition, type } });
        const ok = await get().reviseScene(sceneId, type === 'corte_con_referencias' ? CUT_FEEDBACK : CONTINUE_FEEDBACK);
        // Sin la reescritura, el prompt seguiría describiendo el inicio anterior
        if (!ok) patchScene(sceneId, (s) => ({ transition: { ...s.transition, type: previousType } }));
        return ok;
      };

      /** Corrige un empalme: reescribir el inicio de la escena o pasarla a plano nuevo. */
      const fixJoint = async (sceneId: string, fix: JointFix, problem: string): Promise<boolean> => {
        const scene = get().storyboard?.scenes.find((s) => s.id === sceneId);
        if (!scene) return false;
        if (fix === 'corte' && scene.index > 1) return applyTransition(sceneId, 'corte_con_referencias');
        return get().reviseScene(sceneId, JOINT_FEEDBACK(problem, scene.index === 1));
      };

      /** Tarjeta en el chat para un empalme que no encaja en una escena aprobada o renderizada. */
      const proposeJointFix = async (sceneId: string, issue: JointIssue) => {
        const { storyboard, references, settings, messages } = get();
        const scene = storyboard?.scenes.find((s) => s.id === sceneId);
        if (!storyboard || !scene) return;
        // Una sola tarjeta pendiente por escena
        if (messages.some((m) => m.card?.kind === 'joint' && m.card.status === 'pending' && m.card.sceneIds?.includes(sceneId))) return;
        let rerender = '';
        if (scene.render?.videoUrl) {
          try {
            const cost = estimateSceneRenderUSD(storyboard.scenes, scene, references, await fetchPricing(), settings.resolution);
            rerender = ` Corregirlo descarta su clip: habrá que renderizarla de nuevo (unos ${usd(cost)}).`;
          } catch {
            rerender = ' Corregirlo descarta su clip: habrá que renderizarla de nuevo.';
          }
        }
        addMessage({
          role: 'studio',
          content: '',
          card: {
            kind: 'joint',
            title: `El empalme de la escena ${scene.index} no encaja`,
            detail: `${issue.problem}${rerender} Sugerencia: ${
              issue.suggestion === 'corte' && scene.index > 1 ? 'pasarla a plano nuevo (corte)' : 'reescribir su inicio'
            }.`,
            status: 'pending',
            sceneIds: [sceneId],
            jointFix: issue.suggestion,
          },
        });
      };

      /**
       * Revisa los empalmes que cambiaron. Los borradores se corrigen solos (reescribir texto es
       * gratis); en escenas aprobadas o renderizadas se pregunta, porque luego hay que renderizar.
       */
      const reconcileJoints = async (sceneIds: string[]) => {
        const ids = sceneIds.filter((id) => get().storyboard?.scenes.some((s) => s.id === id));
        if (ids.length === 0 || stopActions) return;
        const checks = await fetchJointChecks(ids);
        if (!checks) return;
        for (const check of checks) {
          if (stopActions) return;
          const scene = get().storyboard?.scenes.find((s) => s.id === check.sceneId);
          if (!scene) continue;
          if (check.coherent) {
            if (scene.jointIssue) patchScene(scene.id, { jointIssue: undefined });
            continue;
          }
          const issue: JointIssue = {
            problem: check.problem || 'Su inicio no coincide con el final de la escena anterior.',
            suggestion: check.suggestion,
          };
          if (scene.status === 'draft' && !scene.render?.videoUrl) {
            // Siempre reescribir: pasar a corte sube la tarifa (usa referencias), eso lo decide el usuario
            const ok = await fixJoint(scene.id, 'reescribir', issue.problem);
            if (ok) {
              say(
                `Ajusté el inicio de la escena ${scene.index} para que empalme: ${issue.problem}${
                  issue.suggestion === 'corte' && scene.index > 1 ? ' Si prefieres un plano nuevo, pídeme "pasa la escena a corte".' : ''
                }`
              );
            } else {
              patchScene(scene.id, { jointIssue: issue });
            }
          } else {
            patchScene(scene.id, { jointIssue: issue });
            await proposeJointFix(scene.id, issue);
          }
        }
      };

      /** Mueve una escena y revisa los empalmes que cambiaron. */
      const moveAndCheck = async (sceneId: string, to: number): Promise<boolean> => {
        const before = get().storyboard?.scenes ?? [];
        moveSceneLocal(sceneId, to);
        const after = get().storyboard?.scenes ?? [];
        const changed = changedJointIds(before, after);
        if (changed.length === 0) return false;
        await reconcileJoints(changed);
        return true;
      };

      /** Duplica una escena (si cabe en los límites) y adapta la copia para que empalme. */
      const duplicateAndCheck = async (sceneId: string): Promise<boolean> => {
        const { storyboard, settings } = get();
        const original = storyboard?.scenes.find((s) => s.id === sceneId);
        if (!storyboard || !original) return false;
        const seconds = storyboard.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
        if (storyboard.scenes.length >= settings.maxScenes) {
          say(`Ya hay ${storyboard.scenes.length} escenas y el máximo es ${settings.maxScenes}: sube "Máx. escenas" para duplicar.`);
          return false;
        }
        if (seconds + original.durationSeconds > settings.maxTotalSeconds) {
          say(`Duplicarla dejaría el video en ${seconds + original.durationSeconds} s y el máximo es ${settings.maxTotalSeconds} s: sube "Máx. segundos".`);
          return false;
        }
        const before = new Set(storyboard.scenes.map((s) => s.id));
        duplicateSceneLocal(sceneId);
        const copy = get().storyboard?.scenes.find((s) => !before.has(s.id));
        if (!copy) return false;
        // La copia arranca donde termina la original: se ajusta su inicio. Que repita el guion es a
        // propósito (el usuario la duplicó para variarla), así que no se pasa por el revisor de empalmes.
        // La escena que sigue a la copia no cambia de fotograma de partida: la copia termina igual que la original.
        const ok = await get().reviseScene(copy.id, DUPLICATE_FEEDBACK);
        say(
          ok
            ? `Dupliqué la escena ${original.index}: la copia es la ${copy.index}, en borrador, y ajusté su inicio para que arranque donde termina la original. Repite su diálogo: dime qué debe cambiar (o usa "Pedir cambios" en la tarjeta).`
            : `Dupliqué la escena ${original.index} (la copia es la ${copy.index}), pero no pude ajustar su inicio. Pídeme cambios sobre ella antes de renderizarla.`
        );
        return true;
      };

      /**
       * Mover, duplicar, insertar, borrar o cambiar un empalme cambia de qué fotograma parte cada escena:
       * no se hace mientras haya cualquier escena renderizándose (su clip partiría del orden anterior).
       */
      const blockedByRendering = (): boolean => {
        if (blockedByQueue()) return true;
        const rendering = (get().storyboard?.scenes ?? []).filter((s) => s.status === 'rendering');
        if (rendering.length === 0) return false;
        set({ error: `La escena ${rendering.map((s) => s.index).join(', ')} se está renderizando: espera a que termine antes de reordenar, insertar o cambiar empalmes.` });
        return true;
      };

      /** Convierte los números de escena del agente en IDs con el storyboard del momento del plan. */
      const resolveIds = (numbers: number[], fallback: 'all' | 'pending' | 'none'): string[] => {
        const scenes = byIndex(get().storyboard?.scenes ?? []);
        if (numbers.length > 0) return scenes.filter((s) => numbers.includes(s.index)).map((s) => s.id);
        if (fallback === 'all') return scenes.map((s) => s.id);
        // Las que ya se están renderizando no: volver a pedirlas pagaría dos veces
        if (fallback === 'pending')
          return scenes.filter((s) => s.status !== 'rendering' && (!s.render?.videoUrl || s.render.stale || s.status === 'failed')).map((s) => s.id);
        return [];
      };

      /** Ejecuta en orden las acciones que decidió el agente. */
      const executeActions = async (actions: AgentAction[]) => {
        // Si hay que confirmar un storyboard nuevo, los ajustes que lo preparan viajan en la tarjeta:
        // cancelarlo no debe dejar la duración o el formato cambiados
        const regenerateAt = get().storyboard ? actions.findIndex((a) => a.type === 'generate_storyboard') : -1;
        const deferredSettings: Partial<StudioSettings> = {};
        if (regenerateAt >= 0) {
          actions.slice(0, regenerateAt).forEach((a) => a.type === 'update_settings' && Object.assign(deferredSettings, a.settings));
          actions = actions.filter((a, i) => !(i < regenerateAt && a.type === 'update_settings'));
        }

        // Los números de escena se resuelven ANTES de editar: insertar o borrar cambia la numeración.
        // Si aún no había storyboard (lo crea este mismo plan), se resuelven al ejecutar cada paso.
        const fallbackFor = (a: AgentAction) => (a.type === 'render_scenes' ? 'pending' : a.type === 'approve_scenes' ? 'all' : 'none');
        const hadStoryboard = Boolean(get().storyboard);
        const planned = actions.map((a) => ({
          action: a,
          ids: hadStoryboard ? resolveIds(a.scenes, fallbackFor(a)) : null,
          // insert_scene: [0] = al inicio, [n] = tras la escena n, [] = al final
          afterId: a.type === 'insert_scene' && hadStoryboard ? resolveIds(a.scenes.filter((n) => n > 0), 'none')[0] : undefined,
          // move_scene: [origen, destino]; resolveIds ordena por posición, así que el origen va aparte
          fromId: a.type === 'move_scene' && hadStoryboard ? resolveIds(a.scenes.slice(0, 1), 'none')[0] : undefined,
        }));
        const TARGETED = ['revise_scene', 'relight_scene', 'change_angle', 'delete_scene', 'retake_scene', 'move_scene', 'duplicate_scene', 'set_transition'];
        const STRUCTURAL = ['move_scene', 'duplicate_scene', 'set_transition'];

        for (const step of planned) {
          const { action, afterId } = step;
          if (get().error) return; // un paso falló: no seguir a ciegas
          if (stopActions) {
            say('Detuve los cambios que faltaban.');
            return;
          }
          const ids = step.ids ?? resolveIds(action.scenes, fallbackFor(action));
          if (TARGETED.includes(action.type) && ids.length === 0) {
            say('No supe a qué escena te refieres. Dime su número (aparece en la esquina de cada tarjeta).');
            continue;
          }
          if (STRUCTURAL.includes(action.type) && blockedByRendering()) return;
          switch (action.type) {
            case 'move_scene': {
              const [from, to] = action.scenes;
              const id = step.fromId ?? resolveIds([from], 'none')[0];
              if (!id || !to || from === to) {
                say('Dime qué escena mover y a qué posición, por ejemplo "pasa la 3 antes de la 2".');
                break;
              }
              say(`Muevo la escena ${from} a la posición ${to} y reviso cómo quedan los empalmes.`);
              await moveAndCheck(id, to);
              break;
            }
            case 'duplicate_scene':
              for (const id of ids) {
                if (!(await duplicateAndCheck(id))) break;
              }
              break;
            case 'set_transition': {
              // "continua" o "corte"; ojo con frases como "que no sea corte, que continúe"
              const text = action.instructions.toLowerCase();
              const corte = /^\s*corte/.test(text) || (!/continu/.test(text) && /corte|nuevo|otro|referencia/.test(text));
              for (const id of ids) await applyTransition(id, corte ? 'corte_con_referencias' : 'continua');
              break;
            }
            case 'rename_project':
              get().renameProject(action.instructions);
              break;
            case 'open_project': {
              const name = action.instructions.trim();
              if (!name) break;
              const scenes = get().storyboard?.scenes ?? [];
              const atRisk = scenes.some((s) => s.status === 'rendering') || (!get().savedProjectPath && scenes.some((s) => s.render?.videoUrl));
              if (atRisk) {
                addMessage({
                  role: 'studio',
                  content: '',
                  card: {
                    kind: 'open',
                    title: `Abrir "${name}"`,
                    detail: 'El proyecto actual tiene escenas renderizándose o clips sin guardar: se dejarán de seguir o se perderán.',
                    status: 'pending',
                    projectName: name,
                  },
                });
                return;
              }
              await openProjectByName(name);
              return; // el resto del plan era sobre el proyecto anterior
            }
            case 'stop_render':
              get().stopRenderQueue();
              break;
            case 'update_settings': {
              const wanted = action.settings ?? {};
              if (Object.keys(wanted).length === 0) break;
              get().setSettings(wanted);
              // Avisar si se pidió más de lo permitido (la app lo ajusta al máximo)
              const applied = get().settings;
              const clamped = (['maxScenes', 'maxTotalSeconds'] as const).filter((k) => wanted[k] !== undefined && wanted[k] !== applied[k]);
              if (clamped.length > 0) {
                say(`Ajusté al máximo permitido: ${applied.maxScenes} escenas y ${applied.maxTotalSeconds} s.`);
              }
              break;
            }
            case 'generate_storyboard': {
              const brief = action.instructions;
              if (!brief) break;
              if (get().storyboard) {
                const rendered = get().storyboard!.scenes.filter((s) => s.render?.videoUrl).length;
                addMessage({
                  role: 'studio',
                  content: '',
                  card: {
                    kind: 'regenerate',
                    title: 'Crear un storyboard nuevo',
                    detail: `Reemplaza el storyboard actual${
                      rendered > 0 ? ` y deja fuera ${rendered} clip(s) ya renderizado(s) (siguen en el historial si el proyecto está guardado)` : ''
                    }.${describeSettings(deferredSettings)}`,
                    status: 'pending',
                    brief,
                    settings: Object.keys(deferredSettings).length > 0 ? deferredSettings : undefined,
                  },
                });
                return; // lo demás depende del storyboard nuevo
              }
              await runStoryboard(brief);
              break;
            }
            case 'revise_scene':
              for (const id of ids) await get().reviseScene(id, action.instructions);
              break;
            case 'relight_scene':
              for (const id of ids) await get().relightScene(id, action.instructions);
              break;
            case 'change_angle':
              for (const id of ids) await get().changeAngle(id, action.instructions);
              break;
            case 'insert_scene': {
              // Posición actual de la escena de referencia (pudo moverse por inserciones previas)
              const count = get().storyboard?.scenes.length ?? 0;
              const after = afterId
                ? (get().storyboard?.scenes.find((s) => s.id === afterId)?.index ?? count)
                : action.scenes.includes(0)
                  ? 0
                  : count;
              await get().insertScene(after, action.instructions);
              break;
            }
            case 'delete_scene':
              if (ids.length > 0) get().requestDeleteScenes(ids);
              break;
            case 'approve_scenes':
              ids.forEach((id) => get().approveScene(id));
              break;
            case 'retake_scene':
              ids.forEach((id) => patchScene(id, { seed: Math.floor(Math.random() * 2_000_000_000) }));
              await proposeRender(ids, 'Repetiré la toma con otra variación (mismo guion).');
              break;
            case 'render_scenes':
              if (ids.length === 0) say('No hay escenas pendientes de renderizar.');
              else await proposeRender(ids);
              break;
            case 'assemble_video': {
              const stale = byIndex(get().storyboard?.scenes ?? []).filter((s) => s.render?.stale).map((s) => s.index);
              if (stale.length > 0) say(`Ojo: la escena ${stale.join(', ')} está desactualizada, así que su empalme puede saltar. La uno igual; si quieres, pídeme renderizar lo pendiente.`);
              await get().assemble(action.instructions || undefined);
              break;
            }
          }
        }
      };

      return {
        messages: [],
        references: [],
        settings: DEFAULT_STUDIO_SETTINGS,
        storyboard: null,
        activities: [],
        phase: null,
        busy: null,
        uploading: false,
        estimate: null,
        renderQueue: [],
        actionsRunning: false,
        insertDraft: null,
        edgeMenu: null,
        finalVideoUrl: null,
        savedProjectPath: null,
        assembling: false,
        error: null,

        setInsertDraft: (insertDraft) => set(insertDraft ? { insertDraft, edgeMenu: null } : { insertDraft }),
        setEdgeMenu: (edgeMenu) => set(edgeMenu ? { edgeMenu, insertDraft: null } : { edgeMenu }),

        sendMessage: async (text) => {
          const message = text.trim();
          if (!message || get().busy || get().actionsRunning) return;
          const history = get()
            .messages.filter((m) => (m.role === 'user' || m.role === 'agent') && m.content)
            .map((m) => ({ role: m.role as 'user' | 'agent', content: m.content }));
          addMessage({ role: 'user', content: message });
          set({ busy: 'agent', activities: [], phase: 'El agente está pensando', error: null });
          abortController = new AbortController();
          let actions: AgentAction[] = [];
          try {
            const { storyboard, references, settings } = get();
            const res = await fetch('/api/ugc-studio/agent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message, history, storyboard, references, settings }),
              signal: abortController.signal,
            });
            await readEventStream(res, (event) => {
              if (event.type === 'agent_reply') {
                addMessage({ role: 'agent', content: event.reply });
                actions = event.actions;
              } else handleEvent(event);
            });
          } catch (err: any) {
            if (err.name !== 'AbortError') set({ error: err.message });
          } finally {
            set({ busy: null, phase: null });
            abortController = null;
          }
          if (actions.length > 0 && !get().error) {
            stopActions = false;
            set({ actionsRunning: true });
            try {
              await executeActions(actions);
            } finally {
              set({ actionsRunning: false });
            }
          }
        },

        confirmCard: async (messageId, choice) => {
          const card = get().messages.find((m) => m.id === messageId)?.card;
          if (!card || card.status !== 'pending' || get().busy || get().actionsRunning) return;
          set((st) => ({
            messages: st.messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, status: 'confirmed' } } : m)),
          }));
          const markCard = (status: ChatCard['status']) =>
            set((st) => ({ messages: st.messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, status } } : m)) }));
          const rendering = (ids?: string[]) =>
            (get().storyboard?.scenes ?? []).filter((s) => s.status === 'rendering' && (!ids || ids.includes(s.id)));
          if (card.kind === 'regenerate' && card.brief) {
            // Un storyboard nuevo deja de seguir los renders en curso: se perderían clips ya pagados
            if (rendering().length > 0) {
              markCard('pending');
              set({ error: 'Hay escenas renderizándose: espera a que terminen antes de crear un storyboard nuevo.' });
              return;
            }
            if (card.settings) get().setSettings(card.settings);
            await runStoryboard(card.brief);
          }
          if (card.kind === 'delete' && card.sceneIds) {
            const busyScenes = rendering(card.sceneIds);
            if (busyScenes.length > 0 || blockedByRendering()) {
              markCard('pending');
              if (busyScenes.length > 0) set({ error: `La escena ${busyScenes.map((s) => s.index).join(', ')} se está renderizando: espera a que termine para eliminarla.` });
              return;
            }
            const sceneIds = card.sceneIds;
            await withLock(async () => {
              const before = get().storyboard?.scenes ?? [];
              deleteScenes(sceneIds);
              await reconcileJoints(changedJointIds(before, get().storyboard?.scenes ?? []));
            });
          }
          if (card.kind === 'joint' && card.sceneIds?.[0]) await get().resolveJoint(card.sceneIds[0], choice ?? 'reescribir');
          if (card.kind === 'render' && card.sceneIds) {
            const scenes = get().storyboard?.scenes ?? [];
            const skipped: number[] = [];
            const ids = card.sceneIds.filter((id) => {
              const scene = scenes.find((s) => s.id === id);
              if (!scene) return false;
              const changed = card.sceneTasks && (scene.render?.taskId ?? null) !== (card.sceneTasks[id] ?? null);
              if (scene.status === 'rendering' || changed) {
                skipped.push(scene.index);
                return false;
              }
              return true;
            });
            if (skipped.length > 0) say(`Omití la escena ${skipped.join(', ')}: ya se renderizó o se está renderizando desde que te propuse esto.`);
            if (ids.length > 0) await runRenderQueue(ids);
          }
          if (card.kind === 'open' && card.projectName) await openProjectByName(card.projectName);
        },

        cancelCard: (messageId) => {
          const card = get().messages.find((m) => m.id === messageId)?.card;
          set((st) => ({
            messages: st.messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, status: 'cancelled' } } : m)),
          }));
          // "Dejar así": el usuario acepta el empalme tal como está
          if (card?.kind === 'joint' && card.status === 'pending' && card.sceneIds?.[0]) patchScene(card.sceneIds[0], { jointIssue: undefined });
        },

        // Detiene a los agentes; la cola de render tiene su propio botón ("Detener cola")
        cancel: () => {
          stopActions = true;
          abortController?.abort();
          set({ busy: null, phase: null });
        },

        addReference: async (file, role, label) => {
          set({ uploading: true, error: null });
          try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/api/ugc-studio/references', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            set((st) => {
              // Nunca reutilizar un ID que el storyboard todavía cite: si se borró ref2 y se sube otra
              // imagen, llamarla ref2 haría que las escenas apunten a la imagen equivocada
              const used = [
                ...st.references.map((r) => r.id),
                ...(st.storyboard?.scenes.flatMap((sc) => sc.referenceIds) ?? []),
              ];
              const next = Math.max(0, ...used.map((id) => Number(id.replace('ref', '')) || 0)) + 1;
              return { references: [...st.references, { id: `ref${next}`, url: data.url, role, label: label.trim() }] };
            });
            return true;
          } catch (err: any) {
            set({ error: err.message || 'No se pudo subir la referencia.' });
            return false;
          } finally {
            set({ uploading: false });
          }
        },

        updateReference: (id, patch) =>
          set((st) => ({ references: st.references.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

        removeReference: (id) => set((st) => ({ references: st.references.filter((r) => r.id !== id) })),

        // Siempre dentro de los rangos válidos (el agente puede pedir más de lo permitido)
        setSettings: (patch) => set((st) => ({ settings: sanitizeSettings({ ...st.settings, ...patch }) })),

        approveScene: (sceneId) => patchScene(sceneId, (s) => ({ status: s.status === 'draft' ? 'approved' : s.status })),

        reviseScene: async (sceneId, feedback) => {
          const { storyboard, references, settings } = get();
          if (!storyboard || get().busy || blockedByQueue()) return false;
          const changedIndex = storyboard.scenes.find((s) => s.id === sceneId)?.index ?? 0;
          const ok = await runEdit('revision', '/api/ugc-studio/scene/revise', { storyboard, references, settings, sceneId, feedback }, (sb) =>
            mergeEdited(sb, [sceneId])
          );
          if (ok) {
            set((st) => ({
              storyboard: st.storyboard ? { ...st.storyboard, scenes: markDownstreamStale(st.storyboard.scenes, changedIndex) } : null,
              // La revisión ya rehízo la escena mirando a sus vecinas: su aviso de empalme queda resuelto
              messages: st.messages.map((m) =>
                m.card?.kind === 'joint' && m.card.status === 'pending' && m.card.sceneIds?.includes(sceneId)
                  ? { ...m, card: { ...m.card, status: 'confirmed' } }
                  : m
              ),
            }));
          }
          return ok;
        },

        relightScene: (sceneId, lighting) => get().reviseScene(sceneId, RELIGHT_FEEDBACK(lighting)),

        changeAngle: (sceneId, angle) => get().reviseScene(sceneId, ANGLE_FEEDBACK(angle)),

        insertScene: async (afterIndex, instructions) => {
          const { storyboard, references, settings } = get();
          if (!storyboard || get().busy || !instructions.trim() || blockedByRendering()) return;
          await withLock(async () => {
            const before = new Set(storyboard.scenes.map((s) => s.id));
            let insertedIndex = afterIndex + 1;
            let addedIds: string[] = [];
            const ok = await runEdit('insert', '/api/ugc-studio/scene/insert', { storyboard, references, settings, afterIndex, instructions }, (sb) => {
              const added = sb.scenes.filter((s) => !before.has(s.id));
              insertedIndex = added[0]?.index ?? insertedIndex;
              addedIds = added.map((s) => s.id);
              mergeEdited(sb, addedIds);
            });
            if (ok) {
              // La escena que ahora sigue a la insertada arranca desde otro fotograma (o pasó de abrir a continuar)
              set((st) => {
                if (!st.storyboard) return {};
                const scenes = st.storyboard.scenes.map((s) =>
                  s.index === insertedIndex + 1 && s.render?.videoUrl ? { ...s, render: { ...s.render, stale: true } } : s
                );
                return { storyboard: { ...st.storyboard, scenes: markDownstreamStale(scenes, insertedIndex + 1) } };
              });
              say(`Escena nueva insertada en la posición ${insertedIndex}. Apruébala y renderízala cuando quieras.`);
              // La escena nueva ya se diseñó mirando a sus vecinas; la que la sigue ahora arranca desde ella
              await reconcileJoints(changedJointIds(storyboard.scenes, get().storyboard?.scenes ?? [], addedIds));
            }
          });
        },

        requestDeleteScenes: (sceneIds) => {
          if (blockedByQueue()) return;
          const scenes = byIndex(get().storyboard?.scenes ?? []).filter((s) => sceneIds.includes(s.id));
          if (scenes.length === 0) return;
          const rendered = scenes.filter((s) => s.render?.videoUrl).length;
          addMessage({
            role: 'studio',
            content: '',
            card: {
              kind: 'delete',
              title: `Eliminar ${scenes.length === 1 ? `la escena ${scenes[0].index}` : `las escenas ${scenes.map((s) => s.index).join(', ')}`}`,
              detail: `${rendered > 0 ? `Se pierde${rendered === 1 ? '' : 'n'} ${rendered} clip(s) ya renderizado(s). ` : ''}La escena siguiente queda desactualizada si dependía de ella.`,
              status: 'pending',
              sceneIds: scenes.map((s) => s.id),
            },
          });
        },

        moveScene: async (sceneId, to) => {
          if (get().busy || blockedByRendering()) return;
          await withLock(() => moveAndCheck(sceneId, to));
        },

        duplicateScene: async (sceneId) => {
          if (get().busy || blockedByRendering()) return;
          await withLock(() => duplicateAndCheck(sceneId));
        },

        setTransition: async (sceneId, type) => {
          if (get().busy || blockedByRendering()) return;
          await withLock(() => applyTransition(sceneId, type));
        },

        resolveJoint: async (sceneId, choice) => {
          // La decisión vale para la tarjeta del chat aunque se tome desde el lienzo
          set((st) => ({
            messages: st.messages.map((m) =>
              m.card?.kind === 'joint' && m.card.status === 'pending' && m.card.sceneIds?.includes(sceneId)
                ? { ...m, card: { ...m.card, status: choice === 'ignorar' ? 'cancelled' : 'confirmed' } }
                : m
            ),
          }));
          const scene = get().storyboard?.scenes.find((s) => s.id === sceneId);
          if (!scene) return; // la escena ya no existe (p. ej. se eliminó)
          if (choice === 'ignorar') {
            patchScene(sceneId, { jointIssue: undefined });
            return;
          }
          if (get().busy || blockedByRendering()) return;
          const problem = scene.jointIssue?.problem ?? 'Su inicio no coincide con el final de la escena anterior.';
          await withLock(() => fixJoint(sceneId, choice, problem));
        },

        renameProject: (title) => {
          const name = title.trim().slice(0, 120);
          if (!name || !get().storyboard) return;
          set((st) => (st.storyboard ? { storyboard: { ...st.storyboard, title: name } } : {}));
          say(`Listo, el proyecto ahora se llama "${name}". Se usa al guardar un video nuevo; un proyecto ya guardado conserva su carpeta.`);
        },

        stopRenderQueue: () => {
          if (get().renderQueue.length === 0) {
            say('No hay renders en cola.');
            return;
          }
          set({ renderQueue: [] });
          say('Detuve la cola. La escena que ya se estaba generando termina igual (ya está pagada).');
        },

        requestRenderPending: async () => {
          const ids = resolveIds([], 'pending');
          if (ids.length === 0) say('No hay escenas pendientes de renderizar.');
          else await proposeRender(ids);
        },

        retakeScene: async (sceneId) => {
          patchScene(sceneId, { seed: Math.floor(Math.random() * 2_000_000_000) });
          await get().requestRenderEstimate(sceneId);
        },

        requestRenderEstimate: async (sceneId) => {
          const { storyboard, references, settings } = get();
          set({ error: null });
          try {
            const res = await fetch('/api/ugc-studio/scene/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                // Renderizar implica aprobar la escena
                storyboard: storyboard && {
                  ...storyboard,
                  scenes: storyboard.scenes.map((s) => (s.id === sceneId && s.status === 'draft' ? { ...s, status: 'approved' } : s)),
                },
                references,
                settings,
                sceneId,
                confirm: false,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
            set({ estimate: { sceneId, ...data } });
          } catch (err: any) {
            set({ error: err.message || 'No se pudo calcular el costo de la escena.' });
          }
        },

        dismissEstimate: () => set({ estimate: null }),

        confirmRender: async () => {
          const { estimate } = get();
          if (!estimate) return;
          set({ estimate: null });
          get().approveScene(estimate.sceneId);
          await dispatchRender(estimate.sceneId, false);
        },

        assemble: async (projectName) => {
          const { storyboard, references, settings, savedProjectPath } = get();
          if (!storyboard) return;
          set({ assembling: true, error: null });
          try {
            // Volver a unir un proyecto abierto sobrescribe su carpeta en vez de crear otra
            const savedName = savedProjectPath?.split(/[\\/]/).filter(Boolean).pop();
            const res = await fetch('/api/ugc-studio/assemble', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard, references, settings, projectName: projectName || savedName || storyboard.title }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            set({ finalVideoUrl: data.videoUrl, savedProjectPath: data.project?.path ?? null });
            say(`Video final listo y guardado como "${data.project?.name ?? storyboard.title}".`);
          } catch (err: any) {
            set({ error: err.message });
          } finally {
            set({ assembling: false });
          }
        },

        hydrate: ({ storyboard, references, settings }, saved) => {
          set({
            storyboard,
            references,
            settings: sanitizeSettings(settings),
            messages: [{ id: uid(), role: 'studio', content: `Proyecto cargado: "${storyboard.title}". ¿Qué quieres cambiar?` }],
            activities: [],
            estimate: null,
            insertDraft: null,
            edgeMenu: null,
            renderQueue: [],
            finalVideoUrl: saved?.videoUrl ?? null,
            savedProjectPath: saved?.path ?? null,
            error: null,
          });
          get().resumeRenders();
        },

        // Retoma el seguimiento de escenas que quedaron renderizándose (al recargar o abrir un proyecto)
        resumeRenders: () => {
          get().storyboard?.scenes.forEach((s) => {
            if (s.status !== 'rendering') return;
            if (s.render?.taskId) void pollRender(s.id, s.render.taskId);
            else
              // La página se cerró antes de recibir el id de la tarea: no se sabe si OpenRouter la aceptó
              patchScene(s.id, {
                status: 'failed',
                render: { error: 'La página se recargó mientras se enviaba el render. Revisa tu panel de OpenRouter antes de reintentar.' },
              });
          });
        },

        reset: () => {
          abortController?.abort();
          set({
            messages: [],
            references: [],
            storyboard: null,
            activities: [],
            phase: null,
            busy: null,
            estimate: null,
            insertDraft: null,
            edgeMenu: null,
            renderQueue: [],
            finalVideoUrl: null,
            savedProjectPath: null,
            error: null,
          });
        },

        clearError: () => set({ error: null }),
      };
    },
    {
      name: 'ugc-studio',
      version: 2,
      // En el servidor no hay localStorage (y Node avisa si se toca su versión experimental)
      storage: createJSONStorage(() => (typeof window === 'undefined' ? serverStorage : window.localStorage)),
      // Se rehidrata desde UgcGeneratorView (en el cliente) para no romper el render del servidor
      skipHydration: true,
      // Solo el trabajo del usuario; lo transitorio (agentes, cargas, errores) arranca limpio
      partialize: (state) => ({
        messages: state.messages,
        references: state.references,
        settings: state.settings,
        storyboard: state.storyboard,
        finalVideoUrl: state.finalVideoUrl,
        savedProjectPath: state.savedProjectPath,
      }),
      // v1 → v2: los mensajes del chat ganaron el rol "agent" y tarjetas; el resto es compatible
      migrate: (persisted) => persisted as UgcStudioState,
      // Ajustes guardados antes de existir idioma, estilo y formato: se completan con los valores por defecto
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UgcStudioState>;
        return { ...current, ...saved, settings: sanitizeSettings(saved.settings) };
      },
      onRehydrateStorage: () => (state) => state?.resumeRenders(),
    }
  )
);
