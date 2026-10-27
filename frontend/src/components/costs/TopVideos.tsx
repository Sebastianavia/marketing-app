'use client';

import React, { useMemo } from 'react';
import { FolderOpen, LayoutGrid } from 'lucide-react';
import { useNavStore } from '@/store/useNavStore';
import { GROUP_KIND_LABEL, KIND_LABEL, localDay, shortDay, usd, videoCosts, type UsageGroupInfo, type UsageRowWithGroup } from '@/lib/usage/usage-stats';

/** Los 5 videos más caros del mes: producción, proyecto de Guion a video o video suelto, con su desglose. */

export function TopVideos({
  rows,
  groups,
  onOpenFolder,
}: {
  rows: UsageRowWithGroup[];
  groups: Record<string, UsageGroupInfo>;
  onOpenFolder: (dir: string) => void;
}) {
  const openTool = useNavStore((s) => s.openTool);
  const videos = useMemo(() => videoCosts(rows, groups).slice(0, 5), [rows, groups]);

  return (
    <section className="surface-card p-5" aria-label="Videos más caros">
      <h3 className="text-[13.5px] font-medium text-fg">
        {videos[0] ? `El video más caro: «${videos[0].info.nombre}», ${usd(videos[0].costUSD)}` : 'Videos más caros'}
      </h3>
      {videos.length === 0 ? (
        <p className="mt-6 text-[12.5px] text-fg-muted">Cuando termines un video, aquí verás cuánto costó con todo lo suyo.</p>
      ) : (
        <ol className="mt-3 divide-y divide-line">
          {videos.map((v) => {
            const parts = (Object.entries(v.partes) as Array<[keyof typeof KIND_LABEL, number]>)
              .filter(([, c]) => c > 0)
              .map(([k, c]) => `${KIND_LABEL[k]} ${usd(c)}`)
              .join(' · ');
            return (
              <li key={v.info.key} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-fg" title={v.info.nombre}>
                    {v.info.nombre}
                  </p>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">
                    {GROUP_KIND_LABEL[v.info.kind]} · {shortDay(localDay(v.desde))}
                    {parts && ` · ${parts}`}
                  </p>
                </div>
                <span className="text-[12.5px] font-medium tabular-nums text-fg">{usd(v.costUSD)}</span>
                <div className="flex gap-0.5">
                  {v.info.carpeta && (
                    <button
                      type="button"
                      onClick={() => onOpenFolder(v.info.carpeta!)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                      title="Abrir la carpeta"
                      aria-label={`Abrir la carpeta de ${v.info.nombre}`}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openTool('projects')}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                    title="Ver en Proyectos"
                    aria-label="Ver en Proyectos"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
