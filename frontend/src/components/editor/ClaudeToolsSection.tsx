'use client';

import React from 'react';
import { Bot, CheckCircle2, Circle, Download, Loader2 } from 'lucide-react';
import type { ClaudeToolbox } from '@/lib/editor/claude-toolbox';

/** Lo que los Claude de la app pueden usar en este PC, incluido lo que se han instalado ellos mismos. */
export function ClaudeToolsSection({ data, preparing = false, onPrepare }: { data: ClaudeToolbox; preparing?: boolean; onPrepare?: () => void }) {
  const row = (ok: boolean, label: string, detalle: string, para?: string) => (
    <li className="flex items-start gap-3 px-4 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />}
      <div className="min-w-0">
        <p className="text-[13px] text-fg">
          {label}
          {para && <span className="text-fg-muted"> · {para}</span>}
        </p>
        <p className="text-[12px] text-fg-subtle">{detalle}</p>
      </div>
    </li>
  );
  const conocidos = data.python.paquetes.filter((p) => p.para);
  const otros = data.python.paquetes.filter((p) => !p.para);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-[80ch]">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          <Bot className="h-4 w-4 text-accent" /> Herramientas de Claude
        </h3>
        <p className="text-[12px] text-fg-muted">
          Lo que Claude puede usar al editar en este PC, incluido lo que se ha instalado él mismo. Ocupa {data.totalMb >= 1024 ? `${(data.totalMb / 1024).toFixed(1)} GB` : `${data.totalMb} MB`} en{' '}
          <span className="font-mono text-[11px]">{data.carpeta}</span>. Cada PC tiene las suyas: Claude instala lo que le falte la primera vez que lo necesita (macOS y Windows), o lo dejas listo de una vez con el botón.
        </p>
      </div>
      {onPrepare && (
        <button type="button" onClick={onPrepare} disabled={preparing} className="btn-secondary h-9 shrink-0 px-3 text-[12px]" title="Instala el kit base (NumPy, SciPy, OpenCV, MediaPipe, FontTools) y el Chrome de HyperFrames">
          {preparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Preparar herramientas de Claude
        </button>
      )}
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {row(data.claudeCode.instalado, 'Claude Code', data.claudeCode.version ? `Versión ${data.claudeCode.version}` : 'No instalado', 'El editor, director y estudio con tu suscripción')}
        {row(true, 'Node.js', `Versión ${data.node}`, 'Ejecuta HyperFrames y otras herramientas')}
        {row(
          data.hyperframes.chrome,
          'HyperFrames',
          `Versión ${data.hyperframes.version} · Chrome propio ${data.hyperframes.chrome ? 'descargado' : 'se descarga en el primer render'} · quitar fondos ${data.hyperframes.quitarFondo ? 'listo' : 'se descarga al usarlo'}`,
          'Gráficos y animaciones de diseño'
        )}
        {row(data.skills.length > 0, 'Skills de video', data.skills.join(', '), 'Lo que Claude sabe de edición y diseño')}
        {data.programas.map((p) => (
          <React.Fragment key={p.nombre}>{row(true, p.nombre, p.ruta, p.para)}</React.Fragment>
        ))}
      </ul>

      <div className="space-y-2">
        <p className="text-[12px] font-medium text-fg">Paquetes de Python que Claude se ha instalado ({data.python.paquetes.length})</p>
        {data.python.paquetes.length === 0 ? (
          <p className="text-[12px] text-fg-subtle">Ninguno todavía: Claude los instala cuando los necesita.</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {conocidos.map((p) => (
                <li key={p.nombre} className="rounded-lg border border-line bg-surface px-3 py-2">
                  <p className="text-[12px] text-fg">
                    {p.nombre} <span className="text-fg-subtle">{p.version}</span>
                  </p>
                  <p className="text-[11px] text-fg-muted">{p.para}</p>
                </li>
              ))}
            </ul>
            {otros.length > 0 && (
              <details className="text-[11px] text-fg-subtle">
                <summary className="cursor-pointer hover:text-fg-muted">Dependencias ({otros.length})</summary>
                <p className="mt-1">{otros.map((p) => `${p.nombre} ${p.version}`).join(' · ')}</p>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
