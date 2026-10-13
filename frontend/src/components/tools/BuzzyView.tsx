'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, ExternalLink } from 'lucide-react';

interface BuzzyStatus {
  configured: boolean;
  hasToken: boolean;
}

/**
 * Buzzy (buzzy.now): plataforma externa de video que se conecta por MCP.
 * Mientras no haya URL ni clave del servidor MCP, la vista explica cómo conectarlo.
 */
export function BuzzyView() {
  const [status, setStatus] = useState<BuzzyStatus | null>(null);

  useEffect(() => {
    fetch('/api/buzzy/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, hasToken: false }));
  }, []);

  const steps = [
    { done: Boolean(status?.configured), label: 'URL del servidor MCP de Buzzy en BUZZY_MCP_URL' },
    { done: Boolean(status?.hasToken), label: 'Clave o token de acceso en BUZZY_MCP_TOKEN' },
    { done: false, label: 'Revisar las herramientas que expone Buzzy y conectarlas a la generación' },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="surface-card p-6 lg:col-span-7">
        <h2 className="text-lg font-semibold text-fg">Conexión con Buzzy</h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-fg-muted">
          Buzzy genera escenas largas y consistentes (Seedance 2.5, Wan 3.0, MiniMax H3) y se conecta a la app por su
          servidor MCP. Su web no publica los datos de conexión, así que hacen falta la URL y la clave de tu cuenta.
        </p>

        <ol className="mt-6 space-y-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3 text-sm">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
              )}
              <span className={s.done ? 'text-fg' : 'text-fg-muted'}>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-xl border border-line bg-surface-2/60 p-4">
          <p className="text-[13px] font-medium text-fg">Añade esto a frontend/.env.local y reinicia la app:</p>
          <pre className="allow-select mt-2 overflow-x-auto text-[12px] leading-relaxed text-fg-muted">{`BUZZY_MCP_URL=https://…
BUZZY_MCP_TOKEN=…`}</pre>
        </div>
      </section>

      <aside className="surface-card p-6 lg:col-span-5">
        <h3 className="text-[15px] font-semibold text-fg">Créditos de Buzzy</h3>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-fg-muted">
          <li>Cobra 10 créditos por segundo de video (un clip de 15 s = 150 créditos).</li>
          <li>Los créditos se compran en la web de Buzzy, no desde esta app.</li>
          <li>Cada generación con Buzzy quedará registrada en Costos, como el resto.</li>
        </ul>
        <a
          href="https://www.buzzy.now/"
          target="_blank"
          rel="noreferrer"
          className="btn-secondary mt-5 h-9 px-3 text-[13px]"
        >
          Abrir Buzzy
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </aside>
    </div>
  );
}
