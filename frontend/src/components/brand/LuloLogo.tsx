import React from 'react';

/**
 * Logo de Lulo Studio: "LULO" extra ancho donde la O es un lulo partido
 * (cáscara naranja, pulpa lima, semillas y botón de reproducir).
 * Archivos para exportar: carpeta `brand/lulo-studio-logo/` en la raíz del repo.
 */

const SEEDS = Array.from({ length: 10 }, (_, i) => {
  const angle = ((i * 36 - 90) * Math.PI) / 180;
  return { cx: 50 + 30 * Math.cos(angle), cy: 50 + 30 * Math.sin(angle), rotate: i * 36 };
});

interface LuloMarkProps {
  size?: number;
  /** `simple` (sin semillas) para tamaños de menos de 48 px. */
  variant?: 'detail' | 'simple';
  className?: string;
  title?: string;
}

export function LuloMark({ size = 24, variant = 'simple', className, title }: LuloMarkProps) {
  const simple = variant === 'simple';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="50" cy="50" r="46" fill="#FF8A1F" />
      <circle cx="50" cy="50" r={simple ? 38 : 40} fill="#C6FF3D" />
      {!simple &&
        SEEDS.map((s, i) => (
          <ellipse
            key={i}
            cx={s.cx}
            cy={s.cy}
            rx="2.6"
            ry="5"
            transform={`rotate(${s.rotate} ${s.cx} ${s.cy})`}
            fill="#0A0A0B"
            opacity="0.55"
          />
        ))}
      <circle cx="50" cy="50" r={simple ? 20 : 17} fill="#0A0A0B" />
      <path d={simple ? 'M44 39 L62 50 L44 61 Z' : 'M45 41 L60 50 L45 59 Z'} fill="#C6FF3D" />
    </svg>
  );
}

interface LuloLogoProps {
  /** Tamaño de la letra de "LUL" en px. */
  size?: number;
  /** Muestra "STUDIO" al lado (barra) o debajo (bloque). */
  layout?: 'inline' | 'stacked';
  className?: string;
}

export function LuloLogo({ size = 17, layout = 'inline', className = '' }: LuloLogoProps) {
  const markSize = Math.round(size * 0.82);
  const stacked = layout === 'stacked';
  return (
    <span
      className={`inline-flex ${stacked ? 'flex-col items-start gap-1' : 'items-center gap-2'} leading-none ${className}`}
      role="img"
      aria-label="Lulo Studio"
    >
      <span
        className="flex items-center font-display font-black uppercase tracking-[-0.035em] text-fg"
        style={{ fontSize: size, fontStretch: '125%' }}
        aria-hidden
      >
        LUL
        <LuloMark size={markSize} variant={markSize >= 48 ? 'detail' : 'simple'} className="ml-[0.06em] shrink-0" />
      </span>
      <span
        className="font-mono font-medium uppercase text-fg-subtle"
        style={{ fontSize: Math.max(9, Math.round(size * (stacked ? 0.22 : 0.56))), letterSpacing: stacked ? '0.6em' : '0.32em' }}
        aria-hidden
      >
        Studio
      </span>
    </span>
  );
}
