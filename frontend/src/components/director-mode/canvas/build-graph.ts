import type { Edge, Node } from '@xyflow/react';
import { promptIsStale } from '@/lib/director-mode/stages';
import type { DirectorScene, DirectorState, StageStatus } from '@/lib/director-mode/types';

/**
 * produccion.json (campo director) → nodos y aristas del lienzo. Función pura:
 * no guarda nada; las posiciones movidas a mano viven en el navegador (DirectorCanvas).
 *
 *   [Idea] → [Dirección] → [Escena N] → [Prompt N] ┄ [Imagen N] ┄ [Clip N] ┄ [Video final]
 */

export type NodeTone = 'ok' | 'review' | 'stale' | 'pending' | 'blocked' | 'error' | 'future';

export type DirectorNodeData =
  | { kind: 'idea'; tone: NodeTone; d: DirectorState }
  | { kind: 'direccion'; tone: NodeTone; d: DirectorState }
  | { kind: 'escena'; tone: NodeTone; d: DirectorState; scene: DirectorScene }
  | { kind: 'prompt'; tone: NodeTone; d: DirectorState; scene: DirectorScene }
  | { kind: 'guion-pendiente'; tone: NodeTone; d: DirectorState }
  | { kind: 'futuro'; tone: 'future'; titulo: string; fase: number; compacto?: boolean };

export type DirectorNode = Node<DirectorNodeData, 'director'>;

/** Ids de nodo: los usa el chat para saber en qué está enfocado. */
export const nodeId = {
  idea: 'idea',
  direccion: 'direccion',
  guionPendiente: 'guion-pendiente',
  escena: (id: string) => `escena:${id}`,
  prompt: (id: string) => `prompt:${id}`,
  imagen: (id: string) => `imagen:${id}`,
  clip: (id: string) => `clip:${id}`,
  final: 'final',
};

export function parseNodeId(id: string | null): { kind: string; sceneId?: string } | null {
  if (!id) return null;
  const [kind, sceneId] = id.split(':');
  return { kind, sceneId };
}

export function stageTone(estado: StageStatus): NodeTone {
  switch (estado) {
    case 'aprobada':
      return 'ok';
    case 'por_revisar':
      return 'review';
    case 'desactualizada':
      return 'stale';
    case 'pendiente':
      return 'pending';
    case 'bloqueada':
      return 'blocked';
    case 'error':
      return 'error';
  }
}

const RANK: NodeTone[] = ['error', 'stale', 'review', 'pending', 'blocked', 'ok'];
/** El estado "peor" de varios (para Dirección = Preguntas + Ajustes). */
function worst(...tones: NodeTone[]): NodeTone {
  return RANK.find((t) => tones.includes(t)) ?? 'ok';
}

// Columnas (x) y alto de fila (y)
const X = { idea: 0, direccion: 300, escena: 620, prompt: 980, imagen: 1340, clip: 1540, final: 1760 };
const ROW = 190;

export function buildGraph(d: DirectorState): { nodes: DirectorNode[]; edges: Edge[] } {
  const scenes = d.guion?.escenas ?? [];
  const rows = Math.max(1, scenes.length);
  const midY = ((rows - 1) * ROW) / 2;
  const nodes: DirectorNode[] = [];
  const edges: Edge[] = [];
  const add = (id: string, x: number, y: number, data: DirectorNodeData) =>
    nodes.push({
      id,
      type: 'director',
      position: { x, y },
      data,
      // Los nodos futuros no se eligen ni se arrastran
      ...(data.kind === 'futuro' ? { selectable: false, focusable: false } : {}),
    });
  const link = (source: string, target: string, future = false) =>
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: 'smoothstep',
      className: future ? 'lulo-edge-future' : 'lulo-edge',
      animated: false,
    });

  add(nodeId.idea, X.idea, midY, { kind: 'idea', tone: stageTone(d.etapas.idea.estado), d });
  add(nodeId.direccion, X.direccion, midY, {
    kind: 'direccion',
    tone: worst(stageTone(d.etapas.preguntas.estado), stageTone(d.etapas.ajustes.estado)),
    d,
  });
  link(nodeId.idea, nodeId.direccion);

  if (!scenes.length) {
    add(nodeId.guionPendiente, X.escena, midY, { kind: 'guion-pendiente', tone: stageTone(d.etapas.guion.estado), d });
    link(nodeId.direccion, nodeId.guionPendiente);
    add(nodeId.final, X.final, midY, { kind: 'futuro', tone: 'future', titulo: 'Video final', fase: 4 });
    link(nodeId.guionPendiente, nodeId.final, true);
    return { nodes, edges };
  }

  const guionTone = stageTone(d.etapas.guion.estado);
  const promptsStarted = scenes.some((s) => s.prompt);
  scenes.forEach((s, i) => {
    const y = i * ROW;
    add(nodeId.escena(s.id), X.escena, y, { kind: 'escena', tone: guionTone, d, scene: s });
    link(nodeId.direccion, nodeId.escena(s.id));

    // Sin prompt: bloqueado o pendiente (en ámbar si los demás ya existen). Con prompt viejo: desactualizado.
    const promptTone: NodeTone = !s.prompt
      ? d.etapas.prompts.estado === 'bloqueada'
        ? 'blocked'
        : promptsStarted
        ? 'stale'
        : 'pending'
      : promptIsStale(s)
      ? 'stale'
      : stageTone(d.etapas.prompts.estado);
    add(nodeId.prompt(s.id), X.prompt, y, { kind: 'prompt', tone: promptTone, d, scene: s });
    link(nodeId.escena(s.id), nodeId.prompt(s.id));

    add(nodeId.imagen(s.id), X.imagen, y + 40, { kind: 'futuro', tone: 'future', titulo: 'Imagen inicial', fase: 3, compacto: true });
    add(nodeId.clip(s.id), X.clip, y + 40, { kind: 'futuro', tone: 'future', titulo: 'Clip', fase: 4, compacto: true });
    link(nodeId.prompt(s.id), nodeId.imagen(s.id), true);
    link(nodeId.imagen(s.id), nodeId.clip(s.id), true);
    link(nodeId.clip(s.id), nodeId.final, true);
  });
  add(nodeId.final, X.final + 40, midY + 30, { kind: 'futuro', tone: 'future', titulo: 'Video final', fase: 4 });
  return { nodes, edges };
}
