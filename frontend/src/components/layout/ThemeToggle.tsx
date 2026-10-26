'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '@/store/useThemeStore';

const noopSubscribe = () => () => {};

// Colores de fondo de cada tema (deben coincidir con --bg en globals.css)
const THEME_BG = { dark: '#0a0a0b', light: '#f5f5f2' } as const;

// Momentos de la animación de la mancha (ms)
const SWITCH_AT = 660;
const CLEANUP_AT = 1180;

interface Stain {
  key: number;
  color: string;
  x: number;
  y: number;
  size: number;
}

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const initTheme = useThemeStore((s) => s.initTheme);
  // true en el cliente, false durante SSR (evita desajustes de hidratación)
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [stain, setStain] = useState<Stain | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const isDark = mounted ? theme === 'dark' : true;
  const label = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';

  // El cambio de tema es el mismo de siempre (toggleTheme); la mancha solo lo
  // tapa mientras ocurre.
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (stain) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      toggleTheme();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || rect.left + rect.width / 2;
    const y = e.clientY || rect.top + rect.height / 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
    const next = isDark ? 'light' : 'dark';

    setStain({ key: Date.now(), color: THEME_BG[next], x, y, size: Math.ceil(far * 2 * 1.3) });
    timers.current.push(
      window.setTimeout(() => toggleTheme(), SWITCH_AT),
      window.setTimeout(() => setStain(null), CLEANUP_AT)
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-line-strong bg-surface-2 text-fg transition-colors hover:border-accent active:scale-95 ${className}`}
        title={label}
        aria-label={label}
      >
        <Sun
          className={`absolute h-4 w-4 transition-all duration-300 ${
            isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-300 ${
            isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
          }`}
        />
      </button>

      {stain &&
        createPortal(
          <div key={stain.key} aria-hidden>
            {/* Dos manchas pequeñas que se unen a la principal */}
            <span
              className="theme-lobe"
              style={{
                left: stain.x - stain.size * 0.16 - (stain.size * 0.22) / 2,
                top: stain.y + stain.size * 0.06 - (stain.size * 0.22) / 2,
                width: stain.size * 0.22,
                height: stain.size * 0.22,
                background: stain.color,
                animationDelay: '40ms',
              }}
            />
            <span
              className="theme-lobe"
              style={{
                left: stain.x - stain.size * 0.04 - (stain.size * 0.14) / 2,
                top: stain.y + stain.size * 0.15 - (stain.size * 0.14) / 2,
                width: stain.size * 0.14,
                height: stain.size * 0.14,
                background: stain.color,
                animationDelay: '110ms',
              }}
            />
            <span
              className="theme-blob"
              style={{
                left: stain.x - stain.size / 2,
                top: stain.y - stain.size / 2,
                width: stain.size,
                height: stain.size,
                background: stain.color,
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}
