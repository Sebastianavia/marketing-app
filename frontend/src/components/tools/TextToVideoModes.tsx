'use client';

import React from 'react';
import { DirectorStudio } from '@/components/director-mode/DirectorStudio';

/**
 * Guion a video: entra directamente al Estudio Director (chat + lienzo por nodos + vista lista).
 */
export function TextToVideoModes() {
  return (
    <div className="w-full space-y-5">
      <DirectorStudio />
    </div>
  );
}
