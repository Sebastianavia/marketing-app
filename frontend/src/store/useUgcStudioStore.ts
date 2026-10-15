'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AgentActivity,
  DEFAULT_STUDIO_SETTINGS,
  ReferenceRole,
  SceneRender,
  Storyboard,
  StoryboardScene,
  StudioEvent,
  StudioSettings,
  UgcReference,
} from '@/types/ugc-studio.types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'studio';
  content: string;
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

interface UgcStudioState {
  messages: ChatMessage[];
  references: UgcReference[];
  settings: StudioSettings;
  storyboard: Storyboard | null;
  activities: AgentActivity[];
  phase: string | null;
  busy: 'storyboard' | 'revision' | null;
  uploading: boolean;
  estimate: RenderEstimate | null;
  finalVideoUrl: string | null;
  savedProjectPath: string | null;
  assembling: boolean;
  error: string | null;

  sendBrief: (text: string) => Promise<void>;
  cancel: () => void;
  addReference: (file: File, role: ReferenceRole, label: string) => Promise<boolean>;
  updateReference: (id: string, patch: Partial<Pick<UgcReference, 'role' | 'label'>>) => void;
  removeReference: (id: string) => void;
  setSettings: (patch: Partial<StudioSettings>) => void;
  approveScene: (sceneId: string) => void;
  reviseScene: (sceneId: string, feedback: string) => Promise<void>;
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

const serverStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const uid = () => Math.random().toString(36).slice(2, 10);

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
  return scenes.map((s) => {
    if (s.index <= changedIndex || chainBroken) return s;
    if (s.transition.type !== 'continua') {
      chainBroken = true;
      return s;
    }
    return s.render?.videoUrl ? { ...s, render: { ...s.render, stale: true } } : s;
  });
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

