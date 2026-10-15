'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutTemplate } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';
import { useThemeStore } from '@/store/useThemeStore';
import { OverviewNode, SceneNode, type OverviewFlowNode, type SceneFlowNode } from './SceneNode';
import { sentReferenceIds } from '@/types/ugc-studio.types';

const nodeTypes = { scene: SceneNode, overview: OverviewNode };

const COLUMN_WIDTH = 400;

/** Lienzo tipo storyboard: concepto a la izquierda y las escenas en fila, unidas por su transición. */
export function StoryboardCanvas() {
  const storyboard = useUgcStudioStore((s) => s.storyboard);
  const references = useUgcStudioStore((s) => s.references);
  const busy = useUgcStudioStore((s) => s.busy);
  const theme = useThemeStore((s) => s.theme);

  const { nodes, edges } = useMemo(() => {
    if (!storyboard) return { nodes: [], edges: [] };
    const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);

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
      position: { x: 340 + i * COLUMN_WIDTH, y: 0 },
      data: {
        scene,
        references,
        sentReferenceIds: sentReferenceIds(scenes, scene, references),
        previousRendered: Boolean(scenes[i - 1]?.render?.lastFrameUrl),
        locked: Boolean(busy),
      },
    }));

    const sceneEdges: Edge[] = scenes.map((scene, i) => {
      const source = i === 0 ? 'overview' : scenes[i - 1].id;
      const continuous = scene.transition.type === 'continua';
      return {
        id: `e-${source}-${scene.id}`,
        source,
        target: scene.id,
        animated: continuous,
        label: i === 0 ? undefined : continuous ? 'continua' : 'corte',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: continuous ? '#6366f1' : '#94a3b8', strokeDasharray: continuous ? undefined : '6 4' },
      };
    });

    return { nodes: [overview, ...sceneNodes] as Node[], edges: sceneEdges };
  }, [storyboard, references, busy]);

  // Posiciones movidas por el usuario; los nodos se derivan siempre de los datos actuales
  // (así el lienzo monta ya con las escenas y fitView las encuadra)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const flowNodes = useMemo(
    () => nodes.map((n) => ({ ...n, position: positions[n.id] ?? n.position })),
    [nodes, positions]
  );
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const moved = changes.filter((c) => c.type === 'position' && c.position);
    if (moved.length === 0) return;
    setPositions((prev) => {
      const next = { ...prev };
      for (const c of moved) if (c.type === 'position' && c.position) next[c.id] = c.position;
      return next;
    });
  }, []);

  if (!storyboard) {
    return (
      <div className="surface-card rounded-xl h-full min-h-[560px] flex flex-col items-center justify-center gap-2 text-center px-8">
        <LayoutTemplate className="h-8 w-8 text-slate-300 dark:text-zinc-700" />
        <p className="text-xs font-medium text-slate-700 dark:text-zinc-300">Aquí aparecerá el storyboard</p>
        <p className="text-[11px] text-slate-500 dark:text-zinc-500 max-w-sm">
          Los agentes dividen tu video en escenas largas con mínimos cortes. Aprueba cada escena y renderízala en orden
          para encadenar el último fotograma de una con el primero de la siguiente.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card rounded-xl h-full min-h-[560px] overflow-hidden">
      <ReactFlow
        key={storyboard.id}
        nodes={flowNodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
