'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderPlus,
  Save,
  Check,
  AlertTriangle,
  FolderOpen,
  CheckCircle2,
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
    <div className="rounded-xl border border-white/[0.08] bg-[#0A0A0A] p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderPlus className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-semibold text-zinc-200">
            Guardar Proyecto en Carpeta Local ({category})
          </span>
        </div>

        <span className="font-mono text-[10px] text-zinc-500 uppercase">
          Auto-Organizado en Disco
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Ej: Promo-Lanzamiento-v1"
              className={`w-full rounded-lg border bg-black px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition-colors ${
                nameExists
                  ? 'border-amber-500/50 focus:border-amber-500'
                  : 'border-white/[0.1] focus:border-white/30'
              }`}
            />
          </div>

          <button
            type="button"
            disabled={isSaving || !projectName.trim() || nameExists}
            onClick={() => handleSave(false)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-30 transition-colors shrink-0"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Guardando en Disco...' : 'Guardar Proyecto'}</span>
          </button>
        </div>

        {/* Real-time status / Anti-collision warning */}
        <div className="text-[11px] font-mono">
          {nameExists ? (
            <div className="flex items-center justify-between text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Ya existe un proyecto con este nombre en tu disco.</span>
              </div>
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="underline hover:text-amber-300 ml-2 text-[10px]"
              >
                Sobrescribir
              </button>
            </div>
          ) : projectName.trim() ? (
            <div className="text-zinc-500 text-[10px]">
              Se creará la carpeta:{' '}
              <span className="text-zinc-300 font-mono">
                /{category}/{projectName.trim().replace(/\s+/g, '-')}/
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Success Notification with direct Windows folder launcher */}
      {savedPath && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-xs text-emerald-300 font-mono animate-in fade-in">
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

      {error && <div className="text-xs font-mono text-rose-400">{error}</div>}
    </div>
  );
}