      const pollRender = async (sceneId: string, taskId: string) => {
        const startedAt = Date.now();
        while (true) {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            patchScene(sceneId, (s) => ({
              status: 'failed',
              render: { ...s.render, error: 'El render tardó más de 20 minutos. Revisa tu panel de OpenRouter antes de reintentar: un nuevo render se cobra de nuevo.' },
            }));
            return;
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const scene = get().storyboard?.scenes.find((s) => s.id === sceneId);
          if (!scene || scene.render?.taskId !== taskId) return; // escena cambiada o re-lanzada
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
              set((st) => ({
                storyboard: st.storyboard ? { ...st.storyboard, scenes: markDownstreamStale(st.storyboard.scenes, scene.index) } : null,
              }));
              return;
            }
            if (data.status === 'failed') {
              patchScene(sceneId, (s) => ({ status: 'failed', render: { ...s.render, error: data.error || 'El render falló.' } }));
              return;
            }
          } catch {
            // error de red transitorio: seguir consultando
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
        finalVideoUrl: null,
        savedProjectPath: null,
        assembling: false,
        error: null,

        sendBrief: async (text) => {
          const trimmed = text.trim();
          if (!trimmed || get().busy) return;
          const hadRenders = get().storyboard?.scenes.some((sc) => sc.render?.videoUrl) ?? false;
          const messages = [...get().messages, { id: uid(), role: 'user' as const, content: trimmed }];
          set({ messages, busy: 'storyboard', activities: [], phase: 'Preparando equipo de agentes', error: null, finalVideoUrl: null });

          // El brief es toda la conversación del usuario: los mensajes nuevos refinan los anteriores
          const brief = messages
            .filter((m) => m.role === 'user')
            .map((m, i) => (i === 0 ? m.content : `Ajuste ${i}: ${m.content}`))
            .join('\n');

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
              set((st) => ({
                messages: [
                  ...st.messages,
                  {
                    id: uid(),
                    role: 'studio',
                    content: `Storyboard listo: "${sb.title}" — ${sb.scenes.length} escena(s), ${sb.scenes.reduce((a, s) => a + s.durationSeconds, 0)} s. Revisa cada escena en el lienzo, apruébala o pide cambios.${
                      hadRenders ? ' Es un storyboard nuevo: los clips renderizados antes ya no forman parte de él.' : ''
                    }`,
                  },
                ],
              }));
            }
          } catch (err: any) {
            if (err.name !== 'AbortError') set({ error: err.message });
          } finally {
            set({ busy: null, phase: null });
            abortController = null;
          }
        },

        cancel: () => {
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

        setSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch } })),

        approveScene: (sceneId) => patchScene(sceneId, (s) => ({ status: s.status === 'draft' ? 'approved' : s.status })),

        reviseScene: async (sceneId, feedback) => {
          const { storyboard, references, settings } = get();
          if (!storyboard || get().busy) return;
          const changedIndex = storyboard.scenes.find((s) => s.id === sceneId)?.index ?? 0;
          set({ busy: 'revision', activities: [], error: null });
          abortController = new AbortController();
          try {
            const res = await fetch('/api/ugc-studio/scene/revise', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard, references, settings, sceneId, feedback }),
              signal: abortController.signal,
            });
            await readEventStream(res, (event) => {
              if (event.type !== 'storyboard') return handleEvent(event);
              // La revisión tarda: mientras tanto otras escenas pudieron terminar de renderizar. De la
              // respuesta solo se toma la escena revisada (y las referencias de cadena recalculadas);
              // el resto conserva su estado actual para no perder clips ya pagados.
              set((st) => {
                if (!st.storyboard || st.storyboard.id !== event.storyboard.id) return {};
                const current = st.storyboard.scenes;
                return {
                  storyboard: {
                    ...event.storyboard,
                    scenes: event.storyboard.scenes.map((s) => {
                      const local = current.find((l) => l.id === s.id);
                      return s.id === sceneId || !local ? s : { ...local, referenceIds: s.referenceIds };
                    }),
                  },
                };
              });
            });
            set((st) => ({
              storyboard: st.storyboard ? { ...st.storyboard, scenes: markDownstreamStale(st.storyboard.scenes, changedIndex) } : null,
            }));
          } catch (err: any) {
            if (err.name !== 'AbortError') set({ error: err.message });
          } finally {
            set({ busy: null, phase: null });
            abortController = null;
          }
        },

        requestRenderEstimate: async (sceneId) => {
          const { storyboard, references, settings } = get();
          set({ error: null });
          try {
            const res = await fetch('/api/ugc-studio/scene/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard, references, settings, sceneId, confirm: false }),
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
          const { estimate, storyboard, references, settings } = get();
          if (!estimate || !storyboard) return;
          set({ estimate: null });
          // Si el envío falla, el clip anterior (ya pagado) no debe perderse
          const previous = storyboard.scenes.find((s) => s.id === estimate.sceneId);
          patchScene(estimate.sceneId, { status: 'rendering', render: undefined });
          try {
            const res = await fetch('/api/ugc-studio/scene/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard, references, settings, sceneId: estimate.sceneId, confirm: true }),
            });
            const data = await res.json();
            if (res.status === 409 && data.taskId) {
              // Ya había un render en curso para esta escena: retomar su seguimiento en vez de pagar otro
              patchScene(estimate.sceneId, { render: { taskId: data.taskId } });
              void pollRender(estimate.sceneId, data.taskId);
              return;
            }
            if (!res.ok) throw new Error(data.error);
            const render: SceneRender = {
              taskId: data.taskId,
              costUSD: data.estimatedCostUSD,
              usedFirstFrame: data.usedFirstFrame,
              usedReferences: data.usedReferences,
            };
            patchScene(estimate.sceneId, { render });
            void pollRender(estimate.sceneId, data.taskId);
          } catch (err: any) {
            if (previous?.render?.videoUrl) {
              patchScene(estimate.sceneId, { status: previous.status, render: previous.render });
              set({ error: `No se pudo renderizar la escena ${previous.index}: ${err.message}` });
            } else {
              patchScene(estimate.sceneId, { status: 'failed', render: { error: err.message } });
            }
          }
        },

        assemble: async (projectName) => {
          const { storyboard, references, settings } = get();
          if (!storyboard) return;
          set({ assembling: true, error: null });
          try {
            const res = await fetch('/api/ugc-studio/assemble', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard, references, settings, projectName }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            set({ finalVideoUrl: data.videoUrl, savedProjectPath: data.project?.path ?? null });
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
            settings: { ...DEFAULT_STUDIO_SETTINGS, ...settings },
            messages: [{ id: uid(), role: 'studio', content: `Proyecto cargado: "${storyboard.title}".` }],
            activities: [],
            estimate: null,
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
      version: 1,
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
      onRehydrateStorage: () => (state) => state?.resumeRenders(),
    }
  )
);
