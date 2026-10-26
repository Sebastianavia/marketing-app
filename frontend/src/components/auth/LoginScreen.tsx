'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';
import { LuloLogo, LuloMark } from '@/components/brand/LuloLogo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Pantalla de entrada. El botón de Google usa `useAuthStore`, que hoy es una
 * fachada (deja entrar sin conectar con Google). Ver `store/useAuthStore.ts`.
 */

type Phase = 'idle' | 'loading' | 'done';

interface Shot {
  src: string;
  pos: string;
  tag: string;
  time: string;
}

const COLUMNS: { dir: 'up' | 'down'; shots: Shot[] }[] = [
  {
    dir: 'up',
    shots: [
      { src: '/dashboard/presenter.jpg', pos: 'center 25%', tag: 'AVATAR STUDIO', time: '0:30' },
      { src: '/dashboard/skincare.jpg', pos: 'center 30%', tag: 'UGC', time: '0:15' },
      { src: '/dashboard/super.jpg', pos: 'center 30%', tag: 'IMAGEN', time: '4K' },
      { src: '/dashboard/cafe-man.jpg', pos: 'center 30%', tag: 'CLONACIÓN', time: '0:22' },
    ],
  },
  {
    dir: 'down',
    shots: [
      { src: '/dashboard/pink-room.jpg', pos: 'center 30%', tag: 'IMAGEN', time: '4K' },
      { src: '/dashboard/thermos.jpg', pos: 'center 35%', tag: 'GUION A VIDEO', time: '0:45' },
      { src: '/dashboard/podcast.jpg', pos: '40% center', tag: 'AVATAR STUDIO', time: '1:02' },
      { src: '/dashboard/coffee-bag.jpg', pos: 'center 25%', tag: 'UGC', time: '0:18' },
    ],
  },
  {
    dir: 'up',
    shots: [
      { src: '/dashboard/cafe-man.jpg', pos: 'center 30%', tag: 'UGC', time: '0:20' },
      { src: '/dashboard/super.jpg', pos: 'center 40%', tag: 'GUION A VIDEO', time: '0:38' },
      { src: '/dashboard/presenter.jpg', pos: 'center 30%', tag: 'VOZ CLONADA', time: '0:12' },
      { src: '/dashboard/skincare.jpg', pos: 'center 20%', tag: 'IMAGEN', time: '4K' },
    ],
  },
];

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function SpinningBadge() {
  return (
    <div className="login-spin relative h-[168px] w-[168px]">
      <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden className="absolute inset-0">
        <defs>
          <path id="login-ring" d="M84 84 m-66 0 a66 66 0 1 1 132 0 a66 66 0 1 1 -132 0" />
        </defs>
        <circle cx="84" cy="84" r="82" className="fill-bg stroke-line-strong" />
        <text className="fill-fg font-mono" fontSize="12.5" letterSpacing="3.4">
          <textPath href="#login-ring">SIN CÁMARA · SIN SET · SOLO DIRIGE · </textPath>
        </text>
      </svg>
      <div className="login-spin-back absolute inset-0 flex items-center justify-center">
        <LuloMark size={92} variant="detail" />
      </div>
    </div>
  );
}

