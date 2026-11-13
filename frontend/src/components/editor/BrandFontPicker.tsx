'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';

/** Fuentes que trae HyperFrames (sirven sin instalar en el kit). */
const BUNDLED = ['Archivo Black', 'Montserrat', 'Oswald', 'League Gothic', 'Poppins', 'Inter', 'Outfit', 'Nunito', 'Playfair Display', 'EB Garamond', 'Space Mono', 'Roboto', 'Lato', 'Open Sans'];

/** Las que pide el estándar ETM (Santiago Ruiz), listas para descargar de Google Fonts. */
const SUGERIDAS: Array<{ familia: string; peso: number; para: string }> = [
  { familia: 'Sora', peso: 600, para: 'Subtítulos (SemiBold)' },
  { familia: 'Anton', peso: 400, para: 'Palabra grande' },
  { familia: 'Prata', peso: 400, para: 'Título del gancho' },
];

interface Installed {
  archivo: string;
  nombre: string;
}

/**
 * Tipografía de la marca: elegir entre las incluidas y las instaladas, ver cómo queda (subtítulo,
 * palabra grande y título del gancho con los colores de la marca) y descargar fuentes de Google
 * Fonts (licencia OFL) a la carpeta de fuentes de Lulo, que usan subtítulos, kit y portada.
 */
export function BrandFontPicker({ value, onChange, colores }: { value: string; onChange: (v: string) => void; colores: { primario: string; acento: string; texto: string } }) {
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [familia, setFamilia] = useState('');
  const [peso, setPeso] = useState(400);

  const load = useCallback(async () => {
    const r = await fetch('/api/editor/fonts', { cache: 'no-store' }).catch(() => null);
    const d = r?.ok ? await r.json() : { fuentes: [] };
    setInstalled(d.fuentes ?? []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const install = async (fam: string, w: number) => {
    setBusy(`${fam}-${w}`);
    setError(null);
    try {
      const r = await fetch('/api/editor/fonts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familia: fam, pesos: [w] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo descargar.');
      setInstalled(d.fuentes ?? []);
      const nombre = d.instaladas?.[0]?.nombre;
      if (nombre) onChange(nombre);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar.');
    } finally {
      setBusy(null);
    }
  };

  const isInstalled = (fam: string, w: number) => installed.some((f) => f.archivo.toLowerCase() === `${fam.replace(/\s+/g, '')}-${w}.ttf`.toLowerCase());
  const names = [...new Set(installed.map((f) => f.nombre))];
  const options = [...names, ...BUNDLED.filter((b) => !names.includes(b))];
  if (value && !options.includes(value)) options.unshift(value);

  // Para la vista previa: las instaladas se cargan desde la carpeta de fuentes; las incluidas, de Google Fonts
  const faceCss = installed.map((f) => `@font-face{font-family:'${f.nombre.replace(/'/g, '')}';src:url('/api/editor/fonts?archivo=${encodeURIComponent(f.archivo)}')}`).join('\n');
  const bundledHref = BUNDLED.includes(value) ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(value).replace(/%20/g, '+')}:wght@400;600;700;900&display=swap` : null;
  const ff = `'${value.replace(/'/g, '')}', sans-serif`;

  return (
    <div className="space-y-2.5 rounded-lg border border-line p-3">
      <style>{faceCss}</style>
      {bundledHref && <link rel="stylesheet" href={bundledHref} />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-fg">Tipografía</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="input-clean h-8 px-2 text-[12px]" aria-label="Tipografía de la marca">
          {names.length > 0 && (
            <optgroup label="Instaladas en este PC">
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Incluidas">
            {options
              .filter((o) => !names.includes(o))
              .map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
          </optgroup>
        </select>
      </div>

      {/* Vista previa con los colores de la marca */}
      <div className="space-y-2 rounded-lg px-4 py-4" style={{ background: colores.primario }} aria-label="Vista previa de la tipografía">
        <p style={{ fontFamily: ff, color: colores.texto, fontSize: 30, lineHeight: 1.1 }}>
          Título del <span style={{ color: colores.acento }}>gancho</span>
        </p>
        <p style={{ fontFamily: ff, color: colores.texto, fontSize: 18, textShadow: '0 0 8px rgba(0,0,0,.6)' }}>
          estas son las <span style={{ color: colores.acento }}>herramientas</span> que uso
        </p>
        <p style={{ fontFamily: ff, color: colores.acento, fontSize: 44, lineHeight: 1, textTransform: 'uppercase' }}>9 gratis</p>
        <p className="text-[10px]" style={{ color: colores.texto, opacity: 0.6 }}>
          {value} · Aa Bb Cc Ññ 0123456789
        </p>
      </div>

      {/* Descargar de Google Fonts */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-fg-muted">Descargar de Google Fonts (licencia libre OFL). Quedan en la carpeta de fuentes de este PC y sirven para subtítulos, gráficos y portada:</p>
        <div className="flex flex-wrap gap-2">
          {SUGERIDAS.map((s) => {
            const k = `${s.familia}-${s.peso}`;
            const ok = isInstalled(s.familia, s.peso);
            return (
              <button key={k} type="button" disabled={!!busy || ok} onClick={() => void install(s.familia, s.peso)} className="btn-secondary h-8 px-2.5 text-[11px]" title={s.para}>
                {busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ok ? <Check className="h-3.5 w-3.5 text-accent" /> : <Download className="h-3.5 w-3.5" />}
                {s.familia} {s.peso === 600 ? 'SemiBold' : ''} <span className="text-fg-subtle">· {s.para}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={familia} onChange={(e) => setFamilia(e.target.value)} maxLength={40} placeholder="Otra familia (p. ej. Bebas Neue)" className="input-clean h-8 w-56 px-2 text-[12px]" />
          <select value={peso} onChange={(e) => setPeso(Number(e.target.value))} className="input-clean h-8 px-2 text-[12px]" aria-label="Peso">
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button type="button" disabled={!!busy || familia.trim().length < 2} onClick={() => void install(familia.trim(), peso)} className="btn-secondary h-8 px-2.5 text-[11px]">
            {busy === `${familia.trim()}-${peso}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Descargar
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
