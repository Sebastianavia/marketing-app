'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Music2 } from 'lucide-react';
import { splitMentions, tagKindLabel } from '@/lib/director-mode/mentions';
import type { DirectorRef, DirectorTag } from '@/lib/director-mode/types';

/** Piezas compartidas de referencias: URL de un archivo, miniatura, @ como fichas y avatares guardados. */

export function refUrl(productionId: string, refId: string) {
  return `/api/director-mode/${productionId}/referencias?ref=${encodeURIComponent(refId)}`;
}

export function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return m ? `${m}:${String(r).padStart(2, '0')} min` : `${r} s`;
}

/** Miniatura de una referencia: foto, o icono para audio y PDF. */
export function RefThumb({ productionId, r, size = 44, dim }: { productionId: string; r: DirectorRef; size?: number; dim?: boolean }) {
  const style = { width: size, height: size };
  if (r.medio === 'imagen') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={refUrl(productionId, r.id)} alt={r.nombreOriginal} title={r.nombreOriginal} style={style} className={`shrink-0 rounded-md border border-line object-cover ${dim ? 'opacity-60' : ''}`} loading="lazy" />
    );
  }
  return (
    <span style={style} title={r.nombreOriginal} className="flex shrink-0 flex-col items-center justify-center rounded-md border border-line bg-surface-2 text-fg-subtle">
      {r.medio === 'audio' ? <Music2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      {r.duracionSeg ? <span className="text-[9px] leading-none">{Math.round(r.duracionSeg)} s</span> : null}
    </span>
  );
}

/** Ficha de una etiqueta (@Nombre). Punteada si el agente la propuso y aún no se confirma. */
export function TagChip({ tag, onClick }: { tag: DirectorTag; onClick?: () => void }) {
  const k = tagKindLabel(tag.tipo);
  const cls = `inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10.5px] leading-tight ${
    tag.confirmada ? 'border-accent/40 bg-accent/10 text-fg' : 'border-dashed border-line-strong text-fg-muted'
  }`;
  const body = (
    <>
      <span aria-hidden>{k.icono}</span>@{tag.mencion}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer hover:border-accent`} title={`${k.label}: ${tag.nombre}`}>
      {body}
    </button>
  ) : (
    <span className={cls} title={`${k.label}: ${tag.nombre}${tag.confirmada ? '' : ' (propuesta)'}`}>
      {body}
    </span>
  );
}

/** Texto con las @ conocidas dibujadas como fichas. */
export function MentionText({ text, tags }: { text: string; tags?: DirectorTag[] }) {
  return (
    <>
      {splitMentions(text, tags).map((p, i) =>
        p.tag ? (
          <span key={i} className="whitespace-nowrap font-medium text-accent">
            @{p.tag.mencion}
          </span>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </>
  );
}

/**
 * Reproduce tramos de un audio (frases de la locución, trozo de una escena). Un solo elemento de audio
 * por componente; `playing` = clave del tramo que suena.
 */
export function useAudioSlices(src: string | null) {
  // El reproductor vive fuera del estado de React (es un objeto del navegador, no algo que se dibuja)
  const [player] = useState(() => new SlicePlayer());
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => player.reset(), [player, src]);

  const stop = () => {
    player.pause();
    setPlaying(null);
  };

  const play = (key: string, start: number, end: number) => {
    if (!src) return;
    if (playing === key) return stop();
    player.play(src, start, end, () => setPlaying(null));
    setPlaying(key);
  };

  return { play, stop, playing };
}

/** Un elemento de audio que suena desde `start` y se para en `end`. */
class SlicePlayer {
  private audio: HTMLAudioElement | null = null;
  private src = '';
  private stopAt = 0;
  private onStop: () => void = () => undefined;

  play(src: string, start: number, end: number, onStop: () => void) {
    if (!this.audio || this.src !== src) {
      this.reset();
      const a = new Audio(src);
      a.preload = 'auto';
      a.ontimeupdate = () => {
        if (a.currentTime >= this.stopAt) {
          a.pause();
          this.onStop();
        }
      };
      a.onended = () => this.onStop();
      this.audio = a;
      this.src = src;
    }
    this.stopAt = end;
    this.onStop = onStop;
    this.audio.currentTime = start;
    void this.audio.play().catch(() => this.onStop());
  }

  pause() {
    this.audio?.pause();
  }

  reset() {
    this.audio?.pause();
    this.audio = null;
    this.src = '';
  }
}

export interface SavedAvatar {
  id: string;
  name: string;
  coverUrl: string | null;
}

let avatarsPromise: Promise<SavedAvatar[]> | null = null;

function loadAvatars(): Promise<SavedAvatar[]> {
  avatarsPromise ??= fetch('/api/avatars', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => (d.avatars ?? []).map((a: SavedAvatar) => ({ id: a.id, name: a.name, coverUrl: a.coverUrl })))
    .catch(() => {
      avatarsPromise = null;
      return [];
    });
  return avatarsPromise;
}

/** Avatares guardados (se piden una vez por sesión). */
export function useSavedAvatars(): SavedAvatar[] {
  const [list, setList] = useState<SavedAvatar[]>([]);
  useEffect(() => {
    let alive = true;
    void loadAvatars().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}
