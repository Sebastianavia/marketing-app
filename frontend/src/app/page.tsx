'use client';

import React, { useState, useEffect } from 'react';
import { TitleBar } from '@/components/layout/TitleBar';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { ToolCard, ToolCardData } from '@/components/dashboard/ToolCard';
import { AvatarStudioView } from '@/components/tools/AvatarStudioView';
import { UgcGeneratorView } from '@/components/tools/UgcGeneratorView';
import { DeepSwapView } from '@/components/tools/DeepSwapView';
import { TextToVideoView } from '@/components/tools/TextToVideoView';
import { BusiDemoView } from '@/components/tools/BusiDemoView';
import { ProjectsLibraryView } from '@/components/storage/ProjectsLibraryView';
import { MiaTerminal } from '@/components/mia/MiaTerminal';
import { useMiaStore } from '@/store/useMiaStore';
import {
  User,
  RefreshCw,
  Sparkles,
  Film,
  Bot,
  ArrowLeft,
  ArrowRight,
  HardDrive,
  Cpu,
  FolderKanban,
  FolderOpen,
} from 'lucide-react';

const TOOLS: ToolCardData[] = [
  {
    id: 'avatar-studio',
    title: 'Avatar Studio',
    category: 'HeyGen v2 Engine',
    description:
      'Video comercial con presentadores y avatares fotorrealistas. Sincronización labial neuronal a partir de texto o retrato estático.',
    badge: 'HeyGen',
    icon: User,
  },
  {
    id: 'deep-swap',
    title: 'Genjutsu (Clonación & Swap)',
    category: 'Genjutsu AI Engine',
    description:
      'Sustitución y clonación de rostros en videos existentes mediante un único retrato frontal. Modo demostración para próximas fases.',
    badge: 'Demo',
    isDemo: true,
    icon: RefreshCw,
  },
  {
    id: 'ugc-generator',
    title: 'Generador UGC',
    category: 'Pipeline Autónomo',
    description:
      'Pipeline de anuncios para redes: OpenRouter estructura el guion persuasivo y HeyGen renderiza la pieza vertical 9:16.',
    badge: 'Multi-API',
    icon: Sparkles,
  },
  {
    id: 'text-to-video',
    title: 'Text-to-Video Scripts',
    category: 'Prompt Engine',
    description:
      'Transforma ideas de marketing en tomas cinematográficas con física de movimiento y gradación de color profesional.',
    badge: 'VEO / Sora',
    icon: Film,
  },
];

