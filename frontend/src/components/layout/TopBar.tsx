'use client';

import React from 'react';

interface TopBarProps {
  onLogoClick?: () => void;
  credits?: number;
}

export function TopBar({ onLogoClick, credits = 2450 }: TopBarProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-white/[0.06] bg-white/80 dark:bg-black/80 backdrop-blur-md">
      <div className="mx-auto flex h-13 max-w-6xl items-center justify-between px-6">
        {/* Logo / Brand */}
        <div
          onClick={onLogoClick}
          className="flex cursor-pointer items-center gap-2.5 group"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-white dark:text-black font-semibold text-xs tracking-tighter transition-transform group-hover:scale-95 shadow-2xs">
            L
          </div>
          <span className="text-sm font-medium text-slate-900 dark:text-zinc-100 tracking-tight">
            Lulo <span className="text-slate-500 dark:text-zinc-500 font-normal">Studio</span>
          </span>
          <span className="hidden sm:inline-block ml-1 rounded border border-slate-200 dark:border-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:text-zinc-500 uppercase tracking-widest">
            v2.6
          </span>
        </div>

        {/* Right Section: System Status & User Info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-white/[0.06] bg-slate-100 dark:bg-zinc-950 px-2.5 py-1 text-xs text-slate-700 dark:text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span suppressHydrationWarning className="font-mono text-[11px] text-slate-700 dark:text-zinc-400">
              {credits.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} <span className="text-slate-500 dark:text-zinc-600">cr</span>
            </span>
          </div>

          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-white/[0.08] bg-slate-100 dark:bg-zinc-900 text-[11px] font-medium text-slate-700 dark:text-zinc-300 hover:border-slate-300 dark:hover:border-white/20 cursor-pointer transition-colors">
            S
          </div>
        </div>
      </div>
    </header>
  );
}
