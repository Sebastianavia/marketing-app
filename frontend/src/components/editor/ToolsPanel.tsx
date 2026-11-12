'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Cpu, Download, Loader2, RefreshCw } from 'lucide-react';
import type { EnvStatus, InstallJob, InstallTarget } from '@/lib/editor/python-env';
import { editorApi, type SystemStatus } from './editor-api';
import { Segmented } from './ProfilesPanel';
import { ClaudeToolsSection } from './ClaudeToolsSection';
import type { ClaudeToolbox } from '@/lib/editor/claude-toolbox';

/**
 * Herramientas avanzadas (opcionales): Python, PyTorch, modelo de recorte y Whisper.
 * Cada cosa se instala con un botón y se ve el registro. Solo hace falta una vez por PC.
 */

interface Row {
  label: string;
  para: string;
  ok: boolean;
  detalle: string;
  install?: { que: InstallTarget; texto: string; aviso?: string };
  needs?: boolean;
}

export function ToolsPanel({ system }: { system: SystemStatus | null }) {
  const [estado, setEstado] = useState<EnvStatus | null>(null);
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [claude, setClaude] = useState<ClaudeToolbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (detectar = false) => {
    setChecking(true);
    try {
      const d = await editorApi.env(detectar);
      setEstado(d.estado);
      setJobs(d.instalaciones);
      setClaude(d.claude);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo comprobar.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    editorApi
      .env()
      .then((d) => {
        if (!alive) return;
        setEstado(d.estado);
        setJobs(d.instalaciones);
        setClaude(d.claude);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'No se pudo comprobar.'));
    return () => {
      alive = false;
    };
  }, []);

  const running = jobs.some((j) => j.estado === 'corriendo');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      editorApi
        .env(false)
        .then((d) => {
          setJobs(d.instalaciones);
          if (!d.instalaciones.some((j) => j.estado === 'corriendo')) void load(true);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [running, load]);

  const install = async (que: InstallTarget) => {
    setError(null);
    try {
      const d = await editorApi.install(que);
      setJobs((j) => [...j, d.instalacion]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar la instalación.');
    }
  };

  const setAjuste = async (patch: Parameters<typeof editorApi.envSettings>[0]) => {
    try {
      await editorApi.envSettings(patch);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  };

  if (!estado) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Comprobando tu PC… {error && <span className="text-rose-600">{error}</span>}
      </div>
    );
  }

  const py = estado.python;
  const gpu = estado.nvidia || py?.gpu;
  const win = estado.plataforma === 'win32';
  const rows: Row[] = [
    {
      label: 'FFmpeg',
      para: 'Todo el video y el audio (obligatorio)',
      ok: !!system?.ffmpeg && !!system?.subtitulos,
      detalle: system?.ffmpeg ? `${system.ffmpeg}${system.subtitulos ? '' : ' · sin libass (no puede poner subtítulos)'}` : 'No encontrado',
    },
    {
      label: 'Python',
      para: 'Recorte del fondo y Whisper',
      ok: !!py,
      detalle: py ? `Python ${py.python} (${py.cmd} ${py.args.join(' ')})` : 'No encontrado (hace falta 3.9 o superior)',
      install: win ? { que: 'python', texto: 'Instalar Python 3.12', aviso: 'Usa winget de Windows.' } : undefined,
    },
    {
      label: 'PyTorch',
      para: 'Motor de IA en tu PC',
      ok: !!py?.torch,
      needs: !py,
      detalle: py?.torch
        ? `PyTorch ${py.torch} · ${py.cuda ? `tarjeta NVIDIA (${py.gpu})` : py.mps ? 'Mac (MPS)' : 'CPU (más lento)'}`
        : py?.torchError || 'No instalado',
      install: py
        ? {
            que: 'torch',
            texto: gpu ? 'Instalar PyTorch con NVIDIA (~2,5 GB)' : 'Instalar PyTorch para CPU (~200 MB)',
          }
        : undefined,
    },
    {
      label: 'Modelo de recorte',
      para: 'Texto detrás de tu cabeza (RobustVideoMatting, GPL-3.0)',
      ok: estado.modelos.some((m) => m.listo),
      detalle: estado.modelos.filter((m) => m.listo).map((m) => `${m.id} (${m.mb} MB)`).join(', ') || 'No descargado',
      install: { que: gpu ? 'modelo-resnet50' : 'modelo-mobilenetv3', texto: gpu ? 'Descargar modelo de calidad (103 MB)' : 'Descargar modelo rápido (15 MB)' },
    },
    {
      label: 'Detector de caras',
      para: 'Que los gráficos nunca te tapen la cara (OpenCV, ~40 MB)',
      ok: !!py?.opencv,
      needs: !py,
      detalle: py?.opencv ? 'Instalado' : 'No instalado',
      install: py ? { que: 'opencv', texto: 'Instalar detector de caras' } : undefined,
    },
    {
      label: 'Whisper',
      para: 'Transcripción gratis en tu PC',
      ok: !!py?.whisper && !!py?.torch,
      needs: !py?.torch,
      detalle: py?.whisper ? 'Instalado' : 'No instalado',
      install: py?.torch ? { que: 'whisper', texto: 'Instalar Whisper' } : undefined,
    },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Herramientas de tu PC</h2>
          <p className="max-w-[70ch] text-[12px] text-fg-muted">
            Lo básico (cortes, subtítulos, sonido) solo necesita FFmpeg. Para el texto detrás de tu cabeza y la transcripción gratis, instala lo de abajo. Se
            hace una vez por PC. {gpu ? `Tarjeta detectada: ${gpu}.` : 'No se detectó tarjeta NVIDIA: funcionará con la CPU, más lento.'}
          </p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={checking || running} className="btn-secondary h-8 px-3 text-[12px]">
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Comprobar de nuevo
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg">
                  {r.label} <span className="font-normal text-fg-subtle">· {r.para}</span>
                </p>
                <p className="truncate text-[12px] text-fg-muted">{r.detalle}</p>
              </div>
            </div>
            {!r.ok && r.install && (
              <button type="button" disabled={running} onClick={() => void install(r.install!.que)} className="btn-primary h-8 shrink-0 px-3 text-[12px]" title={r.install.aviso}>
                <Download className="h-3.5 w-3.5" /> {r.install.texto}
              </button>
            )}
            {!r.ok && !r.install && r.needs && <span className="text-[11px] text-fg-subtle">Primero lo de arriba</span>}
          </li>
        ))}
      </ul>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Cpu className="h-4 w-4" /> Cómo transcribir
        </h3>
        <Segmented
          value={estado.ajustes.transcriptor}
          options={[
            { id: 'elevenlabs', label: 'ElevenLabs (preciso, ~$0.004/min)' },
            { id: 'whisper', label: `Whisper en mi PC (gratis)${estado.whisperListo ? '' : ' · no instalado'}` },
          ]}
          onChange={(v) => void setAjuste({ transcriptor: v })}
        />
        {estado.ajustes.transcriptor === 'whisper' && (
          <div className="space-y-1">
            <p className="text-[12px] text-fg-muted">Modelo de Whisper</p>
            <Segmented
              value={estado.ajustes.whisperModelo}
              options={[
                { id: 'turbo', label: 'Turbo (mejor, ideal con NVIDIA)' },
                { id: 'small', label: 'Small (bien sin tarjeta)' },
                { id: 'base', label: 'Base (rápido, menos preciso)' },
              ]}
              onChange={(v) => void setAjuste({ whisperModelo: v })}
            />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-[12px] text-fg-muted">Modelo de recorte</p>
          <Segmented
            value={estado.ajustes.recorteModelo}
            options={[
              { id: 'auto', label: 'Automático' },
              { id: 'resnet50', label: 'Calidad (resnet50)' },
              { id: 'mobilenetv3', label: 'Rápido (mobilenet)' },
            ]}
            onChange={(v) => void setAjuste({ recorteModelo: v })}
          />
        </div>
      </section>

      {claude && <ClaudeToolsSection data={claude} />}

      {jobs.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-fg">Instalaciones</h3>
          {[...jobs].reverse().map((j) => (
            <details key={j.id} open={j.estado !== 'ok'} className="rounded-xl border border-line bg-surface p-3">
              <summary className="flex cursor-pointer items-center gap-2 text-[12px] text-fg">
                {j.estado === 'corriendo' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : j.estado === 'ok' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                )}
                {j.que} · {j.estado === 'corriendo' ? 'instalando…' : j.estado === 'ok' ? 'listo' : 'falló'}
              </summary>
              <pre className="desktop-scroll mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-fg-muted">{j.log || '…'}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
