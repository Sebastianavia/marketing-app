'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle, Gauge, RefreshCw } from 'lucide-react';
import { useUgcStudioStore } from '@/store/useUgcStudioStore';

interface SlotReport {
  id: string;
  keyIndex: number;
  keyMasked: string;
  model: string;
  reserve: boolean;
  status: 'ok' | 'cooldown' | 'exhausted' | 'not_free';
  rpmUsed: number;
  rpdUsed: number;
  rpdRemaining: number;
  rpdRemainingPct: number;
  cooldownMs: number;
  limits: { rpm: number; rpd: number; tpm: number };
}

const STATUS_STYLE: Record<SlotReport['status'], string> = {
  ok: 'bg-emerald-500',
  cooldown: 'bg-amber-500',
  exhausted: 'bg-rose-500',
  not_free: 'bg-slate-400',
};

const STATUS_LABEL: Record<SlotReport['status'], string> = {
  ok: 'Disponible',
  cooldown: 'En pausa',
  exhausted: 'Agotada hoy',
  not_free: 'Sin capa gratuita',
};

/** Medidores de cuota por llave × modelo (contador local; Google no expone la cuota restante). */
function QuotaMeters({ refreshKey }: { refreshKey: number }) {
  const [slots, setSlots] = useState<SlotReport[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (rediscover = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ugc-studio/quota${rediscover ? '?rediscover=1' : ''}`);
      const data = await res.json();
      if (res.ok) setSlots(data.slots);
    } catch {
      // red caída o servidor reiniciándose: se reintenta en la siguiente consulta periódica
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  const keys = [...new Set(slots.map((s) => s.keyIndex))];
  const models = [...new Set(slots.map((s) => s.model))];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Gauge className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[11px] font-semibold text-slate-700 dark:text-zinc-300">Cuota Gemini (requests hoy)</p>
        <button
          type="button"
          onClick={() => void load(true)}
          className="ml-auto text-slate-400 hover:text-indigo-500"
          title="Volver a detectar los modelos más recientes de la capa gratuita"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-slate-500 dark:text-zinc-500">
              <th className="text-left font-normal pr-2">Modelo</th>
              {keys.map((k) => (
                <th key={k} className="font-normal px-1">
                  Llave {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model}>
                <td className="pr-2 py-0.5 font-mono text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                  {model.replace('gemini-', '')}
                  {slots.find((s) => s.model === model)?.reserve && <span className="ml-1 text-slate-400">(reserva)</span>}
                </td>
                {keys.map((k) => {
                  const s = slots.find((x) => x.model === model && x.keyIndex === k);
                  if (!s) return <td key={k} />;
                  return (
                    <td key={k} className="px-1 py-0.5" title={`${s.keyMasked} · ${STATUS_LABEL[s.status]} · RPM ${s.rpmUsed}/${s.limits.rpm}`}>
                      <div className="h-1.5 w-full min-w-10 rounded-full bg-slate-200 dark:bg-white/[0.06] overflow-hidden">
                        <div
                          className={`h-full ${STATUS_STYLE[s.status]}`}
                          style={{ width: `${Math.max(4, Math.round(s.rpdRemainingPct * 100))}%` }}
                        />
                      </div>
                      <p className="text-center text-slate-500 dark:text-zinc-500 tabular-nums">
                        {s.rpdUsed}/{s.limits.rpd}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-zinc-600 leading-snug">
        Conteo local contra los límites de la capa gratuita (se ajustan solos al recibir un 429). Si varias llaves
        son del mismo proyecto de Google Cloud, comparten cuota.
      </p>
    </div>
  );
}

export function AgentActivityPanel() {
  const activities = useUgcStudioStore((s) => s.activities);
  const phase = useUgcStudioStore((s) => s.phase);
  const busy = useUgcStudioStore((s) => s.busy);
  const doneCount = activities.filter((a) => a.status === 'done').length;

  return (
    <div className="surface-card rounded-xl p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">Equipo de agentes</p>
          {activities.length > 0 && (
            <span className="text-[10px] font-mono text-slate-500">
              {doneCount}/{activities.length}
            </span>
          )}
        </div>
        {busy && phase && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-300">
            <Loader2 className="h-3 w-3 animate-spin" /> {phase}…
          </p>
        )}
        {activities.length === 0 && !busy && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">
            Orquestador, analista de referencias, guionista, fotografía, audio, SFX, VFX/transiciones, supervisores y
            continuidad trabajan al enviar el brief.
          </p>
        )}
        <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {activities.map((a) => (
            <li key={a.agentId} className="flex items-center gap-2 text-[11px]">
              {a.status === 'running' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-500" />}
              {a.status === 'done' && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />}
              {a.status === 'error' && <XCircle className="h-3 w-3 shrink-0 text-rose-500" />}
              <span className="text-slate-700 dark:text-zinc-300 truncate" title={a.detail}>
                {a.agentName}
              </span>
              {a.model && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-400 dark:text-zinc-500">
                  #{a.keyIndex} · {a.model.replace('gemini-', '')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-slate-200 dark:border-white/[0.06] pt-3">
        <QuotaMeters refreshKey={doneCount} />
      </div>
    </div>
  );
}
