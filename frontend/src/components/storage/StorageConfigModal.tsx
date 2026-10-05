'use client';

import React, { useState, useEffect } from 'react';
import {
  Folder,
  HardDrive,
  X,
  Check,
  ExternalLink,
  FolderOpen,
  AlertCircle,
} from 'lucide-react';

interface StorageConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStorageChanged?: (newPath: string) => void;
}

export function StorageConfigModal({
  isOpen,
  onClose,
  onStorageChanged,
}: StorageConfigModalProps) {
  const [basePath, setBasePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/settings/storage')
        .then((res) => res.json())
        .then((data) => {
          if (data.basePath) {
            setBasePath(data.basePath);
          }
        })
        .catch((err) => console.error('Error al cargar ruta:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (pathToSave?: string) => {
    const target = pathToSave || basePath;
    if (!target.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: target }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo configurar la carpeta');
      }

      setBasePath(data.basePath);
      setSavedSuccess(true);
      onStorageChanged?.(data.basePath);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenInExplorer = async () => {
    try {
      await fetch('/api/projects/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: basePath }),
      });
    } catch (err) {
      console.error('Error al abrir explorador:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.12] bg-[#0A0A0A] p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-900 text-zinc-300">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Carpeta Principal de Proyectos en Disco
              </h2>
              <p className="text-xs text-zinc-500">
                Elige en qué disco duro (D:, C:, E:, etc.) guardar todos tus videos y assets.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Input & Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 mb-1.5">
              Ruta en tu Computador (Windows / Mac):
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                  placeholder="D:\LuloStudio_Projects"
                  className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 font-mono text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                />
              </div>
              <button
                type="button"
                onClick={handleOpenInExplorer}
                title="Abrir esta carpeta en el Explorador de Windows"
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Explorador</span>
              </button>
            </div>
          </div>

          {/* Quick Drive Presets */}
          <div>
            <span className="text-[11px] text-zinc-500 font-mono block mb-1.5">
              Accesos rápidos sugeridos:
            </span>
            <div className="flex flex-wrap gap-2">
              {['D:\\LuloStudio_Projects', 'C:\\LuloStudio_Projects', 'E:\\LuloStudio_Projects'].map(
                (preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setBasePath(preset);
                      handleSave(preset);
                    }}
                    className={`rounded border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      basePath === preset
                        ? 'border-white/30 bg-zinc-800 text-white'
                        : 'border-white/[0.06] bg-zinc-950 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                    }`}
                  >
                    {preset}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Structure Explanation */}
          <div className="rounded-lg border border-white/[0.06] bg-zinc-950/60 p-3 text-[11px] font-mono text-zinc-400 space-y-1.5">
            <div className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-indigo-400" />
              <span>Estructura que se creará automáticamente en tu disco:</span>
            </div>
            <div className="pl-5 text-[10px] text-zinc-500 leading-relaxed">
              <div>📁 {basePath || 'D:\\LuloStudio_Projects'}</div>
              <div className="pl-4">├── 📁 HeyGen/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Proyectos de Avatar Studio</div>
              <div className="pl-4">├── 📁 UGC/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Anuncios y guiones virales</div>
              <div className="pl-4">├── 📁 TextToVideo/ &nbsp;&nbsp;&nbsp;→ Prompts cinemáticos Sora/VEO</div>
              <div className="pl-4">└── 📁 Genjutsu/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Reemplazos y clonaciones faciales</div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-400 font-mono">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {savedSuccess && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>✓ Carpeta principal actualizada y verificada en tu disco.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading || !basePath.trim()}
            onClick={() => handleSave()}
            className="rounded-lg bg-white px-5 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Guardando...' : 'Aplicar Directorio'}
          </button>
        </div>
      </div>
    </div>
  );
}
