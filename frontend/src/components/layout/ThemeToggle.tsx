'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '@/store/useThemeStore';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const initTheme = useThemeStore((s) => s.initTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    initTheme();
    setMounted(true);
  }, [initTheme]);

  // Evitar desajuste de renderizado inicial en SSR
  const isDark = mounted ? theme === 'dark' : true;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`group relative flex h-7 items-center gap-1.5 rounded-md border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-zinc-900/70 px-2 py-0.5 text-slate-700 dark:text-zinc-300 shadow-sm transition-all hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 active:scale-95 ${className}`}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
    >
      <div className="relative flex h-3.5 w-3.5 items-center justify-center">
        {/* Sol para modo claro */}
        <Sun
          className={`h-3.5 w-3.5 text-amber-500 transition-all duration-300 ${
            isDark
              ? 'scale-0 rotate-90 opacity-0 absolute'
              : 'scale-100 rotate-0 opacity-100'
          }`}
        />
        {/* Luna para modo oscuro */}
        <Moon
          className={`h-3.5 w-3.5 text-indigo-400 transition-all duration-300 ${
            isDark
              ? 'scale-100 rotate-0 opacity-100'
              : 'scale-0 -rotate-90 opacity-0 absolute'
          }`}
        />
      </div>

      <span className="font-mono text-[10px] tracking-tight text-slate-600 dark:text-zinc-400 group-hover:text-slate-900 dark:group-hover:text-zinc-200 hidden sm:inline">
        {isDark ? 'Oscuro' : 'Claro'}
      </span>
    </button>
  );
}
