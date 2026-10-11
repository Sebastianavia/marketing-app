'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderPlus,
  Save,
  Check,
  AlertTriangle,
  FolderOpen,
  CheckCircle2,
  Download,
  Receipt,
  Coins,
} from 'lucide-react';
import { sanitizeProjectName } from '@/lib/storage/project-storage';

export interface SaveProjectData {
  id?: string;
  title?: string;
  script?: string;
  prompt?: string;
  // Imagen / Retrato
  imageUrl?: string;
  imagePath?: string;
  avatarId?: string;
  avatarName?: string;
  imageFile?: File | null;
  // Configuración de Audio
  audioMode?: 'generar' | 'local';
  voiceId?: string;
  audioUrl?: string;
  audioPath?: string;
  audioName?: string;
  audioFile?: File | null;
  // Video
  ratio?: string;
  videoUrl?: string;
  videoPath?: string;
  ugcFramework?: any;
  tags?: string[];
  status?: 'draft' | 'rendered' | 'failed';
  // Facturación y Recibo de Consumo Final
  finalCostUSD?: number;
  videoDurationReal?: number;
  estimatedCostUSD?: number;
  modelUsed?: string;
  costPerSecondVerified?: number;
}

interface SaveProjectWidgetProps {
  category: 'HeyGen' | 'UGC' | 'TextToVideo' | 'Genjutsu';
  projectData: SaveProjectData;
  onSaved?: (project: any) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SaveProjectWidget({
  category,
  projectData,
  onSaved,
}: SaveProjectWidgetProps) {
  const [projectName, setProjectName] = useState(projectData.title || '');
  const [isChecking, setIsChecking] = useState(false);
  const [nameExists, setNameExists] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sincronizar nombre cuando cambia el proyecto hidratado
  useEffect(() => {
    if (projectData.title && (!projectName || projectName.startsWith('TalkingPhoto_'))) {
      setProjectName(projectData.title);
    }
  }, [projectData.title]);

  // Debounce check against disk
  useEffect(() => {
    const safe = projectName.trim();
    if (!safe) {
      setNameExists(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await fetch(
          `/api/projects/check-name?category=${category}&name=${encodeURIComponent(safe)}`
        );
        const data = await res.json();
        setNameExists(data.exists);
      } catch (err) {
        console.error('Error al verificar nombre:', err);
      } finally {
        setIsChecking(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [projectName, category]);

  const handleSave = async (overwrite = false) => {
    if (!projectName.trim() || (nameExists && !overwrite)) return;

    setIsSaving(true);
    setError(null);
    try {
      // Convertir imagen y audio a base64 si existen archivos en memoria para escribirlos en disco
      let imageFileBase64: string | undefined = undefined;
      if (projectData.imageFile) {
        try {
          imageFileBase64 = await fileToBase64(projectData.imageFile);
        } catch (e) {
          console.warn('No se pudo convertir imagen a base64:', e);
        }
      }

      let audioFileBase64: string | undefined = undefined;
      if (projectData.audioFile) {
        try {
          audioFileBase64 = await fileToBase64(projectData.audioFile);
        } catch (e) {
          console.warn('No se pudo convertir audio a base64:', e);
        }
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          name: projectName,
          data: {
            ...projectData,
            title: projectName,
            imageFileBase64,
            imageFileName: projectData.imageFile?.name,
            audioFileBase64,
            audioFileName: projectData.audioFile?.name,
          },
          overwrite,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar el proyecto');
      }

      setSavedPath(data.project.path);
      onSaved?.(data.project);
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenFolder = async () => {
    if (!savedPath) return;
    try {
      await fetch('/api/projects/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: savedPath }),
      });
    } catch (err) {
      console.error('Error al abrir carpeta:', err);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3.5 shadow-sm transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderPlus className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-fg">
            Guardar Proyecto en Carpeta Local ({category})
          </span>
        </div>

        <span className="text-xs text-fg-muted font-medium">
          Auto-Organizado en Disco
        </span>
      </div>

      {/* Recibo de Renderizado y Acción de Descarga Directa */}
      {projectData.videoUrl && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
          {/* Badge de Recibo Minimalista */}
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs tabular-nums font-medium border ${
                projectData.finalCostUSD !== undefined &&
                projectData.estimatedCostUSD !== undefined &&
                projectData.finalCostUSD > projectData.estimatedCostUSD
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-300'
                  : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <Receipt className="h-3.5 w-3.5 shrink-0" />
              <span>
                Coste exacto del render:{' '}
                {projectData.finalCostUSD !== undefined
                  ? `$${projectData.finalCostUSD.toFixed(2)} USD`
                  : 'Calculando...'}
                {projectData.videoDurationReal !== undefined
                  ? ` (${projectData.videoDurationReal}s reales)`
                  : ''}
              </span>
            </div>
            {projectData.costPerSecondVerified ? (
              <span className="text-[10px] text-fg-subtle tabular-nums hidden sm:inline">
                ${projectData.costPerSecondVerified}/s
              </span>
            ) : null}
          </div>

          {/* Botón de Descarga Directa */}
          <a
            href={projectData.videoUrl}
            download={`${projectName.trim() || 'render_final'}.mp4`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 text-fg text-xs font-medium border border-line-strong shadow-sm transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-fg-muted" />
            <span>Descargar MP4</span>
          </a>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Ej: Promo-Lanzamiento-v1"
              className={`w-full rounded-lg border bg-surface-2 px-3 py-2 tabular-nums text-xs text-fg placeholder:text-fg-subtle focus:outline-none transition-colors ${
                nameExists
                  ? 'border-amber-500/50 focus:border-amber-500'
                  : 'border-line focus:border-accent'
              }`}
            />
          </div>

          <button
            type="button"
            disabled={isSaving || !projectName.trim() || nameExists}
            onClick={() => handleSave(false)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-fg px-4 py-2 text-xs font-semibold text-bg hover:bg-fg/85 disabled:opacity-30 transition-colors shrink-0 shadow-sm"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Guardando en Disco...' : 'Guardar Proyecto'}</span>
          </button>
        </div>

        {/* Real-time status / Anti-collision warning */}
        <div className="text-[11px] tabular-nums">
          {nameExists ? (
            <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Ya existe un proyecto con este nombre en tu disco.</span>
              </div>
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="underline hover:text-amber-500 dark:hover:text-amber-300 ml-2 text-[10px]"
              >
                Sobrescribir
              </button>
            </div>
          ) : projectName.trim() ? (
            <div className="text-fg-subtle text-[10px]">
              Se creará la carpeta:{' '}
              <span className="text-fg-muted tabular-nums">
                /{category}/{projectName.trim().replace(/\s+/g, '-')}/
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Success Notification with direct Windows folder launcher */}
      {savedPath && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-xs text-emerald-300 tabular-nums animate-in fade-in">
          <div className="flex items-center gap-2 truncate">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="truncate">✓ Proyecto guardado en tu disco: {savedPath}</span>
          </div>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 px-2.5 py-1 text-[11px] text-emerald-200 shrink-0 ml-2"
          >
            <FolderOpen className="h-3 w-3" />
            <span>Ver en Windows</span>
          </button>
        </div>
      )}

      {error && <div className="text-xs tabular-nums text-rose-400">{error}</div>}
    </div>
  );
}