export function LoginScreen() {
  const authenticateWithGoogle = useAuthStore((s) => s.authenticateWithGoogle);
  const startSession = useAuthStore((s) => s.startSession);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const enterTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
    },
    []
  );

  const handleGoogle = async () => {
    if (phase !== 'idle') return;
    setError(null);
    setPhase('loading');
    try {
      const user = await authenticateWithGoogle();
      setPhase('done');
      enterTimer.current = window.setTimeout(() => startSession(user), 750);
    } catch {
      setPhase('idle');
      setError('No se pudo conectar con Google. Intenta de nuevo.');
    }
  };

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-bg text-fg">
      {/* Muro de ejemplos */}
      <section
        aria-label="Ejemplos creados con Lulo Studio"
        className="relative hidden min-w-0 flex-[1.15] overflow-hidden border-r border-line bg-surface-2 lg:block"
      >
        <div
          aria-hidden
          className="absolute -inset-x-5 -inset-y-10 grid grid-cols-3 gap-3.5 opacity-90"
          style={{ transform: 'rotate(-6deg) scale(1.12)' }}
        >
          {COLUMNS.map((col, ci) => (
            <div key={ci} className="overflow-hidden">
              <div className={`flex flex-col gap-3.5 ${col.dir === 'up' ? 'login-col-up' : 'login-col-down'}`}>
                {[...col.shots, ...col.shots].map((s, i) => (
                  <div key={i} className="relative aspect-[9/14] overflow-hidden rounded-[18px] border border-line bg-surface">
                    <Image src={s.src} alt="" fill sizes="22vw" className="object-cover" style={{ objectPosition: s.pos }} />
                    <span className="absolute left-2.5 top-2.5 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                      {s.tag}
                    </span>
                    <span className="absolute bottom-2.5 right-2.5 rounded-md bg-brand px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-fg">
                      {s.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Veladura para leer el texto */}
        <div aria-hidden className="absolute inset-0 bg-linear-to-b from-bg/55 via-bg/10 via-35% to-bg" />

        <div className="absolute left-10 top-9">
          <LuloLogo size={22} />
        </div>
        <div className="absolute right-10 top-8">
          <SpinningBadge />
        </div>

        <h2
          className="login-rise absolute inset-x-10 bottom-11 font-display text-[clamp(48px,5.6vw,80px)] font-black uppercase leading-[0.9] tracking-[-0.045em] text-fg"
          style={{ fontStretch: '125%' }}
        >
          Sin cámara.
          <br />
          Sin set.
          <br />
          <span className="text-accent">Solo dirige.</span>
        </h2>
      </section>

      {/* Acceso */}
      <main className="relative flex min-w-0 flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className="absolute right-6 top-6 sm:right-7 sm:top-7">
          <ThemeToggle />
        </div>

        <div className="login-rise flex w-full max-w-[420px] flex-col gap-7" style={{ animationDelay: '120ms' }}>
          <div className="relative h-[72px] w-[72px]">
            <span
              aria-hidden
              className="absolute -inset-3.5 bg-accent/12"
              style={{ borderRadius: '42% 58% 55% 45% / 50% 44% 56% 50%' }}
            />
            <LuloMark size={72} variant="detail" className="relative" title="Lulo Studio" />
          </div>

          <div className="flex flex-col gap-3.5">
            <h1
              className="font-display text-[52px] font-black leading-[0.95] tracking-[-0.04em]"
              style={{ fontStretch: '122%' }}
            >
              Entra al
              <br />
              estudio.
            </h1>
            <p className="text-base leading-relaxed text-fg-muted">Continúa con tu cuenta de Google.</p>
          </div>

          <div className="flex flex-col gap-2.5" aria-live="polite">
            {phase === 'done' ? (
              <div className="flex h-[58px] w-full items-center justify-center gap-3 rounded-2xl bg-brand text-base font-extrabold text-brand-fg">
                <span className="login-pop flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#0a0a0b]">
                  <Check className="h-3.5 w-3.5 text-brand" strokeWidth={3.2} />
                </span>
                ¡Listo! Entrando al estudio…
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogle}
                disabled={phase === 'loading'}
                className="login-gbtn flex h-[58px] w-full items-center justify-center gap-3 rounded-2xl border border-line-strong bg-white text-base font-bold text-[#1f1f1f] disabled:cursor-progress dark:border-transparent"
              >
                {phase === 'loading' ? (
                  <>
                    <svg className="login-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="9" stroke="#e4e4e0" strokeWidth="3" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="#4285F4" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Conectando con Google…
                  </>
                ) : (
                  <>
                    <GoogleIcon />
                    Continuar con Google
                  </>
                )}
              </button>
            )}
            {error && <p className="text-[13px] text-rose-500">{error}</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
