'use client';

import React from 'react';

interface ShimmerLoaderProps {
  progress?: number;
  currentPhase?: string;
  subtext?: string;
}

/** Estado de procesamiento de IA: el único lugar donde el acento "se mueve". */
export function ShimmerLoader({
  progress = 45,
  currentPhase = 'Generando video…',
  subtext = 'Esto puede tardar unos minutos.',
}: ShimmerLoaderProps) {
  const pct = Math.min(100, Math.max(4, progress));

  return (
    <div
      role="status"
      aria-live="polite"
      className="surface-card relative flex h-full min-h-[420px] w-full flex-col items-center justify-center overflow-hidden p-8 text-center"
    >
      {/* Halo suave del acento */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl animate-subtle-pulse"
      />

      <div className="relative">
        <div className="mx-auto mb-6 h-14 w-14 rounded-2xl border border-line bg-surface-2 p-3">
          <div className="h-full w-full rounded-lg border-2 border-accent/25 border-t-accent animate-spin" />
        </div>

        <h4 className="text-[15px] font-medium text-fg">{currentPhase}</h4>
        <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-fg-muted">{subtext}</p>

        <div className="mx-auto mt-8 w-64">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="relative h-full overflow-hidden rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            >
              <span className="ai-progress-sheen" />
            </div>
          </div>
          <p className="mt-2 text-right text-[12px] tabular-nums text-fg-subtle">{Math.round(pct)}%</p>
        </div>
      </div>
    </div>
  );
}
