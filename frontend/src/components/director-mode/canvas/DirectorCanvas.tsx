'use client';

import '@xyflow/react/dist/style.css';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { LayoutGrid } from 'lucide-react';
import { useThemeStore } from '@/store/useThemeStore';
import type { DirectorState } from '@/lib/director-mode/types';
import { buildGraph, type DirectorNode } from './build-graph';
import { nodeTypes } from './nodes';

/**
 * Lienzo del modo Director: lo que ya existe (idea, dirección, escenas, prompts) y lo que viene, en gris.
 * Clic en un nodo → el chat se enfoca en él. Las posiciones movidas a mano se guardan en el navegador
 * por producción (nunca en produccion.json); "Ordenar" vuelve al acomodo inicial.
 */

type Positions = Record<string, { x: number; y: number }>;

const posKey = (productionId: string) => `lulo_director_canvas_${productionId}`;

function readPositions(productionId: string): Positions {
  try {
    return JSON.parse(localStorage.getItem(posKey(productionId)) || '{}') as Positions;
  } catch {
    return {};
  }
}

function writePositions(productionId: string, nodes: DirectorNode[]) {
  try {
    localStorage.setItem(posKey(productionId), JSON.stringify(Object.fromEntries(nodes.map((n) => [n.id, n.position]))));
  } catch {
    // sin almacenamiento: no se recuerdan las posiciones
  }
}

/** Nodos nuevos del grafo, conservando la posición (y la medida) de los que ya estaban. */
function place(base: DirectorNode[], current: DirectorNode[], saved: Positions): DirectorNode[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  return base.map((n) => {
    const prev = byId.get(n.id);
    if (prev) return { ...n, position: prev.position, measured: prev.measured };
    return saved[n.id] ? { ...n, position: saved[n.id] } : n;
  });
}

interface Props {
  productionId: string;
  d: DirectorState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function CanvasInner({ productionId, d, selectedId, onSelect }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const { fitView } = useReactFlow();
  const graph = useMemo(() => buildGraph(d, productionId), [d, productionId]);
  const [nodes, setNodes] = useState<DirectorNode[]>(() => place(graph.nodes, [], readPositions(productionId)));
  const [prevGraph, setPrevGraph] = useState(graph);

  // El borrador cambió en el servidor: se rehace el grafo sin perder lo que la persona movió
  if (prevGraph !== graph) {
    setPrevGraph(graph);
    setNodes((cur) => place(graph.nodes, cur, readPositions(productionId)));
  }

  const shown = useMemo(() => nodes.map((n) => (n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId })), [nodes, selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<DirectorNode>[]) => {
    // La selección la controla el estudio (para enfocar el chat)
    const rest = changes.filter((c) => c.type !== 'select');
    if (rest.length) setNodes((ns) => applyNodeChanges(rest, ns));
  }, []);

  const tidy = () => {
    try {
      localStorage.removeItem(posKey(productionId));
    } catch {
      // nada que borrar
    }
    setNodes(place(graph.nodes, [], {}));
    requestAnimationFrame(() => void fitView({ padding: 0.15, duration: 300 }));
  };

  return (
    <ReactFlow<DirectorNode>
      className="lulo-flow"
      nodes={shown}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => n.selectable !== false && onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={() => writePositions(productionId, nodes)}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      colorMode={theme === 'dark' ? 'dark' : 'light'}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.25}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap pannable zoomable position="bottom-left" className="!hidden sm:!block" />
      <div className="absolute right-3 top-3 z-10">
        <button type="button" onClick={tidy} className="btn-secondary h-8 px-2.5 text-[11.5px]" title="Volver al acomodo inicial">
          <LayoutGrid className="h-3.5 w-3.5" /> Ordenar
        </button>
      </div>
    </ReactFlow>
  );
}

export function DirectorCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      {/* La key reinicia el lienzo al cambiar de borrador */}
      <CanvasInner key={props.productionId} {...props} />
    </ReactFlowProvider>
  );
}
