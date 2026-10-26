'use client';

import React from 'react';
import { AlertTriangle, Trash2, X, Loader2, Cloud, ShieldAlert } from 'lucide-react';
import { useCloudinaryStore } from '@/store/useCloudinaryStore';

export function CloudinaryConfirmModal() {
  const {
    isModalOpen,
    closeModal,
    totalCount,
    isDeleting,
    cleanOldest,
    lastError,
  } = useCloudinaryStore();

  if (!isModalOpen) return null;

  const filesTargetCount = totalCount !== null ? Math.min(100, totalCount) : 100;

  const handleConfirm = async () => {
    await cleanOldest(100);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/60 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
        {/* Header con advertencia */}
        <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">
                Confirmación de Limpieza Inteligente
              </h3>
              <p className="text-[11px] tabular-nums text-fg-subtle">
                Cloudinary Cloud Storage · Lote de 100 más antiguos
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isDeleting}
            onClick={closeModal}
            className="text-fg-subtle hover:text-fg-muted transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mensaje central */}
        <div className="space-y-3 text-xs leading-relaxed">
          <div className="p-3.5 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300 space-y-1.5">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>¿Estás seguro de eliminar los 100 archivos más antiguos de Cloudinary?</span>
            </div>
            <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80 pl-6">
              Esta acción no se puede deshacer.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-surface-2 p-3.5 space-y-2 text-fg-muted text-[11px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-fg-muted font-sans">
                <Cloud className="h-3.5 w-3.5 text-accent" />
                Total actual almacenado:
              </span>
              <span className="font-semibold text-fg">
                {totalCount !== null ? `${totalCount} archivo(s)` : 'Consultando...'}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="text-fg-muted font-sans">
                Archivos a seleccionar y depurar:
              </span>
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                {filesTargetCount} más antiguos (<span className="text-[10px]">created_at ASC</span>)
              </span>
            </div>

            <p className="text-[10px] text-fg-subtle pt-1 font-sans">
              ℹ️ Tus archivos y renders más recientes permanecerán totalmente a salvo.
            </p>
          </div>

          {lastError && (
            <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs">
              {lastError}
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
          <button
            type="button"
            disabled={isDeleting}
            onClick={closeModal}
            className="rounded-lg px-4 py-2 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={isDeleting || totalCount === 0}
            onClick={handleConfirm}
            className="flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 text-xs font-semibold shadow-sm disabled:opacity-40 transition-all cursor-pointer"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Depurando archivos...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                <span>Sí, limpiar espacio</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