export default function Home() {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const setMiaActiveTool = useMiaStore((s) => s.setActiveTool);

  useEffect(() => {
    setMiaActiveTool(activeTool);
  }, [activeTool, setMiaActiveTool]);

  // Atajos de teclado nativos para navegación instantánea en memoria (Cmd/Ctrl + 0..6)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '0') {
          e.preventDefault();
          setActiveTool(null);
        } else if (e.key === '1') {
          e.preventDefault();
          setActiveTool('avatar-studio');
        } else if (e.key === '2') {
          e.preventDefault();
          setActiveTool('deep-swap');
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveTool('ugc-generator');
        } else if (e.key === '4') {
          e.preventDefault();
          setActiveTool('text-to-video');
        } else if (e.key === '5') {
          e.preventDefault();
          setActiveTool('busi');
        } else if (e.key === '6') {
          e.preventDefault();
          setActiveTool('projects');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getToolTitle = () => {
    switch (activeTool) {
      case 'avatar-studio':
        return 'Avatar Studio';
      case 'deep-swap':
        return 'Genjutsu Swap';
      case 'ugc-generator':
        return 'Generador UGC';
      case 'text-to-video':
        return 'Text-to-Video';
      case 'busi':
        return 'Busi AI';
      case 'projects':
        return 'Proyectos en Disco';
      default:
        return 'Dashboard';
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-zinc-100 flex flex-col font-sans select-none">
      {/* 1. Custom Frameless TitleBar (Desktop OS Controls & Drag Region) */}
      <TitleBar
        activeToolTitle={getToolTitle()}
        onNavigateHome={() => setActiveTool(null)}
        workspacePath="D:\LuloStudio_Projects"
      />

      {/* 2. Desktop Body: Activity Bar + Native Workspace Canvas */}
      <div className="flex flex-1 w-full h-[calc(100vh-36px)] overflow-hidden">
        {/* Left Native Activity Bar */}
        <DesktopSidebar
          activeTool={activeTool}
          onSelectTool={(toolId) => setActiveTool(toolId)}
        />

        {/* Center/Right Workspace Canvas with Independent High-Performance Scroll */}
        <main className="flex-1 h-full overflow-y-auto desktop-scroll bg-[#050505] p-6 lg:p-10">
          <div className="mx-auto max-w-6xl w-full">
            {/* ========================================================================= */}
            {/* DASHBOARD PRINCIPAL                                                       */}
            {/* ========================================================================= */}
            {!activeTool && (
              <div className="space-y-10 animate-in fade-in duration-150">
                {/* Desktop Studio Header */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.06] pb-6">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded border border-white/[0.08] bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>LOCAL RUNTIME · DESKTOP INTERNAL SUITE</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
                      Marketing Creative Studio
                    </h1>
                    <p className="text-xs text-zinc-400 font-normal">
                      Orquestación de motores generativos audiovisuales y almacenamiento directo en tu PC.
                    </p>
                  </div>

                  {/* Local Hardware Status Chips */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTool('projects')}
                      className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-zinc-900 hover:border-white/25 px-2.5 py-1 text-[11px] font-mono text-zinc-200 transition-colors"
                      title="Ver todos los proyectos guardados en tu disco duro (⌘6)"
                    >
                      <FolderKanban className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Mis Proyectos (⌘6)</span>
                    </button>
                    <div className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-400">
                      <HardDrive className="h-3 w-3 text-zinc-500" />
                      <span>Disco Local</span>
                    </div>
                  </div>
                </div>

                {/* 2x2 Modular Tool Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {TOOLS.map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      onSelect={(id) => setActiveTool(id)}
                    />
                  ))}
                </div>

                {/* Local Projects Banner Card */}
                <div
                  onClick={() => setActiveTool('projects')}
                  className="surface-card group rounded-xl p-5 cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-indigo-500/20 bg-gradient-to-r from-zinc-950 via-zinc-900 to-indigo-950/20"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 group-hover:text-white transition-colors">
                      <FolderOpen className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">
                          Biblioteca de Proyectos en Disco
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider border border-emerald-500/30 text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.2">
                          Auto-Organizado
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Explora todos los videos generados, guiones y configuraciones guardados en subcarpetas jerárquicas en tu PC.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0">
                    <span>Abrir biblioteca (⌘6)</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>

                {/* Busi Spotlight Card */}
                <div
                  onClick={() => setActiveTool('busi')}
                  className="surface-card group rounded-xl p-5 cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-900/60 text-zinc-300 group-hover:text-white transition-colors">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-zinc-200 group-hover:text-white transition-colors">
                          Módulo Busi — Auditor Autónomo de Campañas
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider border border-white/[0.08] text-zinc-500 rounded px-1.5 py-0.2">
                          Demo
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        Detección de fatiga de creativos y auto-generación de variantes ganadoras para Meta y TikTok.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0">
                    <span>Lanzar workspace</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* FOCUS MODE (TOOL WORKSPACE VIEW / PROJECTS VIEW)                           */}
            {/* ========================================================================= */}
            {activeTool && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Tool Header Navigation */}
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                  <button
                    type="button"
                    onClick={() => setActiveTool(null)}
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Volver a Overview (⌘0)</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200">
                      {getToolTitle()}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600 border border-white/[0.08] px-1.5 py-0.5 rounded">
                      DESKTOP_WORKSPACE
                    </span>
                  </div>
                </div>

                {/* Tool Workspaces */}
                <div className="w-full">
                  {activeTool === 'avatar-studio' && <AvatarStudioView />}
                  {activeTool === 'ugc-generator' && <UgcGeneratorView />}
                  {activeTool === 'deep-swap' && <DeepSwapView />}
                  {activeTool === 'text-to-video' && <TextToVideoView />}
                  {activeTool === 'busi' && (
                    <BusiDemoView onBack={() => setActiveTool(null)} />
                  )}
                  {activeTool === 'projects' && (
                    <ProjectsLibraryView
                      onOpenTool={(toolId) => setActiveTool(toolId)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 3. Omnipresent Desktop CLI & AI Copilot (Mia) */}
      <MiaTerminal />
    </div>
  );
}
