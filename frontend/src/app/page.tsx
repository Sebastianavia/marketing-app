'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { ToolCard } from '@/components/dashboard/ToolCard';
import { AvatarStudioView } from '@/components/tools/AvatarStudioView';
import { UgcGeneratorView } from '@/components/tools/UgcGeneratorView';
import { DeepSwapView } from '@/components/tools/DeepSwapView';
import { TextToVideoView } from '@/components/tools/TextToVideoView';
import { VoiceStudioView } from '@/components/tools/VoiceStudioView';
import { ImageStudioView } from '@/components/tools/ImageStudioView';
import { AvatarsView } from '@/components/tools/AvatarsView';
import { useNavStore } from '@/store/useNavStore';
import { BuzzyView } from '@/components/tools/BuzzyView';
import { PromptLibraryView } from '@/components/tools/PromptLibraryView';
import { CostsView } from '@/components/costs/CostsView';
import { ProjectsLibraryView } from '@/components/storage/ProjectsLibraryView';
import { MiaTerminal } from '@/components/mia/MiaTerminal';
import { useMiaStore } from '@/store/useMiaStore';
import { useProjectHydrationStore } from '@/store/useProjectHydrationStore';
import { PRIMARY_TOOLS, TOOLS, getToolByShortcut, normalizeToolId, type ToolId } from '@/config/tools.config';

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const setMiaActiveTool = useMiaStore((s) => s.setActiveTool);

  useEffect(() => {
    setMiaActiveTool(activeTool);
  }, [activeTool, setMiaActiveTool]);

  // Una vista puede pedir abrir otra (p. ej. Avatar → Creación de imágenes).
  useEffect(
    () =>
      useNavStore.subscribe((s) => {
        if (!s.requestedTool) return;
        setActiveTool(s.requestedTool);
        useNavStore.getState().clearRequest();
      }),
    []
  );

  // Atajos: ⌘/Ctrl + 0..9
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = getToolByShortcut(e.key);
      if (target === undefined) return;
      e.preventDefault();
      setActiveTool(target);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const tool = activeTool ? TOOLS[activeTool] : null;

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-bg text-fg">
      <TitleBar
        activeToolTitle={tool?.title}
        onNavigateHome={() => setActiveTool(null)}
        onOpenCosts={() => setActiveTool('costs')}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <DesktopSidebar activeTool={activeTool} onSelectTool={setActiveTool} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!tool && <Dashboard onOpen={setActiveTool} />}

          {/* UGC Studio es un lienzo a pantalla completa: sin encabezado ni márgenes */}
          {tool?.id === 'ugc-generator' && (
            <div key={tool.id} className="animate-view-enter h-full">
              <UgcGeneratorView onExit={() => setActiveTool(null)} />
            </div>
          )}

          {tool && tool.id !== 'ugc-generator' && (
            <div key={tool.id} className="animate-view-enter mx-auto w-full max-w-[1440px] px-4 pb-16 pt-5 sm:px-8">
              {/* Encabezado del modo enfoque */}
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <button
                    type="button"
                    onClick={() => setActiveTool(null)}
                    className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Volver al dashboard
                  </button>
                  <div className="mt-3 flex items-center gap-2.5">
                    <h1 className="text-2xl font-semibold text-fg">{tool.title}</h1>
                    {tool.preview && (
                      <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-subtle">
                        Vista previa
                      </span>
                    )}
                  </div>
                  <p className="mt-1 max-w-[60ch] text-sm text-fg-muted">{tool.description}</p>
                </div>
              </div>

              {activeTool === 'avatar-studio' && <AvatarStudioView />}
              {activeTool === 'deep-swap' && <DeepSwapView />}
              {activeTool === 'text-to-video' && <TextToVideoView />}
              {activeTool === 'voice-studio' && <VoiceStudioView />}
              {activeTool === 'image-studio' && <ImageStudioView />}
              {activeTool === 'avatars' && <AvatarsView />}
              {activeTool === 'buzzy' && <BuzzyView />}
              {activeTool === 'prompt-library' && <PromptLibraryView />}
              {activeTool === 'costs' && <CostsView />}
              {activeTool === 'projects' && (
                <ProjectsLibraryView
                  onOpenTool={(toolId, initialData) => {
                    if (initialData) {
                      useProjectHydrationStore.getState().loadProject(initialData);
                    }
                    setActiveTool(normalizeToolId(toolId));
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <MiaTerminal />
    </div>
  );
}

function Dashboard({ onOpen }: { onOpen: (id: ToolId) => void }) {
  const voice = TOOLS['voice-studio'];
  const projects = TOOLS.projects;
  const costs = TOOLS.costs;

  return (
    <div className="animate-view-enter mx-auto w-full max-w-6xl px-4 pb-20 pt-12 sm:px-8 lg:pt-16">
      <header className="max-w-2xl">
        <h1 className="text-[34px] font-semibold leading-[1.1] text-fg sm:text-[40px]">Video Marketing Studio</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
          Crea anuncios con avatares, voces clonadas y contenido UGC. Elige una herramienta para empezar.
        </p>
      </header>

      <section className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Herramientas principales">
        {PRIMARY_TOOLS.map((id) => (
          <ToolCard key={id} tool={TOOLS[id]} onSelect={onOpen} />
        ))}
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Más herramientas">
        <ToolCard tool={voice} onSelect={onOpen} size="compact" />
        <ToolCard tool={projects} onSelect={onOpen} size="compact" />
        <ToolCard tool={costs} onSelect={onOpen} size="compact" />
      </section>

      <p className="mt-10 text-[12px] text-fg-subtle">
        Atajos: <kbd className="rounded border border-line px-1">⌘1</kbd>–<kbd className="rounded border border-line px-1">⌘9</kbd>{' '}
        para cambiar de herramienta, <kbd className="rounded border border-line px-1">⌘0</kbd> para volver aquí.
      </p>
    </div>
  );
}
