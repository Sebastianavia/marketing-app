'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

interface ShimmerLoaderProps {
  progress?: number;
  currentPhase?: string;
  subtext?: string;
}

export function ShimmerLoader({
  progress = 45,
  currentPhase = 'Sintetizando video...',
  subtext = 'Procesando movimiento labial y fotogramas en HeyGen',
}: ShimmerLoaderProps) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full min-h-[380px] w-full rounded-xl border border-white/[0.08] bg-[#070707] p-8 text-center overflow-hidden">
      {/* Precision Ticker */}
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          Procesando Tarea IA
        </span>
      </div>

      {/* Main phase title */}
      <h4 className="text-sm font-medium text-zinc-100 tracking-tight max-w-sm">
        {currentPhase}
      </h4>
      <p className="mt-1 text-xs text-zinc-500 max-w-xs leading-relaxed">
        {subtext}
      </p>

      {/* Minimalist Micro-Progress Bar */}
      <div className="mt-7 w-full max-w-[260px] space-y-2">
        <div className="h-[2px] w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-zinc-200 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(5, progress))}%` }}
          />
        </div>
        <div className="flex justify-between items-center font-mono text-[10px] text-zinc-600">
          <span>PIPELINE_ACTIVE</span>
          <span className="text-zinc-300 font-medium">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}
