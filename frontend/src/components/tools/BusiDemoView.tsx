'use client';

import React from 'react';
import { Sparkles, Bot, Layers, ArrowLeft } from 'lucide-react';

interface BusiDemoViewProps {
  onBack: () => void;
}

export function BusiDemoView({ onBack }: BusiDemoViewProps) {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[520px] w-full rounded-3xl border border-white/[0.08] bg-[#0A0E17]/80 p-8 sm:p-12 text-center backdrop-blur-2xl overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      {/* Badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-semibold text-amber-300 mb-6">
        <Sparkles className="h-3.5 w-3.5" />
        <span>MODO DEMO • PRÓXIMAMENTE</span>
      </div>

      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 text-white shadow-xl shadow-amber-500/20 mb-5">
        <Bot className="h-8 w-8" />
      </div>

      {/* Title */}
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
        Busi — Asistente Autónomo de Negocios
      </h2>
      <p className="mt-3 max-w-lg text-xs sm:text-sm text-slate-400 leading-relaxed">
        El copiloto autónomo que analiza las métricas de tus campañas en tiempo real, detecta fatiga de creativos y genera automáticamente nuevas variantes ganadoras sin intervención manual.
      </p>

      {/* Feature Preview Cards */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl text-left">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-white">Auditoría de Retención</p>
          <p className="text-[11px] text-slate-500 mt-1">Análisis fotograma a fotograma de curvas de caída de audiencia.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-white">Generación de Hooks A/B</p>
          <p className="text-[11px] text-slate-500 mt-1">5 variantes de los primeros 3 segundos para pruebas en TikTok Ads.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-white">Auto-Escalado</p>
          <p className="text-[11px] text-slate-500 mt-1">Sincronización directa con Meta Ads Manager y TikTok for Business.</p>
        </div>
      </div>

      {/* Return CTA */}
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.1] px-5 py-2.5 text-xs font-semibold text-white transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al Dashboard
      </button>
    </div>
  );
}
