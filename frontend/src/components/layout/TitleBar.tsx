'use client';

import React, { useState, useEffect } from 'react';
import {
  Minus,
  Square,
  Copy,
  X,
  FolderGit2,
  Cpu,
  Terminal,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';

interface TitleBarProps {
  activeToolTitle?: string;
  onNavigateHome?: () => void;
  workspacePath?: string;
}

// Extend Window object for Electron / Tauri APIs
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

export function TitleBar({
  activeToolTitle,
  onNavigateHome,
  workspacePath = 'D:\\workspace\\marketing-q4',
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const toggleMia = useMiaStore((s) => s.toggleOpen);

  const showDesktopToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleMinimize = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.minimize) {
      window.electronAPI.minimize();
    } else if (typeof window !== 'undefined' && window.__TAURI__?.window?.appWindow) {
      window.__TAURI__.window.appWindow.minimize();
    } else {
      showDesktopToast('Ventana minimizada al System Tray');
    }
  };

  const handleMaximize = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.maximize) {
      window.electronAPI.maximize();
      setIsMaximized(!isMaximized);
    } else if (typeof window !== 'undefined' && window.__TAURI__?.window?.appWindow) {
      window.__TAURI__.window.appWindow.toggleMaximize();
      setIsMaximized(!isMaximized);
    } else {
      // Browser fallback: Toggle Fullscreen
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        setIsMaximized(true);
      } else {
        document.exitFullscreen().catch(() => {});
        setIsMaximized(false);
      }
    }
  };

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.close) {
      window.electronAPI.close();
    } else if (typeof window !== 'undefined' && window.__TAURI__?.window?.appWindow) {
      window.__TAURI__.window.appWindow.close();
    } else {
      showDesktopToast('Daemon local activo en segundo plano (localhost:3000)');
    }
  };

  return (
    <header className="drag-region relative flex h-9 w-full select-none items-center justify-between border-b border-white/[0.06] bg-[#070707] px-2 text-xs font-sans text-zinc-300 z-50">
      {/* Left: Window Branding & Breadcrumbs */}
      <div className="no-drag flex items-center gap-2.5 pl-1.5">
        <button
          type="button"
          onClick={onNavigateHome}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Ir al Dashboard general"
        >
          <div className="flex h-4 w-4 items-center justify-center rounded bg-white text-black font-mono text-[10px] font-bold">
            L
          </div>
          <span className="font-medium text-zinc-200 tracking-tight text-[11px]">
            Lulo Desktop
          </span>
        </button>

        <span className="text-zinc-600 text-[10px]">/</span>

        {/* Current Active Tool Breadcrumb */}
        <span className="font-mono text-[11px] text-zinc-400">
          {activeToolTitle ? activeToolTitle : 'Dashboard'}
        </span>

        {/* Local Workspace Directory Badge */}
        <button
          type="button"
          onClick={() => {
            fetch('/api/projects/open-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: workspacePath }),
            }).catch(() => {});
          }}
          className="hidden lg:flex items-center gap-1.5 ml-2 rounded border border-white/[0.06] bg-zinc-950 px-2 py-0.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-200 hover:border-white/20 transition-colors"
          title="Haz clic para abrir esta carpeta en el Explorador de Windows"
        >
          <FolderGit2 className="h-3 w-3 text-zinc-600" />
          <span className="truncate max-w-[190px]">{workspacePath}</span>
        </button>
      </div>

      {/* Center: Search / Drag Handle Area */}
      <div className="flex-1 flex justify-center items-center px-4">
        {notification ? (
          <div className="no-drag flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-0.5 font-mono text-[10px] text-indigo-300 animate-in fade-in duration-150">
            <CheckCircle2 className="h-3 w-3 text-indigo-400" />
            <span>{notification}</span>
          </div>
        ) : (
          <div className="drag-region flex items-center gap-2 text-zinc-600 text-[10px] font-mono cursor-default">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>LOCAL ENGINE ONLINE</span>
            <span className="text-zinc-700">|</span>
            <span>PORT 3000</span>
          </div>
        )}
      </div>

      {/* Right: Quick Tools & Native OS Window Controls */}
      <div className="no-drag flex items-center gap-1">
        {/* Mia Terminal Shortcut Pill */}
        <button
          type="button"
          onClick={toggleMia}
          className="flex items-center gap-1.5 rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors mr-2"
          title="Abrir CLI Local y Copilot (⌘J)"
        >
          <Terminal className="h-3 w-3" />
          <span>CLI</span>
          <kbd className="text-[9px] text-zinc-600">⌘J</kbd>
        </button>

        {/* Native OS Frameless Window Controls */}
        <div className="flex items-center">
          {/* Minimize */}
          <button
            type="button"
            onClick={handleMinimize}
            className="flex h-7 w-8 items-center justify-center text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <Minus className="h-3 w-3" />
          </button>

          {/* Maximize / Restore */}
          <button
            type="button"
            onClick={handleMaximize}
            className="flex h-7 w-8 items-center justify-center text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors"
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
            aria-label="Maximizar"
          >
            {isMaximized ? (
              <Copy className="h-3 w-3 rotate-180" />
            ) : (
              <Square className="h-2.5 w-2.5" />
            )}
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-9 items-center justify-center text-zinc-400 hover:bg-red-600 hover:text-white transition-colors"
            title="Cerrar aplicación"
            aria-label="Cerrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
