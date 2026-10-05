'use client';

import React from 'react';
import { ArrowUpRight } from 'lucide-react';

export interface ToolCardData {
  id: string;
  title: string;
  category: string;
  description: string;
  badge?: string;
  isDemo?: boolean;
  icon: React.ElementType;
}

interface ToolCardProps {
  tool: ToolCardData;
  onSelect: (toolId: string) => void;
}

export function ToolCard({ tool, onSelect }: ToolCardProps) {
  const Icon = tool.icon;

  return (
    <div
      onClick={() => onSelect(tool.id)}
      className="surface-card group relative flex flex-col justify-between rounded-xl p-5 cursor-pointer"
    >
      <div>
        {/* Top: Icon + Badge */}
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-900/60 text-zinc-300 group-hover:text-white group-hover:border-white/20 transition-all">
            <Icon className="h-4 w-4" />
          </div>

          <div className="flex items-center gap-2">
            {tool.badge && (
              <span className={`font-mono text-[10px] uppercase tracking-widest border rounded px-1.5 py-0.5 ${
                tool.isDemo
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-400/90'
                  : 'border-white/[0.06] text-zinc-500'
              }`}>
                {tool.badge}
              </span>
            )}
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-600 transition-all group-hover:text-zinc-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>

        {/* Content */}
        <div className="mt-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {tool.category}
          </span>
          <h3 className="text-sm font-medium text-zinc-100 tracking-tight mt-0.5 group-hover:text-white transition-colors">
            {tool.title}
          </h3>
          <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
            {tool.description}
          </p>
        </div>
      </div>

      {/* Bottom Subtle Action hint */}
      <div className="mt-5 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-zinc-600 group-hover:text-zinc-400 transition-colors">
        <span>Abrir espacio de trabajo</span>
        <span className="font-mono text-zinc-500">↵</span>
      </div>
    </div>
  );
}
