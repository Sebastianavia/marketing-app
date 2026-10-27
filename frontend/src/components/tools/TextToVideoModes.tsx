'use client';

import React, { useState } from 'react';
import { Clapperboard, SlidersHorizontal } from 'lucide-react';
import { TextToVideoView } from '@/components/tools/TextToVideoView';
import { DirectorStudio } from '@/components/director-mode/DirectorStudio';

/**
 * Guion a video con dos modos: el manual de siempre (intacto) y el modo Director (etapas estilo Buzzy).
 * El manual se oculta con CSS en vez de desmontarse para no perder lo escrito al cambiar de modo.
 */

type Mode = 'manual' | 'director';
const MODE_KEY = 'lulo_t2v_mode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'director' ? 'director' : 'manual';
  } catch {
    return 'manual';
  }
}

export function TextToVideoModes() {
  const [mode, setMode] = useState<Mode>(readMode);
  const [directorMounted, setDirectorMounted] = useState(mode === 'director');

  const choose = (m: Mode) => {
    setMode(m);
    if (m === 'director') setDirectorMounted(true);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // sin almacenamiento: solo no se recuerda
    }
  };

  const tabs: Array<{ id: Mode; label: string; icon: React.ReactNode }> = [
    { id: 'manual', label: 'Manual', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
    { id: 'director', label: 'Director (beta)', icon: <Clapperboard className="h-3.5 w-3.5" /> },
  ];

  return (
    // El Director usa todo el ancho (lienzo + chat); el manual sigue en su columna
    <div className={`w-full space-y-5 ${mode === 'director' ? '' : 'max-w-3xl'}`}>
      <div className="inline-grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Modo de Guion a video">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => choose(t.id)}
            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${
              mode === t.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className={mode === 'manual' ? '' : 'hidden'}>
        <TextToVideoView />
      </div>
      {directorMounted && (
        <div className={mode === 'director' ? '' : 'hidden'}>
          <DirectorStudio />
        </div>
      )}
    </div>
  );
}
