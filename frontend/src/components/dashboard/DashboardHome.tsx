'use client';

import React from 'react';
import Image from 'next/image';
import { ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { TOOLS, type ToolId } from '@/config/tools.config';

/**
 * Inicio de Lulo Studio: titular + tarjetas bento con vista previa visual de
 * cada herramienta. Solo presentación: cada tarjeta llama a `onOpen(id)`.
 * Las fotos de ejemplo viven en `public/dashboard/`.
 */

interface DashboardHomeProps {
  onOpen: (id: ToolId) => void;
}

// Alturas fijas (deterministas) para las ondas decorativas
function wave(count: number, seed: number, amp: number, base: number) {
  return Array.from({ length: count }, (_, i) =>
    Math.round(base + Math.abs(Math.sin(i * 0.55 + seed) * Math.cos(i * 0.21 + seed * 2)) * amp)
  );
}

const AVATAR_WAVE = wave(56, 0.4, 56, 6);
const VOICE_WAVE = wave(52, 1.7, 64, 8);
const TRACK_WAVE = Array.from({ length: 120 }, (_, i) =>
  Math.round(4 + Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.13)) * 16)
);

const SCENES = [
  { label: 'Avatar · gancho', src: '/dashboard/presenter.jpg', pos: 'center 22%', grow: 2 },
  { label: 'Toma de apoyo', src: '/dashboard/thermos.jpg', pos: 'center 40%', grow: 3 },
  { label: 'Avatar · problema', src: '/dashboard/presenter.jpg', pos: 'center 30%', grow: 2 },
  { label: 'Toma de apoyo', src: '/dashboard/super.jpg', pos: 'center 35%', grow: 3 },
  { label: 'Llamado a la acción', src: '/dashboard/presenter.jpg', pos: 'center 25%', grow: 2 },
];

const AVATAR_PHOTOS = ['av1', 'av2', 'av3', 'av4', 'av5', 'av6', 'av7'];
const COST_BARS = [38, 62, 45, 80, 54, 30, 70];

const OVERLAY_TAG =
  'relative rounded-[5px] bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur-sm';

interface BentoCardProps {
  id: ToolId;
  index: number;
  onOpen: (id: ToolId) => void;
  className?: string;
  brand?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}

function BentoCard({ id, index, onOpen, className = '', brand = false, compact = false, children }: BentoCardProps) {
  const tool = TOOLS[id];
  const num = String(index + 1).padStart(2, '0');

  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      style={{ animationDelay: `${80 + index * 60}ms` }}
      className={`bento-card animate-bento-enter group flex w-full flex-col overflow-hidden text-left ${
        brand ? 'bento-card-brand' : ''
      } ${compact ? 'min-h-[330px] gap-5 p-6' : 'min-h-[420px] gap-6 p-7'} ${className}`}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span
          className={`font-mono text-[11px] uppercase tracking-wide ${
            brand ? 'font-semibold text-[#1f2a05]' : 'text-fg-subtle'
          }`}
        >
          {num} / {tool.formula}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {tool.preview && (
            <span className="whitespace-nowrap rounded-md border border-accent px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-accent">
              Vista previa
            </span>
          )}
          <span className="bento-go flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-fg-muted">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1">{children}</div>

      <div className="w-full">
        <h3
          className={`font-display font-extrabold tracking-[-0.03em] ${compact ? 'text-2xl' : 'text-[30px] leading-[1.05]'}`}
          style={{ fontStretch: '115%' }}
        >
          {tool.title}
        </h3>
        <p
          className={`mt-2 max-w-[52ch] leading-relaxed ${compact ? 'text-[13px]' : 'text-sm'} ${
            brand ? 'text-[#1f2a05]' : 'text-fg-muted'
          }`}
        >
          {tool.description}
        </p>
        {!compact && tool.engines && (
          <p className={`mt-3 font-mono text-[11px] ${brand ? 'text-[#1f2a05]' : 'text-fg-subtle'}`}>{tool.engines}</p>
        )}
      </div>
    </button>
  );
}

