'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Trash2,
  Cloud,
  RefreshCw,
  Image as ImageIcon,
  Film,
  Sparkles,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { useCloudinaryStore } from '@/store/useCloudinaryStore';
import { CloudinaryConfirmModal } from '@/components/storage/CloudinaryConfirmModal';

export function CloudinaryCleanWidget() {
  const {
    totalCount,
    breakdown,
    isLoading,
    fetchCount,
    openModal,
    lastCleanedCount,
  } = useCloudinaryStore();

  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Consulta automática al montar la aplicación
  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 200);
  };

  return (
    <>
      <div
        className="relative inline-flex items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Botón Principal: Ícono representativo con la palabra "Clean" */}
        <button
          type="button"
          onClick={openModal}
          aria-label="Limpiar almacenamiento de Cloudinary"
          className="flex items-center gap-1.5 rounded border border-line bg-surface/80 px-2 py-0.5 tabular-nums text-[10px] text-fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-500/30 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 transition-all shadow-2xs cursor-pointer group"
        >
          <Trash2 className="h-3 w-3 text-fg-subtle group-hover:text-rose-500 transition-colors" />
          <span className="font-semibold tracking-tight">Clean</span>

          {/* Badge sutil con el conteo numérico actual */}
          <span
            className={`rounded-full px-1.5 py-0.2 text-[9px] tabular-nums transition-colors ${
              totalCount !== null && totalCount > 0
                ? 'bg-surface-2/80 text-fg-muted'
                : 'bg-surface-2 text-fg-subtle'
            }`}
          >
            {isLoading && totalCount === null ? (
              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
            ) : totalCount !== null ? (
              totalCount
            ) : (
              '--'
            )}
          </span>
        </button>

        {/* Tooltip / Menú Desplegable Inteligente en Hover */}
        {isHovered && (
          <div
            className="absolute top-full right-0 mt-1.5 z-50 w-72 rounded-xl border border-line bg-surface/95 p-3.5 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 space-y-2.5 text-xs font-sans"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Cabecera del popover */}
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-accent" />
                <span className="font-semibold text-fg text-[11px]">
                  Almacenamiento Cloudinary
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchCount();
                }}
                disabled={isLoading}
                title="Actualizar conteo en tiempo real"
                className="p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Número Total de Archivos Destacado */}
            <div className="rounded-lg bg-surface-2 border border-line p-2.5 space-y-1 text-center">
              <div className="text-xs text-fg-muted font-medium">
                Total de archivos guardados en Cloudinary
              </div>
              <div className="text-xl font-bold tabular-nums text-fg">
                {isLoading && totalCount === null ? (
                  <span className="text-sm font-normal text-fg-subtle">Consultando...</span>
                ) : (
                  `${totalCount ?? 0} archivo(s)`
                )}
              </div>
            </div>

            {/* Desglose de tipos de recursos */}
            {breakdown && Object.keys(breakdown).length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 text-[10px] tabular-nums">
                <div className="flex items-center justify-between p-1.5 rounded bg-surface-2/60 text-fg-muted">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3 text-emerald-500" />
                    <span>Imágenes:</span>
                  </span>
                  <span className="font-semibold text-fg">
                    {breakdown.image ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded bg-surface-2/60 text-fg-muted">
                  <span className="flex items-center gap-1">
                    <Film className="h-3 w-3 text-accent" />
                    <span>Audio/Video:</span>
                  </span>
                  <span className="font-semibold text-fg">
                    {breakdown.video ?? 0}
                  </span>
                </div>
              </div>
            )}

            {/* Explicación de Limpieza Inteligente */}
            <div className="text-[10px] text-fg-subtle leading-relaxed space-y-1">
              <p className="flex items-start gap-1">
                <Info className="h-3 w-3 text-accent shrink-0 mt-0.5" />
                <span>
                  Al hacer clic en <strong>Clean</strong>, se seleccionarán y eliminarán únicamente los{' '}
                  <strong>100 archivos más antiguos</strong> según su fecha de subida (<code className="tabular-nums text-[9px]">created_at</code>).
                </span>
              </p>
            </div>

            {lastCleanedCount !== null && (
              <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-1.5 rounded">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span>Última limpieza: {lastCleanedCount} archivo(s) eliminados.</span>
              </div>
            )}

            {/* Botón de acción directa desde el popover */}
            <button
              type="button"
              onClick={() => {
                setIsHovered(false);
                openModal();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium shadow-sm transition-colors cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              <span>Limpiar 100 más antiguos</span>
            </button>
          </div>
        )}
      </div>

      {/* Modal de confirmación de seguridad */}
      <CloudinaryConfirmModal />
    </>
  );
}
