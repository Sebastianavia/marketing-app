'use client';

import React from 'react';
import {
  LayoutGrid,
  User,
  RefreshCw,
  Sparkles,
  Film,
  Bot,
  Terminal,
  HardDrive,
  Cpu,
  FolderKanban,
  Mic,
} from 'lucide-react';
import { useMiaStore } from '@/store/useMiaStore';

interface DesktopSidebarProps {
  activeTool: string | null;
  onSelectTool: (toolId: string | null) => void;
}

interface NavItem {
  id: string | null;
  name: string;
  shortKey: string;
  icon: React.ComponentType<{ className?: string }>;
  isDemo?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: null,
    name: 'Dashboard Overview',
    shortKey: '⌘0',
    icon: LayoutGrid,
  },
  {
    id: 'avatar-studio',
    name: 'Avatar Studio (HeyGen)',
    shortKey: '⌘1',
    icon: User,
  },
  {
    id: 'deep-swap',
    name: 'Genjutsu (Swap Facial)',
    shortKey: '⌘2',
    icon: RefreshCw,
    isDemo: true,
  },
  {
    id: 'ugc-generator',
    name: 'Generador UGC',
    shortKey: '⌘3',
    icon: Sparkles,
  },
  {
    id: 'text-to-video',
    name: 'Text-to-Video',
    shortKey: '⌘4',
    icon: Film,
  },
  {
    id: 'voice-studio',
    name: 'Voice Studio (ElevenLabs)',
    shortKey: '⌘5',
    icon: Mic,
  },
  {
    id: 'busi',
    name: 'Busi AI Auditor',
    shortKey: '⌘6',
    icon: Bot,
    isDemo: true,
  },
  {
    id: 'projects',
    name: 'Proyectos en Disco',
    shortKey: '⌘7',
    icon: FolderKanban,
  },
];

export function DesktopSidebar({
  activeTool,
  onSelectTool,
}: DesktopSidebarProps) {
  const toggleMia = useMiaStore((s) => s.toggleOpen);
  const isMiaOpen = useMiaStore((s) => s.isOpen);

  return (
    <aside className="no-drag flex h-full w-14 shrink-0 flex-col items-center justify-between border-r border-white/[0.06] bg-[#080808] py-3.5 select-none z-30">
      {/* Top Section: Navigation Icons */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTool === item.id;

          return (
            <div key={item.name} className="relative group w-full flex justify-center">
              {/* Active Indicator Line */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 bg-white rounded-r" />
              )}

              <button
                type="button"
                onClick={() => onSelectTool(item.id)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
                title={`${item.name} (${item.shortKey})`}
              >
                <Icon className="h-4 w-4" />

                {item.isDemo && (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-500/70" />
                )}
              </button>

              {/* Tooltip on Hover */}
              <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 ml-2 hidden group-hover:flex items-center gap-2 rounded-md border border-white/[0.08] bg-zinc-950 px-2.5 py-1 text-[11px] font-sans text-zinc-200 shadow-xl whitespace-nowrap z-50">
                <span>{item.name}</span>
                <kbd className="font-mono text-[9px] text-zinc-500 bg-zinc-900 border border-white/[0.06] px-1 rounded">
                  {item.shortKey}
                </kbd>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Section: System Status & Copilot Toggle */}
      <div className="flex flex-col items-center gap-2 w-full pt-3 border-t border-white/[0.04]">
        {/* Local NVMe / Storage Status */}
        <div className="relative group flex justify-center w-full">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
            title="Almacenamiento local"
          >
            <HardDrive className="h-3.5 w-3.5" />
          </button>
          <div className="pointer-events-none absolute left-14 bottom-2 ml-2 hidden group-hover:block rounded-md border border-white/[0.08] bg-zinc-950 p-2 text-[10px] font-mono text-zinc-400 shadow-xl whitespace-nowrap z-50">
            <div className="text-zinc-200 font-semibold mb-0.5">NVMe Local Cache</div>
            <div>34.2 GB / 512 GB (6.6%)</div>
            <div className="text-emerald-400 mt-1">● Read/Write: 3,200 MB/s</div>
          </div>
        </div>

        {/* Mia Copilot Launcher */}
        <div className="relative group flex justify-center w-full">
          <button
            type="button"
            onClick={toggleMia}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              isMiaOpen
                ? 'bg-white text-black font-bold'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
            }`}
            title="Asistente Copilot / Local CLI (⌘J)"
          >
            <Terminal className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute left-14 bottom-2 ml-2 hidden group-hover:flex items-center gap-2 rounded-md border border-white/[0.08] bg-zinc-950 px-2.5 py-1 text-[11px] font-sans text-zinc-200 shadow-xl whitespace-nowrap z-50">
            <span>Asistente Local CLI</span>
            <kbd className="font-mono text-[9px] text-zinc-500 bg-zinc-900 border border-white/[0.06] px-1 rounded">
              ⌘J
            </kbd>
          </div>
        </div>
      </div>
    </aside>
  );
}
