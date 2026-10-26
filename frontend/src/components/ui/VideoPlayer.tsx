'use client';

import React, { useRef, useState } from 'react';
import { Download, Monitor, Pause, Play, RotateCcw, Smartphone } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl?: string;
  posterUrl?: string;
  aspectRatio?: '9:16' | '16:9';
  title?: string;
}

/**
 * Lienzo de previsualización. El escenario del video es siempre oscuro
 * (como en un editor profesional) para que el contenido sea el protagonista.
 */
export function VideoPlayer({ videoUrl, posterUrl, aspectRatio = '9:16', title = 'Vista previa' }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAspect, setCurrentAspect] = useState<'9:16' | '16:9'>(aspectRatio);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play();
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play();
    setIsPlaying(true);
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const aspectButton = (value: '9:16' | '16:9', Icon: typeof Smartphone) => (
    <button
      type="button"
      onClick={() => setCurrentAspect(value)}
      aria-pressed={currentAspect === value}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] tabular-nums transition-colors ${
        currentAspect === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
      }`}
    >
      <Icon className="h-3 w-3" />
      {value}
    </button>
  );

  return (
    <div className="surface-card flex h-full min-h-[420px] w-full flex-col overflow-hidden">
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${videoUrl ? 'bg-emerald-500' : 'bg-fg-subtle/50'}`} />
          <span className="truncate text-[13px] font-medium text-fg">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {aspectButton('9:16', Smartphone)}
          {aspectButton('16:9', Monitor)}
        </div>
      </div>

      {/* Escenario */}
      <div className="flex flex-1 items-center justify-center bg-surface-2/50 p-6">
        <div
          className={`relative overflow-hidden rounded-xl bg-[#0d0d0f] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.55)] ring-1 ring-black/5 transition-all duration-300 dark:ring-white/5 ${
            currentAspect === '9:16' ? 'aspect-[9/16] w-full max-w-[300px]' : 'aspect-video w-full max-w-[640px]'
          }`}
        >
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                poster={posterUrl}
                className="h-full w-full cursor-pointer object-cover"
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${
                  isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
                }`}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                </span>
              </button>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white/40">
                <Play className="ml-0.5 h-4 w-4" />
              </span>
              <p className="text-[13px] font-medium text-white/70">Tu video aparecerá aquí</p>
              <p className="mt-1 max-w-[200px] text-[12px] text-white/40">Completa los pasos y pulsa Generar.</p>
            </div>
          )}
        </div>
      </div>

      {/* Controles */}
      {videoUrl && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              aria-label="Reiniciar"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <button type="button" onClick={handleDownload} className="btn-secondary h-8 px-3 text-[13px]">
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        </div>
      )}
    </div>
  );
}
