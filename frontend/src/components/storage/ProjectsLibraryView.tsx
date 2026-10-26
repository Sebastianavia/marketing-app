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
import { PROJECT_CATEGORIES, projectCategoryLabel } from '@/config/project-categories';

/** Archivos locales del proyecto se muestran con la ruta de medios de la app. */
const media = (p?: string) => (p ? `/api/projects/media?path=${encodeURIComponent(p)}` : undefined);

interface ProjectsLibraryViewProps {
  onOpenTool?: (toolId: string, initialData?: any) => void;
}

const CATEGORIES = [{ id: 'ALL', label: 'Todos' }, ...PROJECT_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

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
    // Las imágenes y las producciones no se "cargan" en una herramienta: se abren en su carpeta
    if (project.category === 'Imagenes' || project.category === 'Producciones') {
      handleOpenFolder(project.path);
      return;
    }
    // 1. Hidratar el estado del proyecto en el almacén de sesión de React
    await useProjectHydrationStore.getState().loadProject(project);

    // 2. Navegar a la herramienta correspondiente con los datos
    const toolId = PROJECT_CATEGORIES.find((c) => c.id === project.category)?.tool ?? 'avatar-studio';

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
        return 'border-accent/30 text-accent bg-accent/10';
      case 'TextToVideo':
        return 'border-accent/30 text-accent bg-accent/10';
      case 'Genjutsu':
        return 'border-amber-500/30 text-amber-400 bg-amber-500/10';
      case 'Imagenes':
        return 'border-sky-500/30 text-sky-500 bg-sky-500/10';
      case 'Producciones':
        return 'border-brand/30 text-accent bg-brand/10';
      default:
        return 'border-line-strong text-fg-muted bg-surface-2';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-line pb-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded border border-line bg-surface px-2 py-0.5 tabular-nums text-[10px] text-fg-muted shadow-2xs">
            <HardDrive className="h-3 w-3 text-fg-subtle" />
            <span>ALMACENAMIENTO LOCAL EN DISCO</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
            Biblioteca de Proyectos
          </h1>
          <p className="text-xs text-fg-muted font-normal">
            Todos tus videos, configuraciones y guiones organizados automáticamente por carpetas en tu PC.
          </p>
        </div>

        {/* Disk Path Bar with Settings & Explorer launcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 tabular-nums text-[11px] text-fg-muted hover:border-line-strong cursor-pointer transition-colors shadow-2xs"
            title="Haz clic para cambiar la carpeta del disco"
          >
            <FolderOpen className="h-3.5 w-3.5 text-fg-subtle" />
            <span className="truncate max-w-[200px] sm:max-w-[280px]">{basePath}</span>
            <Settings className="h-3 w-3 text-fg-subtle hover:text-fg" />
          </div>

          <button
            type="button"
            onClick={() => handleOpenFolder()}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs tabular-nums text-fg hover:bg-surface-2 hover:text-fg transition-colors shadow-2xs"
            title="Abrir carpeta raíz en el Explorador de Windows"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Abrir en Windows</span>
          </button>

          <button
            type="button"
            onClick={fetchProjects}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors shadow-2xs"
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
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 tabular-nums text-xs transition-colors shrink-0 ${
                  selectedCategory === cat.id
                    ? 'bg-fg text-bg font-medium border border-transparent shadow-xs'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-2/60 border border-transparent'
                }`}
              >
                <span>{cat.label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  selectedCategory === cat.id
                    ? 'bg-bg/20 text-bg'
                    : 'bg-surface-2 text-fg-muted'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o guion..."
            className="w-full rounded-lg border border-line bg-surface pl-8 pr-3 py-1.5 tabular-nums text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-line-strong shadow-2xs transition-colors"
          />
        </div>
      </div>

      {/* 3. Projects Grid View */}
      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div
              key={p.id || p.path}
              className="surface-card group rounded-xl p-4 flex flex-col justify-between space-y-4 hover:border-line-strong transition-all shadow-xs"
            >
              {/* Card Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${getCategoryBadgeClass(
                      p.category
                    )}`}
                  >
                    {projectCategoryLabel(p.category)}
                  </span>

                  <div className="flex items-center gap-1 text-[10px] tabular-nums text-fg-subtle">
                    <Calendar className="h-3 w-3" />
                    <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-fg group-hover:text-accent transition-colors truncate">
                    {p.title || p.name}
                  </h3>
                  <div className="tabular-nums text-[10px] text-fg-subtle truncate mt-0.5">
                    📁 /{p.category}/{p.name}
                  </div>
                </div>
              </div>

              {/* Video Player or Content Preview */}
              {p.videoUrl || (p.videoPath && p.mediaAvailable?.video) ? (
                <div className="relative aspect-video w-full rounded-lg bg-bg overflow-hidden border border-line">
                  <video
                    src={p.videoUrl || media(p.videoPath)}
                    controls
                    preload="metadata"
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : p.imagePaths?.length ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {p.imagePaths.slice(0, 4).map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={img} src={media(img)} alt="" loading="lazy" className="aspect-square w-full rounded-md border border-line object-cover" />
                  ))}
                </div>
              ) : p.script ? (
                <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <div className="text-[10px] tabular-nums text-fg-subtle mb-1 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>Guion guardado:</span>
                  </div>
                  <p className="text-xs text-fg-muted font-sans line-clamp-3 leading-relaxed">
                    {p.script}
                  </p>
                </div>
              ) : p.prompt ? (
                <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <div className="text-[10px] tabular-nums text-fg-subtle mb-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    <span>Prompt cinemático:</span>
                  </div>
                  <p className="text-xs text-fg-muted tabular-nums line-clamp-3 text-[11px]">
                    {p.prompt}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11px] tabular-nums text-fg-subtle">
                  Carpeta de proyecto creada en disco
                </div>
              )}

              {/* Metadata Pills */}
              <div className="flex flex-wrap gap-1.5 pt-1 text-[10px] tabular-nums text-fg-muted">
                {p.avatarName && (
                  <span className="rounded bg-surface-2 border border-line px-1.5 py-0.5">
                    Avatar: {p.avatarName}
                  </span>
                )}
                {p.ratio && (
                  <span className="rounded bg-surface-2 border border-line px-1.5 py-0.5">
                    {p.ratio}
                  </span>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="flex items-center justify-between border-t border-line pt-3 text-xs tabular-nums">
                <button
                  type="button"
                  onClick={() => handleOpenFolder(p.path)}
                  className="flex items-center gap-1 text-fg-muted hover:text-fg transition-colors"
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
                    className="text-fg-subtle hover:text-rose-500 dark:hover:text-rose-400 transition-colors p-1 cursor-pointer"
                    title="Eliminar de disco"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLoadInTool(p)}
                    className="flex items-center gap-1 rounded bg-fg text-bg px-2.5 py-1 font-semibold text-[11px] hover:bg-fg/85 transition-colors shadow-2xs cursor-pointer"
                  >
                    <span>{p.category === 'Imagenes' || p.category === 'Producciones' ? 'Abrir' : 'Cargar'}</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/70 p-12 text-center space-y-4 shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 mx-auto text-fg-muted">
            <FolderKanban className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-sm font-semibold text-fg">
              No hay proyectos en {selectedCategory === 'ALL' ? 'este disco' : projectCategoryLabel(selectedCategory)}
            </h3>
            <p className="text-xs text-fg-muted leading-relaxed font-sans">
              Cada video o imagen que termines se guarda solo aquí, en su propia carpeta con el archivo dentro.
              También puedes guardar un borrador con &ldquo;Guardar proyecto&rdquo; en Avatar Studio.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => onOpenTool?.('avatar-studio')}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs tabular-nums text-fg hover:bg-surface-2 hover:text-fg transition-colors shadow-2xs"
            >
              Ir a Avatar Studio
            </button>
            <button
              type="button"
              onClick={() => onOpenTool?.('ugc-generator')}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs tabular-nums text-fg hover:bg-surface-2 hover:text-fg transition-colors shadow-2xs"
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
