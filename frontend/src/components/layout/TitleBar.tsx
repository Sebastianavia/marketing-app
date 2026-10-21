'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { Minus, Square, Copy, X, Sparkles } from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CloudinaryCleanWidget } from '@/components/storage/CloudinaryCleanWidget';
import { TodaySpend } from '@/components/layout/TodaySpend';
import { OrchestratorPicker } from '@/components/layout/OrchestratorPicker';
import { VideoCatalogAlert } from '@/components/layout/VideoCatalogAlert';

interface TitleBarProps {
  activeToolTitle?: string;
  onNavigateHome?: () => void;
  onOpenCosts?: () => void;
}

// APIs de ventana nativa (Electron / Tauri), si la app corre empaquetada
declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
    __TAURI__?: {
      window: {
        appWindow: {
          minimize: () => Promise<void>;
          toggleMaximize: () => Promise<void>;
          close: () => Promise<void>;
          isMaximized: () => Promise<boolean>;
        };
      };
    };
  }
}

const noopSubscribe = () => () => {};

function hasNativeWindow() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.electronAPI || window.__TAURI__?.window?.appWindow)
  );
}

export function TitleBar({ activeToolTitle, onNavigateHome, onOpenCosts }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const toggleMia = useMiaStore((s) => s.toggleOpen);
  const isMiaOpen = useMiaStore((s) => s.isOpen);
  const native = useSyncExternalStore(noopSubscribe, hasNativeWindow, () => false);

  const handleMinimize = () => {
    if (window.electronAPI?.minimize) window.electronAPI.minimize();
    else window.__TAURI__?.window.appWindow.minimize();
  };

  const handleMaximize = () => {
    if (window.electronAPI?.maximize) window.electronAPI.maximize();
    else window.__TAURI__?.window.appWindow.toggleMaximize();
    setIsMaximized((v) => !v);
  };

  const handleClose = () => {
    if (window.electronAPI?.close) window.electronAPI.close();
    else window.__TAURI__?.window.appWindow.close();
  };

  return (
    <header className="drag-region relative z-40 flex h-[52px] w-full shrink-0 select-none items-center justify-between border-b border-line bg-bg/80 px-3 backdrop-blur-xl">
      {/* Marca + ubicación */}
      <div className="no-drag flex min-w-0 items-center gap-2 pl-1">
        <button
          type="button"
          onClick={onNavigateHome}
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-opacity hover:opacity-75"
          aria-label="Ir al inicio"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand font-display text-[14px] font-black text-brand-fg">
            L
          </span>
          <span className="font-display text-[14px] font-extrabold uppercase tracking-[-0.01em] text-fg" style={{ fontStretch: '118%' }}>
            Lulo Studio
          </span>
        </button>

        {activeToolTitle && (
          <>
            <span className="text-fg-subtle/60" aria-hidden>
              /
            </span>
            <span className="truncate text-[13px] text-fg-muted">{activeToolTitle}</span>
          </>
        )}
      </div>

      {/* Acciones */}
      <div className="no-drag flex items-center gap-1.5">
        <VideoCatalogAlert />
        <OrchestratorPicker />
        <TodaySpend onClick={onOpenCosts} />
        <CloudinaryCleanWidget />

        <button
          type="button"
          onClick={toggleMia}
          aria-pressed={isMiaOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
            isMiaOpen
              ? 'bg-surface-2 text-fg'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
          title="Asistente Mia (⌘J)"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Asistente</span>
          <kbd className="hidden rounded border border-line px-1 text-[10px] font-medium text-fg-subtle md:inline">
            ⌘J
          </kbd>
        </button>

        <ThemeToggle />

        {native && (
          <div className="ml-1 flex items-center border-l border-line pl-1">
            <button
              type="button"
              onClick={handleMinimize}
              className="flex h-8 w-9 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label="Minimizar"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleMaximize}
              className="flex h-8 w-9 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
            >
              {isMaximized ? <Copy className="h-3 w-3 rotate-180" /> : <Square className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-8 w-9 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-red-600 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
