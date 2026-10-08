'use client';

import React, { useState, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Smartphone, Monitor } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl?: string;
  posterUrl?: string;
  aspectRatio?: '9:16' | '16:9';
  title?: string;
}

export function VideoPlayer({
  videoUrl,
  posterUrl,
  aspectRatio = '9:16',
  title = 'Previsualización',
}: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAspect, setCurrentAspect] = useState<'9:16' | '16:9'>(aspectRatio);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play();
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

  return (
    <div className="relative flex flex-col items-center justify-between h-full w-full rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#070707] p-5 overflow-hidden shadow-xs transition-colors duration-200">
      {/* Top Bar: Title & Aspect Switcher */}
      <div className="flex w-full items-center justify-between pb-3 border-b border-slate-200/80 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${videoUrl ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-zinc-600'}`} />
          <span className="text-xs font-medium text-slate-800 dark:text-zinc-300 tracking-tight">{title}</span>
        </div>

        {/* Aspect Ratio Segmented Control */}
        <div className="flex items-center gap-0.5 rounded-md border border-slate-200/80 dark:border-white/[0.08] bg-slate-100 dark:bg-zinc-950 p-0.5">
          <button
            type="button"
            onClick={() => setCurrentAspect('9:16')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
              currentAspect === '9:16'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100 font-semibold'
                : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <Smartphone className="h-2.5 w-2.5" />
            9:16
          </button>
          <button
            type="button"
            onClick={() => setCurrentAspect('16:9')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
              currentAspect === '16:9'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100 font-semibold'
                : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <Monitor className="h-2.5 w-2.5" />
            16:9
          </button>
        </div>
      </div>

      {/* Video Viewport */}
      <div className="flex-1 flex items-center justify-center w-full py-4 overflow-hidden">
        <div
          className={`relative rounded-lg overflow-hidden border border-slate-200/80 dark:border-white/[0.08] bg-slate-50 dark:bg-black transition-all ${
            currentAspect === '9:16'
              ? 'w-full max-w-[260px] aspect-[9/16]'
              : 'w-full max-w-[480px] aspect-[16/9]'
          }`}
        >
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={posterUrl}
              className="h-full w-full object-cover cursor-pointer"
              onEnded={() => setIsPlaying(false)}
              onClick={togglePlay}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-100 dark:bg-zinc-900/40 text-slate-400 dark:text-zinc-600 mb-2.5">
                <Play className="h-4 w-4 ml-0.5" />
              </div>
              <p className="text-xs font-medium text-slate-700 dark:text-zinc-400">Sin video generado</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-600 mt-1 max-w-[180px]">
                Ajusta los parámetros y presiona Generar Video.
              </p>
            </div>
          )}

          {/* Quick Play overlay */}
          {videoUrl && (
            <button
              onClick={togglePlay}
              className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
                isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
              }`}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg cursor-pointer">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="flex w-full items-center justify-between pt-3 border-t border-slate-200/80 dark:border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          {videoUrl && (
            <>
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200/80 dark:border-white/[0.08] bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors"
              >
                {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200/80 dark:border-white/[0.08] bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </>
          )}
        </div>

        {videoUrl && (
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-black hover:bg-slate-800 dark:hover:bg-zinc-200 px-3 py-1 text-xs font-medium transition-colors shadow-2xs"
          >
            <Download className="h-3 w-3" />
            Descargar
          </button>
        )}
      </div>
    </div>
  );
}
