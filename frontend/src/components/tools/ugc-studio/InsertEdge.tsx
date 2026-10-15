'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';

export type InsertEdgeData = { afterIndex: number; anchorId: string; continuous: boolean; locked: boolean };
export type InsertFlowEdge = Edge<InsertEdgeData, 'insert'>;

/** Conexión entre escenas con un "+" en el medio para insertar una escena intermedia. */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<InsertFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const insertDraft = useUgcStudioStore((s) => s.insertDraft);
  const setInsertDraft = useUgcStudioStore((s) => s.setInsertDraft);
  const continuous = data?.continuous ?? true;
  const active = insertDraft?.anchorId === data?.anchorId && insertDraft?.afterIndex === data?.afterIndex;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: continuous ? 'var(--accent)' : 'var(--line-strong)', strokeWidth: 1.5, strokeDasharray: continuous ? undefined : '6 4' }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {/* El formulario se abre junto a la escena siguiente (las etiquetas quedan bajo las tarjetas) */}
          <button
            type="button"
            title="Insertar una escena aquí"
            aria-label="Insertar una escena aquí"
            disabled={data?.locked}
            onClick={() => data && setInsertDraft(active ? null : { afterIndex: data.afterIndex, anchorId: data.anchorId })}
            className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-all hover:scale-110 disabled:opacity-40 ${
              active ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted hover:border-accent hover:text-accent'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
