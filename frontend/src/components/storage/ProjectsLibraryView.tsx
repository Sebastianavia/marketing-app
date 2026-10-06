'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderKanban,
  FolderOpen,
  Search,
  HardDrive,
  RefreshCw,
  Trash2,
  Play,
  FileText,
  ExternalLink,
  Sliders,
  Calendar,
  Layers,
  ArrowRight,
  Settings,
  Sparkles,
} from 'lucide-react';
import { StorageConfigModal } from './StorageConfigModal';
import { ProjectMetadata } from '@/lib/storage/project-storage';
import { useProjectHydrationStore } from '@/store/useProjectHydrationStore';

interface ProjectsLibraryViewProps {
  onOpenTool?: (toolId: string, initialData?: any) => void;
}

const CATEGORIES = [
  { id: 'ALL', label: 'Todos' },
  { id: 'HeyGen', label: 'HeyGen (Avatar)' },
  { id: 'UGC', label: 'UGC Generator' },
  { id: 'TextToVideo', label: 'Text-to-Video' },
  { id: 'Genjutsu', label: 'Genjutsu' },
];

export function ProjectsLibraryView({ onOpenTool }: ProjectsLibraryViewProps) {
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [basePath, setBasePath] = useState('D:\\LuloStudio_Projects');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const [projRes, pathRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/settings/storage'),
      ]);

      const projData = await projRes.json();
      const pathData = await pathRes.json();

      if (projData.projects) {
        setProjects(projData.projects);
      }
      if (pathData.basePath) {
        setBasePath(pathData.basePath);
      }
    } catch (err) {
      console.error('Error al cargar proyectos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleOpenFolder = async (folderPath?: string) => {
    try {
      await fetch('/api/projects/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath || basePath }),
      });
    } catch (err) {
      console.error('Error al abrir carpeta:', err);
    }
  };

  const handleDelete = async (category: string, name: string) => {
    if (!confirm(`¿Eliminar la carpeta y archivos del proyecto "${name}" de tu disco?`)) {
      return;
    }

    setDeletingName(name);
    try {
      const res = await fetch(`/api/projects?category=${category}&name=${name}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => !(p.category === category && p.name === name)));
      }
    } catch (err) {
      console.error('Error al eliminar:', err);
    } finally {
      setDeletingName(null);
    }
  };

  const handleLoadInTool = async (project: ProjectMetadata) => {
    // 1. Hidratar el estado del proyecto en el almacén de sesión de React
    await useProjectHydrationStore.getState().loadProject(project);

    // 2. Navegar a la herramienta correspondiente con los datos
    let toolId = 'avatar-studio';
    if (project.category === 'HeyGen') toolId = 'avatar-studio';
    else if (project.category === 'UGC') toolId = 'ugc-generator';
    else if (project.category === 'TextToVideo') toolId = 'text-to-video';
    else if (project.category === 'Genjutsu') toolId = 'deep-swap';

    onOpenTool?.(toolId, project);
  };

  const filteredProjects = projects.filter((p) => {
    const matchesCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.script?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.prompt?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'HeyGen':
        return 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';
      case 'UGC':
        return 'border-purple-500/30 text-purple-400 bg-purple-500/10';
      case 'TextToVideo':
        return 'border-blue-500/30 text-blue-400 bg-blue-500/10';
      case 'Genjutsu':
        return 'border-amber-500/30 text-amber-400 bg-amber-500/10';
      default:
        return 'border-white/10 text-zinc-400 bg-zinc-900';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.06] pb-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded border border-white/[0.08] bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
            <HardDrive className="h-3 w-3 text-zinc-500" />
            <span>ALMACENAMIENTO LOCAL EN DISCO</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
            Biblioteca de Proyectos
          </h1>
          <p className="text-xs text-zinc-400 font-normal">
            Todos tus videos, configuraciones y guiones organizados automáticamente por carpetas en tu PC.
          </p>
        </div>

        {/* Disk Path Bar with Settings & Explorer launcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-950 px-3 py-1.5 font-mono text-[11px] text-zinc-300 hover:border-white/20 cursor-pointer transition-colors"
            title="Haz clic para cambiar la carpeta del disco"
          >
            <FolderOpen className="h-3.5 w-3.5 text-zinc-500" />
            <span className="truncate max-w-[200px] sm:max-w-[280px]">{basePath}</span>
            <Settings className="h-3 w-3 text-zinc-600 hover:text-zinc-300" />
          </div>

          <button
            type="button"
            onClick={() => handleOpenFolder()}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
            title="Abrir carpeta raíz en el Explorador de Windows"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Abrir en Windows</span>
          </button>

          <button
            type="button"
            onClick={fetchProjects}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
            title="Actualizar lista de proyectos"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Filters & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((cat) => {
            const count =
              cat.id === 'ALL'
                ? projects.length
                : projects.filter((p) => p.category === cat.id).length;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition-colors shrink-0 ${
                  selectedCategory === cat.id
                    ? 'bg-zinc-800 text-white font-medium border border-white/20'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                }`}
              >
                <span>{cat.label}</span>
                <span className="rounded-full bg-zinc-900 px-1.5 py-0.2 text-[10px] text-zinc-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o guion..."
            className="w-full rounded-lg border border-white/[0.08] bg-black pl-8 pr-3 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/25"
          />
        </div>
      </div>

      {/* 3. Projects Grid View */}
      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div
              key={p.id || p.path}
              className="surface-card group rounded-xl p-4 flex flex-col justify-between space-y-4 hover:border-white/20 transition-all"
            >
              {/* Card Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${getCategoryBadgeClass(
                      p.category
                    )}`}
                  >
                    {p.category}
                  </span>

                  <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                    <Calendar className="h-3 w-3" />
                    <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors truncate">
                    {p.title || p.name}
                  </h3>
                  <div className="font-mono text-[10px] text-zinc-500 truncate mt-0.5">
                    📁 /{p.category}/{p.name}
                  </div>
                </div>
              </div>

              {/* Video Player or Content Preview */}
              {p.videoUrl ? (
                <div className="relative aspect-video w-full rounded-lg bg-black overflow-hidden border border-white/[0.06]">
                  <video
                    src={p.videoUrl}
                    controls
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : p.script ? (
                <div className="rounded-lg border border-white/[0.04] bg-black/60 p-2.5">
                  <div className="text-[10px] font-mono text-zinc-500 mb-1 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>Guion guardado:</span>
                  </div>
                  <p className="text-xs text-zinc-300 font-sans line-clamp-3 leading-relaxed">
                    {p.script}
                  </p>
                </div>
              ) : p.prompt ? (
                <div className="rounded-lg border border-white/[0.04] bg-black/60 p-2.5">
                  <div className="text-[10px] font-mono text-zinc-500 mb-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    <span>Prompt cinemático:</span>
                  </div>
                  <p className="text-xs text-zinc-300 font-mono line-clamp-3 text-[11px]">
                    {p.prompt}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/[0.06] p-4 text-center text-[11px] font-mono text-zinc-600">
                  Carpeta de proyecto creada en disco
                </div>
              )}

              {/* Metadata Pills */}
              <div className="flex flex-wrap gap-1.5 pt-1 text-[10px] font-mono text-zinc-400">
                {p.avatarName && (
                  <span className="rounded bg-zinc-900 border border-white/[0.06] px-1.5 py-0.5">
                    Avatar: {p.avatarName}
                  </span>
                )}
                {p.ratio && (
                  <span className="rounded bg-zinc-900 border border-white/[0.06] px-1.5 py-0.5">
                    {p.ratio}
                  </span>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => handleOpenFolder(p.path)}
                  className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
                  title="Abrir carpeta exacta en Explorador de Windows"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Ver en Disco</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(p.category, p.name)}
                    disabled={deletingName === p.name}
                    className="text-zinc-600 hover:text-rose-400 transition-colors p-1"
                    title="Eliminar de disco"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLoadInTool(p)}
                    className="flex items-center gap-1 rounded bg-white text-black px-2.5 py-1 font-semibold text-[11px] hover:bg-zinc-200 transition-colors"
                  >
                    <span>Cargar</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="rounded-2xl border border-dashed border-white/[0.1] bg-zinc-950/40 p-12 text-center space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 mx-auto text-zinc-400">
            <FolderKanban className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-sm font-semibold text-zinc-200">
              No hay proyectos en {selectedCategory === 'ALL' ? 'este disco' : selectedCategory}
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed font-sans">
              Cuando creas un video en Avatar Studio o Generador UGC, asígnale un nombre y presiona
              &ldquo;Guardar Proyecto en Disco&rdquo;. Se creará automáticamente su carpeta y configuración en tu disco duro.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => onOpenTool?.('avatar-studio')}
              className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Ir a Avatar Studio
            </button>
            <button
              type="button"
              onClick={() => onOpenTool?.('ugc-generator')}
              className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Ir a Generador UGC
            </button>
          </div>
        </div>
      )}

      {/* Storage Configuration Modal */}
      <StorageConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onStorageChanged={(newPath) => {
          setBasePath(newPath);
          fetchProjects();
        }}
      />
    </div>
  );
}
