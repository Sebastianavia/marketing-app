'use client';

import React, { useEffect, useState } from 'react';
import type { ProfileInput } from '@/config/editor-looks';

/**
 * Vista previa aproximada de un perfil: teléfono con el gancho arriba y un subtítulo
 * que se anima como en el video final (karaoke, palabra a palabra o frase fija).
 * Usa la misma fuente del sistema que luego usa FFmpeg, así que se parece bastante.
 */

const SAMPLE = ['Así', 'se', 'ven', 'tus', 'subtítulos', 'en', 'cada', 'reel'];
const KEY = 'subtítulos';

const ASPECT: Record<string, string> = { '9:16': '9 / 16', '4:5': '4 / 5', '1:1': '1 / 1' };

export function LookPreview({ look, gancho = 'Esto cambia tu forma de vender', width = 190 }: { look: ProfileInput; gancho?: string; width?: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, []);

  const s = look.subtitulos;
  const h = look.gancho;
  const scale = width / 1080;
  const per = s.estilo === 'palabra' ? 1 : Math.max(1, s.palabrasPorLinea);
  const idx = tick % SAMPLE.length;
  const chunkStart = Math.floor(idx / per) * per;
  const chunk = SAMPLE.slice(chunkStart, chunkStart + per);
  const fmt = (w: string) => (s.mayusculas ? w.toLocaleUpperCase('es') : w);

  const stroke = s.caja || s.grosorBorde <= 0 ? undefined : `${Math.max(1, s.grosorBorde * scale * 2).toFixed(1)}px ${s.colorBorde}`;
  const textStyle: React.CSSProperties = {
    fontFamily: `"${s.fuente}", Arial, sans-serif`,
    fontSize: Math.max(9, s.tamano * scale),
    fontWeight: 800,
    color: s.colorTexto,
    lineHeight: 1.15,
    textAlign: 'center',
    WebkitTextStroke: stroke,
    paintOrder: 'stroke fill',
    textShadow: s.caja || s.grosorBorde <= 0 ? undefined : `0 ${2 * scale * 4}px ${3 * scale * 4}px rgb(0 0 0 / 0.45)`,
  };
  const boxStyle: React.CSSProperties = s.caja
    ? { background: s.colorCaja, padding: `${s.tamano * scale * 0.2}px ${s.tamano * scale * 0.3}px`, borderRadius: 3 }
    : {};

  const posClass = s.posicion === 'arriba' ? 'top-[17%]' : s.posicion === 'centro' ? 'top-1/2 -translate-y-1/2' : 'bottom-[20%]';
  const hookAtBottom = s.posicion === 'arriba';

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border-[3px] border-[#111] bg-[#1b1b1f] shadow-[var(--shadow-lift)]"
      style={{ width, aspectRatio: ASPECT[look.formato] ?? '9 / 16' }}
      aria-label="Vista previa del perfil"
    >
      {/* Persona de ejemplo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,#5b5148_0%,#2a2622_45%,#141312_100%)]" />
      <div className="absolute left-1/2 top-[30%] h-[22%] w-[30%] -translate-x-1/2 rounded-full bg-[#c9a68a]/80" />
      <div className="absolute left-1/2 top-[50%] h-[45%] w-[62%] -translate-x-1/2 rounded-t-[40%] bg-[#2f3b4a]" />

      {h.activo && gancho && (
        <div className={`absolute inset-x-0 flex justify-center px-2 ${hookAtBottom ? 'bottom-[11%]' : 'top-[11%]'}`}>
          <span
            style={{
              fontFamily: `"${s.fuente}", Arial, sans-serif`,
              fontSize: Math.max(8, h.tamano * scale),
              fontWeight: 800,
              color: h.colorTexto,
              background: h.colorFondo,
              padding: `${h.tamano * scale * 0.25}px ${h.tamano * scale * 0.35}px`,
              lineHeight: 1.15,
              textAlign: 'center',
            }}
          >
            {gancho.toLocaleUpperCase('es')}
          </span>
        </div>
      )}

      {s.activo && (
        <div className={`absolute inset-x-0 flex justify-center px-2 ${posClass}`}>
          <span style={{ ...textStyle, ...boxStyle }}>
            {chunk.map((w, i) => {
              const current = chunkStart + i === idx;
              const isKey = w === KEY;
              const highlighted = isKey || (s.estilo === 'karaoke' && current);
              const scaleKey = (s.escalaClave ?? 130) / 100;
              return (
                <React.Fragment key={`${chunkStart}-${i}`}>
                  {i > 0 && ' '}
                  <span
                    style={{
                      color: highlighted ? s.colorResaltado : undefined,
                      display: 'inline-block',
                      transform: isKey ? `scale(${scaleKey})` : s.estilo === 'karaoke' && current ? 'scale(1.08)' : undefined,
                      margin: isKey ? `0 ${((scaleKey - 1) * s.tamano * scale * 1.2).toFixed(1)}px` : undefined,
                    }}
                  >
                    {fmt(w)}
                  </span>
                </React.Fragment>
              );
            })}
          </span>
        </div>
      )}
    </div>
  );
}

/** Tres puntos de color que resumen un perfil en las tarjetas. */
export function LookDots({ look }: { look: ProfileInput }) {
  const colors = [look.subtitulos.colorTexto, look.subtitulos.colorResaltado, look.gancho.colorFondo];
  return (
    <span className="flex -space-x-1" aria-hidden>
      {colors.map((c, i) => (
        <span key={i} className="h-3.5 w-3.5 rounded-full border border-line-strong" style={{ background: c }} />
      ))}
    </span>
  );
}
