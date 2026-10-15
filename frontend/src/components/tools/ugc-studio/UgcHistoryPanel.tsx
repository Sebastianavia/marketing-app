'use client';

import React, { useEffect, useState } from 'react';
import { History, Loader2, RefreshCw, FolderOpen } from 'lucide-react';
import type { ProjectMetadata } from '@/lib/storage/project-storage';
import type { Storyboard } from '@/types/ugc-studio.types';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';

type UgcProject = ProjectMetadata & { ugcStudio: NonNullable<ProjectMetadata['ugcStudio']> };

const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Historial de proyectos del UGC Studio guardados en disco ("Unir y guardar"),
 * para reabrirlos sin pasar por la biblioteca ni el explorador de archivos.
 */
export function UgcHistoryPanel({ refreshKey, onOpen }: { refreshKey: unknown; onOpen: (project: UgcProject) => void }) {
  const currentId = useUgcStudioStore((s) => s.storyboard?.id);
  const busy = useUgcStudioStore((s) => s.busy);
  const [projects, setProjects] = useState<UgcProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [pendingOpen, setPendingOpen] = useState<UgcProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo leer el historial.');
        return (data.projects as ProjectMetadata[]).filter(
          (p): p is UgcProject => p.category === 'UGC' && Boolean(p.ugcStudio?.storyboard)
        );
      })
      .then((list) => !cancelled && (setProjects(list), setError(null)))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadTick]);

  const open = (project: UgcProject) => {
    const { storyboard, savedProjectPath } = useUgcStudioStore.getState();
    // Avisar antes de reemplazar un trabajo con clips pagados que no se ha guardado
    const unsavedRenders = !savedProjectPath && storyboard?.scenes.some((s) => s.render?.videoUrl);
    if (unsavedRenders && pendingOpen?.id !== project.id) {
      setPendingOpen(project);
      return;
    }
    setPendingOpen(null);
    onOpen(project);
  };

  return (
    <div className="surface-card rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-indigo-500" />
        <p className="text-xs font-semibold text-slate-900 dark:text-white">Historial de proyectos UGC</p>
        <span className="text-[11px] text-slate-500 dark:text-zinc-500">{projects.length}</span>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadTick((t) => t + 1);
          }}
          className="ml-auto text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
          title="Actualizar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-500">
          Aún no hay proyectos guardados. Al pulsar &quot;Unir y guardar&quot; el video aparece aquí.
        </p>
      )}
      {loading && projects.length === 0 && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {projects.map((p) => {
          const sb = p.ugcStudio.storyboard as Storyboard;
          const isCurrent = sb.id === currentId;
          return (
            <div
              key={p.path}
              className={`rounded-lg border p-2.5 space-y-2 ${
                isCurrent ? 'border-indigo-500/50 bg-indigo-500/[0.04]' : 'border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {p.videoUrl ? (
                <video src={p.videoUrl} preload="metadata" muted playsInline controls className="w-full aspect-[9/16] max-h-56 object-contain rounded-md bg-black" />
              ) : (
                <div className="w-full h-24 rounded-md bg-slate-100 dark:bg-white/[0.03]" />
              )}
              <div>
                <p className="text-[11px] font-semibold text-slate-900 dark:text-white line-clamp-2">{sb.title}</p>
                <p className="text-[10px] font-mono text-slate-500 dark:text-zinc-500 truncate" title={p.name}>{p.name}</p>
                <p className="text-[10px] text-slate-500 dark:text-zinc-500">
                  {dateFormat.format(new Date(p.updatedAt))} · {sb.scenes.length} escena(s)
                  {p.videoDurationReal ? ` · ${p.videoDurationReal}s` : ''}
                  {p.finalCostUSD !== undefined ? ` · $${p.finalCostUSD.toFixed(2)}` : ''}
                </p>
              </div>
              {pendingOpen?.id === p.id ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">
                    El proyecto actual tiene escenas renderizadas sin guardar. ¿Abrir este de todas formas?
                  </p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => open(p)} className="flex-1 rounded-md bg-amber-500 text-white text-[11px] py-1">
                      Abrir
                    </button>
                    <button type="button" onClick={() => setPendingOpen(null)} className="flex-1 rounded-md border border-slate-200 dark:border-white/10 text-[11px] py-1 text-slate-600 dark:text-zinc-300">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isCurrent || !!busy}
                  onClick={() => open(p)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-slate-200 dark:border-white/10 text-[11px] font-medium py-1 text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] disabled:opacity-50"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> {isCurrent ? 'Abierto' : 'Abrir'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
