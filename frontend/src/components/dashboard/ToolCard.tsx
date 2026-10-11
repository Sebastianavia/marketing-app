'use client';

import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ToolDefinition, ToolId } from '@/config/tools.config';

interface ToolCardProps {
  tool: ToolDefinition;
  onSelect: (toolId: ToolId) => void;
  size?: 'large' | 'compact';
}

export function ToolCard({ tool, onSelect, size = 'large' }: ToolCardProps) {
  const Icon = tool.icon;
  const large = size === 'large';

  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      className={`surface-card surface-card-interactive group relative flex w-full flex-col text-left ${
        large ? 'min-h-[220px] p-6' : 'p-5'
      }`}
    >
      <div className="flex items-start justify-between">
        <span
          className={`flex items-center justify-center rounded-xl border border-line bg-surface-2 text-fg transition-colors group-hover:text-accent ${
            large ? 'h-11 w-11' : 'h-9 w-9'
          }`}
        >
          <Icon className={large ? 'h-5 w-5' : 'h-[18px] w-[18px]'} />
        </span>

        <div className="flex items-center gap-2">
          {tool.preview && (
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-subtle">
              Vista previa
            </span>
          )}
          <ArrowUpRight className="h-4 w-4 text-fg-subtle transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />
        </div>
      </div>

      <div className={large ? 'mt-auto pt-8' : 'mt-4'}>
        <p className="text-[12px] font-medium text-fg-subtle">{tool.formula}</p>
        <h3 className={`mt-1 font-semibold text-fg ${large ? 'text-lg' : 'text-[15px]'}`}>{tool.title}</h3>
        <p className={`mt-1.5 max-w-[46ch] text-fg-muted ${large ? 'text-sm leading-relaxed' : 'text-[13px] leading-relaxed'}`}>
          {tool.description}
        </p>
        {large && tool.engines && <p className="mt-4 text-[12px] text-fg-subtle">{tool.engines}</p>}
      </div>
    </button>
  );
}