function Photo({ src, alt, position = 'center', sizes = '200px' }: { src: string; alt: string; position?: string; sizes?: string }) {
  return <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" style={{ objectPosition: position }} />;
}

export function DashboardHome({ onOpen }: DashboardHomeProps) {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-12 sm:px-8 lg:pt-16">
      {/* Titular */}
      <header className="animate-bento-enter">
        <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Video Marketing Studio · Video · Imagen · Voz
        </p>
        <h1
          className="mt-7 font-display text-[clamp(44px,7.2vw,104px)] font-black uppercase leading-[0.9] tracking-[-0.045em] text-fg"
          style={{ fontStretch: '125%' }}
        >
          Sin cámara.
          <br />
          Sin set.
          <br />
          <span className="text-accent">Solo dirige.</span>
        </h1>
        <p className="mt-9 max-w-[56ch] text-[17px] leading-relaxed text-fg-muted">
          Crea anuncios con avatares, voces clonadas y contenido UGC. Elige una herramienta para empezar; todo se guarda
          en tu equipo.
        </p>
      </header>

      <div className="mt-16 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[26px] font-extrabold tracking-[-0.02em]" style={{ fontStretch: '115%' }}>
          Herramientas
        </h2>
        <span className="font-mono text-[11px] uppercase text-fg-subtle">Elige una para empezar</span>
      </div>

      {/* Bento */}
      <section className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-12" aria-label="Herramientas">
        {/* 01 Avatar Studio */}
        <BentoCard id="avatar-studio" index={0} onOpen={onOpen} className="md:col-span-7">
          <div className="flex w-full gap-5">
            <div className="relative w-[170px] shrink-0 overflow-hidden rounded-2xl border border-line bg-surface-2">
              <Photo src="/dashboard/presenter.jpg" alt="Presentador generado con IA" position="center 25%" />
              <span className="absolute left-2.5 top-2.5 rounded-md bg-brand px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-fg">
                ● REC
              </span>
              <span className="absolute inset-x-2.5 bottom-3 rounded-md bg-black/80 px-2 py-1.5 text-center text-[11px] font-bold text-white">
                Hola, te cuento algo…
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-3.5">
              <span className="font-mono text-[11px] uppercase text-fg-subtle">Locución · sincronía labial</span>
              <div className="flex h-[72px] items-center gap-[3px] overflow-hidden" aria-hidden>
                {AVATAR_WAVE.map((h, i) => (
                  <span
                    key={i}
                    className={`wave-bar w-1 shrink-0 rounded-full ${i >= 16 && i <= 30 ? 'bg-accent' : 'bg-line-strong'}`}
                    style={{ height: h, animationDelay: `${(i % 9) * 110}ms` }}
                  />
                ))}
              </div>
              <div className="flex justify-between font-mono text-[11px] text-fg-subtle">
                <span>00:00</span>
                <span>00:30</span>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* 02 Clonación y reemplazo */}
        <BentoCard id="deep-swap" index={1} onOpen={onOpen} className="md:col-span-5">
          <div className="flex w-full items-center justify-center gap-3.5">
            <div className="relative h-[220px] w-[138px] overflow-hidden rounded-[14px] border border-line bg-surface-2">
              <Photo src="/dashboard/podcast.jpg" alt="Video original" position="40% center" />
              <span className={`absolute left-2.5 top-2.5 ${OVERLAY_TAG}`}>ORIGINAL</span>
            </div>
            <svg width="36" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-muted" aria-hidden>
              <path d="M2 12h34M28 4l8 8-8 8" />
            </svg>
            <div className="relative h-[220px] w-[138px] overflow-hidden rounded-[14px] border-2 border-dashed border-accent bg-surface-2">
              <Photo src="/dashboard/cafe-man.jpg" alt="Sujeto reemplazado" position="center 30%" />
              <span className="absolute left-2.5 top-2.5 rounded-[5px] bg-brand px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-fg">
                TÚ
              </span>
            </div>
          </div>
        </BentoCard>

        {/* 03 Generador UGC */}
        <BentoCard id="ugc-generator" index={2} onOpen={onOpen} brand className="md:col-span-4">
          <div className="flex w-full items-center justify-center">
            <div className="h-[266px] w-[150px] rounded-[24px] bg-[#0a0a0b] p-2 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.5)]">
              <div className="relative flex h-full w-full flex-col justify-end gap-1.5 overflow-hidden rounded-2xl bg-[#1a1a1d] p-2.5">
                <Photo src="/dashboard/skincare.jpg" alt="Anuncio UGC de ejemplo" />
                <span className="absolute right-2.5 top-2.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white">9:16</span>
                <span className="relative rounded-[5px] bg-white px-1.5 py-1 text-center text-[11px] font-black uppercase leading-tight text-[#0a0a0b]">
                  No sabía que necesitaba esto
                </span>
                <span className="relative mt-1 h-[3px] w-full overflow-hidden rounded-full bg-black/60">
                  <span className="block h-full w-[42%] bg-[#c6ff3d]" />
                </span>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* 04 Guion a video */}
        <BentoCard id="text-to-video" index={3} onOpen={onOpen} className="md:col-span-8">
          <div className="relative flex w-full flex-col justify-center gap-2.5">
            <div className="flex gap-1.5">
              {SCENES.map((s, i) => (
                <div
                  key={i}
                  className="relative flex h-[112px] min-w-0 flex-col items-start justify-between overflow-hidden rounded-xl border border-line bg-surface-2 p-2"
                  style={{ flex: `${s.grow} 1 0` }}
                >
                  <Photo src={s.src} alt="" position={s.pos} />
                  <span className={OVERLAY_TAG}>ESC {String(i + 1).padStart(2, '0')}</span>
                  <span className="relative max-w-full truncate rounded-[5px] bg-black/80 px-1.5 py-0.5 text-[11px] font-bold text-white">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex h-[34px] items-center gap-[2px] overflow-hidden rounded-[10px] border border-line bg-surface-2 px-2.5" aria-hidden>
              <span className="mr-2.5 shrink-0 font-mono text-[10px] text-fg-subtle">VOZ</span>
              {TRACK_WAVE.map((h, i) => (
                <span key={i} className="w-[3px] shrink-0 rounded-[1px] bg-line-strong" style={{ height: h }} />
              ))}
            </div>
            <div className="flex h-[22px] items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5" aria-hidden>
              <span className="font-mono text-[10px] text-fg-subtle">FUNDIDOS</span>
              <span className="h-0 flex-1 border-t border-dashed border-line-strong" />
            </div>
            <span className="absolute -top-1.5 bottom-0 left-[46%] w-0.5 bg-accent" aria-hidden />
            <span className="absolute -top-1.5 left-[calc(46%-5px)] h-3 w-3 rounded-[3px] bg-accent" aria-hidden />
          </div>
        </BentoCard>

        {/* 05 Creación de imágenes */}
        <BentoCard id="image-studio" index={4} onOpen={onOpen} className="md:col-span-6">
          <div className="grid w-full grid-cols-3 gap-2">
            <div className="relative row-span-2 flex min-h-[220px] items-end overflow-hidden rounded-[14px] border border-line bg-surface-2 p-2.5">
              <Photo src="/dashboard/super.jpg" alt="Imagen generada: supermercado" sizes="260px" />
              <span className={OVERLAY_TAG}>SEEDREAM</span>
            </div>
            <div className="relative flex min-h-[110px] items-end overflow-hidden rounded-[14px] border border-line bg-surface-2 p-2.5">
              <Photo src="/dashboard/pink-room.jpg" alt="Imagen generada: habitación" position="center 30%" />
              <span className={OVERLAY_TAG}>NANO BANANA</span>
            </div>
            <div className="relative flex min-h-[110px] items-end overflow-hidden rounded-[14px] border border-line bg-surface-2 p-2.5">
              <Photo src="/dashboard/coffee-bag.jpg" alt="Imagen generada: cocina" position="center 25%" />
              <span className={OVERLAY_TAG}>SEEDREAM</span>
            </div>
            <div className="col-span-2 flex items-center gap-2.5 rounded-[14px] border border-dashed border-line-strong bg-surface-2 px-3.5">
              <Sparkles className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate text-[13px] text-fg-muted">“Ella en una cafetería, luz de ventana, 35 mm…”</span>
            </div>
          </div>
        </BentoCard>

        {/* 06 Creación de avatar */}
        <BentoCard id="avatars" index={5} onOpen={onOpen} className="md:col-span-6">
          <div className="flex w-full flex-col justify-center gap-3.5">
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 14 }, (_, i) => {
                const photo = AVATAR_PHOTOS[i];
                return photo ? (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-[10px] border border-line bg-surface-2">
                    <Photo src={`/dashboard/${photo}.jpg`} alt="" sizes="80px" />
                  </div>
                ) : (
                  <div key={i} className="flex aspect-square items-center justify-center rounded-[10px] border border-dashed border-line-strong text-fg-subtle">
                    <Plus className="h-3.5 w-3.5" />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full w-1/2 rounded-full bg-accent" />
              </span>
              <span className="font-mono text-[11px] text-fg-muted">7 / 14 FOTOS</span>
            </div>
          </div>
        </BentoCard>

        {/* 07 Voice Studio */}
        <BentoCard id="voice-studio" index={6} onOpen={onOpen} compact className="md:col-span-4">
          <div className="flex w-full flex-col justify-center gap-4">
            <div className="flex h-[90px] items-center gap-[3px] overflow-hidden" aria-hidden>
              {VOICE_WAVE.map((h, i) => (
                <span
                  key={i}
                  className={`wave-bar w-1 shrink-0 rounded-full ${i <= 20 ? 'bg-accent' : 'bg-line-strong'}`}
                  style={{ height: h, animationDelay: `${(i % 7) * 140}ms` }}
                />
              ))}
            </div>
            <div className="flex gap-1.5 font-mono text-[11px]">
              <span className="rounded-md bg-fg px-2 py-1 font-semibold text-bg">ES</span>
              <span className="rounded-md border border-line-strong px-2 py-1 text-fg-muted">EN</span>
              <span className="rounded-md border border-line-strong px-2 py-1 text-fg-muted">PT</span>
            </div>
          </div>
        </BentoCard>

        {/* 08 Proyectos */}
        <BentoCard id="projects" index={7} onOpen={onOpen} compact className="md:col-span-4">
          <div className="w-full rounded-[14px] border border-line bg-surface-2 px-4 py-3 font-mono text-[12px] leading-8 text-fg-muted">
            <div className="text-fg">▾ LuloStudio_Projects/</div>
            <div className="pl-4">
              <span className="text-accent">■</span> UGC/
            </div>
            <div className="pl-4">
              <span className="text-fg-subtle">■</span> HeyGen/
            </div>
            <div className="pl-4">
              <span className="text-fg-subtle">■</span> TextToVideo/
            </div>
            <div className="pl-4">
              <span className="text-fg-subtle">■</span> Imagenes/
            </div>
          </div>
        </BentoCard>

        {/* 09 Costos */}
        <BentoCard id="costs" index={8} onOpen={onOpen} compact className="md:col-span-4">
          <div className="flex w-full flex-col justify-end gap-2.5" aria-hidden>
            <div className="flex h-20 items-end gap-2">
              {COST_BARS.map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-t-[5px] rounded-b-[2px] ${i === 3 ? 'bg-accent' : 'bg-line-strong'}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[10px] text-fg-subtle">
              {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>
        </BentoCard>
      </section>

      <p className="mt-10 text-[12px] text-fg-subtle">
        Atajos: <kbd className="rounded border border-line px-1 font-mono">⌘1</kbd>–
        <kbd className="rounded border border-line px-1 font-mono">⌘9</kbd> para cambiar de herramienta,{' '}
        <kbd className="rounded border border-line px-1 font-mono">⌘0</kbd> para volver aquí.
      </p>
    </div>
  );
}
