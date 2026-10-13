'use client';

import React from 'react';
import { HOME_ICON, NAV_ORDER, TOOLS, type ToolId } from '@/config/tools.config';

interface DesktopSidebarProps {
  activeTool: ToolId | null;
  onSelectTool: (toolId: ToolId | null) => void;
}

interface NavButtonProps {
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  preview?: boolean;
  onClick: () => void;
}

function NavButton({ label, shortcut, icon: Icon, active, preview, onClick }: NavButtonProps) {
  return (
    <div className="group relative flex w-full justify-center">
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" aria-hidden />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
          active ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:bg-surface-2/70 hover:text-fg'
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
        {preview && (
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-fg-subtle/60" aria-hidden />
        )}
      </button>

      <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-fg shadow-[var(--shadow-lift)] group-hover:flex">
        <span>{label}</span>
        {preview && <span className="text-fg-subtle">· vista previa</span>}
        <kbd className="rounded border border-line px-1 text-[10px] text-fg-subtle">⌘{shortcut}</kbd>
      </div>
    </div>
  );
}

export function DesktopSidebar({ activeTool, onSelectTool }: DesktopSidebarProps) {
  const projects = TOOLS.projects;
  const costs = TOOLS.costs;

  return (
    <aside className="no-drag z-30 hidden h-full w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-bg py-3 sm:flex">
      <nav className="flex w-full flex-col items-center gap-1" aria-label="Herramientas">
        <NavButton
          label="Inicio"
          shortcut="0"
          icon={HOME_ICON}
          active={activeTool === null}
          onClick={() => onSelectTool(null)}
        />
        <div className="my-2 h-px w-6 bg-line" />
        {NAV_ORDER.map((id) => {
          const tool = TOOLS[id];
          return (
            <NavButton
              key={id}
              label={tool.title}
              shortcut={tool.shortcut}
              icon={tool.icon}
              preview={tool.preview}
              active={activeTool === id}
              onClick={() => onSelectTool(id)}
            />
          );
        })}
      </nav>

      <div className="flex w-full flex-col items-center gap-1">
        <NavButton
          label={projects.title}
          shortcut={projects.shortcut}
          icon={projects.icon}
          active={activeTool === 'projects'}
          onClick={() => onSelectTool('projects')}
        />
        <NavButton
          label={costs.title}
          shortcut={costs.shortcut}
          icon={costs.icon}
          active={activeTool === 'costs'}
          onClick={() => onSelectTool('costs')}
        />
      </div>
    </aside>
  );
}
