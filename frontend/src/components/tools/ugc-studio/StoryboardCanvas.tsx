'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Sparkles } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { useThemeStore } from '@/store/useThemeStore';
import { AddSceneNode, OverviewNode, SceneNode, type AddSceneFlowNode, type OverviewFlowNode, type SceneFlowNode } from './SceneNode';
import { InsertEdge, type InsertFlowEdge } from './InsertEdge';
import { sentReferenceIds } from '@/types/ugc-studio.types';

const nodeTypes = { scene: SceneNode, overview: OverviewNode, addScene: AddSceneNode };
const edgeTypes = { insert: InsertEdge };

const GAP = 90; // separación horizontal entre tarjetas
const OVERVIEW_WIDTH = 220;
const CARD_WIDTH = { '9:16': 210, '1:1': 280, '16:9': 360 } as const;

/** Lienzo infinito: el concepto a la izquierda y las escenas en fila, unidas por su transición. */
/** `rightInset`: píxeles que tapa el chat flotante, para encuadrar las escenas en el espacio libre. */
export function StoryboardCanvas({ rightInset = 0 }: { rightInset?: number }) {
  const storyboard = useUgcStudioStore((s) => s.storyboard);
  const references = useUgcStudioStore((s) => s.references);
  const busy = useUgcStudioStore((s) => s.busy);
  const aspectRatio = useUgcStudioStore((s) => s.settings.aspectRatio);
  const renderQueue = useUgcStudioStore((s) => s.renderQueue);
  const actionsRunning = useUgcStudioStore((s) => s.actionsRunning);
  const theme = useThemeStore((s) => s.theme);

  const { nodes, edges } = useMemo(() => {
    if (!storyboard) return { nodes: [] as Node[], edges: [] as Edge[] };
    const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
    // Bloqueado mientras trabajan los agentes o el agente creativo ejecuta sus pasos
    const locked = Boolean(busy) || actionsRunning;
    const cardWidth = CARD_WIDTH[aspectRatio];

    const overview: OverviewFlowNode = {
      id: 'overview',
      type: 'overview',
      position: { x: 0, y: 0 },
      data: {
        title: storyboard.title,
        concept: storyboard.concept,
        hook: storyboard.hook,
        cta: storyboard.cta,
        tone: storyboard.tone,
        bible: storyboard.bible,
        strategy: storyboard.strategy,
        supervision: storyboard.supervision,
      },
    };

    const sceneNodes: SceneFlowNode[] = scenes.map((scene, i) => ({
      id: scene.id,
      type: 'scene',
      position: { x: OVERVIEW_WIDTH + GAP + i * (cardWidth + GAP), y: -40 },
      data: {
        scene,
        references,
        sentReferenceIds: sentReferenceIds(scenes, scene, references),
        previousRendered: Boolean(scenes[i - 1]?.render?.lastFrameUrl),
        locked,
        aspectRatio,
        queued: renderQueue.includes(scene.id) && scene.status !== 'rendering',
      },
    }));

    const addNode: AddSceneFlowNode = {
      id: 'add-scene',
      type: 'addScene',
      position: { x: OVERVIEW_WIDTH + GAP + scenes.length * (cardWidth + GAP), y: 40 },
      data: { afterIndex: scenes.length, locked },
    };

    const sceneEdges: InsertFlowEdge[] = scenes.map((scene, i) => ({
      id: `e-${i === 0 ? 'overview' : scenes[i - 1].id}-${scene.id}`,
      source: i === 0 ? 'overview' : scenes[i - 1].id,
      target: scene.id,
      type: 'insert',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { afterIndex: i, anchorId: scene.id, continuous: scene.transition.type === 'continua', locked },
    }));
    const tail: Edge = {
      id: 'e-add',
      source: scenes.length ? scenes[scenes.length - 1].id : 'overview',
      target: 'add-scene',
      style: { stroke: 'var(--line-strong)', strokeDasharray: '4 4' },
    };

    return { nodes: [overview, ...sceneNodes, addNode] as Node[], edges: [...sceneEdges, tail] as Edge[] };
  }, [storyboard, references, busy, actionsRunning, aspectRatio, renderQueue]);

  // Los nodos se derivan siempre de los datos actuales (así el lienzo monta ya con las escenas,
  // fitView las encuadra y al insertar o borrar escenas todo se reacomoda). Aparte se guarda solo lo
  // que cambia React Flow: medidas, arrastre y selección. Las medidas son obligatorias (sin ellas no
  // da los nodos por inicializados y no se pueden arrastrar); la posición se guarda solo si el
  // usuario arrastró la tarjeta, o una escena insertada quedaría debajo de otra.
  type Override = Partial<Pick<Node, 'position' | 'measured' | 'dragging' | 'selected'>>;
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const flowNodes = useMemo(() => nodes.map((n) => ({ ...n, ...overrides[n.id] })), [nodes, overrides]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setOverrides((prev) => {
        const next = { ...prev };
        const applied = new Map(applyNodeChanges(changes, nodes.map((node) => ({ ...node, ...prev[node.id] }))).map((n) => [n.id, n]));
        for (const c of changes) {
          if (!('id' in c)) continue;
          const n = applied.get(c.id);
          if (!n) continue;
          const o: Override = { ...next[c.id] };
          if (c.type === 'dimensions') o.measured = n.measured;
          if (c.type === 'position') {
            if (c.position) o.position = n.position;
            o.dragging = n.dragging;
          }
          if (c.type === 'select') o.selected = n.selected;
          next[c.id] = o;
        }
        return next;
      }),
    [nodes]
  );

  // Encuadre: deja libres la barra superior, la del video final y el chat; se recalcula al abrir u ocultar el chat
  const fitViewOptions = useMemo<FitViewOptions>(
    () => ({ padding: { top: '96px', bottom: '96px', left: '48px', right: `${rightInset + 48}px` }, maxZoom: 1 }),
    [rightInset]
  );
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  // También al insertar o borrar escenas, para que ninguna quede bajo el chat
  const sceneCount = storyboard?.scenes.length ?? 0;
  useEffect(() => {
    // Espera a que React Flow mida las tarjetas nuevas antes de encuadrar
    const timer = setTimeout(() => void flow?.fitView({ ...fitViewOptions, duration: 300 }), 80);
    return () => clearTimeout(timer);
  }, [flow, fitViewOptions, sceneCount]);

  if (!storyboard) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-sm">
          <Sparkles className="h-5 w-5 text-accent" />
        </div>
        <p className="text-[15px] font-semibold text-fg">Cuéntale al agente qué video quieres</p>
        <p className="max-w-md text-[13px] leading-relaxed text-fg-muted">
          Describe el producto, el guion o la idea en el chat y adjunta fotos del personaje y del producto. El equipo de agentes
          arma el storyboard aquí, y desde el chat puedes cambiar escenas, insertar nuevas, ajustar la luz o el ángulo y renderizar.
        </p>
      </div>
    );
  }

  return (
    <ReactFlow
      key={storyboard.id}
      nodes={flowNodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={theme}
      onInit={setFlow}
      fitView
      fitViewOptions={fitViewOptions}
      minZoom={0.15}
      maxZoom={2}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      className="!bg-transparent"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
