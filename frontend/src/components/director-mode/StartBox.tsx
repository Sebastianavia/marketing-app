'use client';

import React, { useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { DEFAULT_SKILL, DIRECTOR_SKILLS, getDirectorSkill, type DirectorSkillId } from '@/config/director-skills';
import { VOICE_MODES } from '@/config/broll-models';
import type { DraftRow } from './useDirectorMode';
import { readFileAsDataUrl } from './stage-forms';

/**
 * Caja de inicio del modo Director (estilo Buzzy): skill + idea o guion + referencias.
 * "+ Ref": un PDF se usa ya como material; las fotos se muestran pero TODAVÍA NO SE GUARDAN
 * (agruparlas en personas, lugares y productos es el paso 2).
 */

interface Props {
  busy: boolean;
  drafts: DraftRow[];
  onStart: (entrada: Record<string, unknown>) => void;
  onOpen: (id: string) => void;
  onCancel?: () => void;
}

interface PhotoRef {
  name: string;
  url: string;
}

/** ¿Parece un guion ya escrito? (varias frases y más de 25 palabras) */
function looksLikeScript(t: string) {
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const sentences = (t.match(/[.!?¿¡…]/g) ?? []).length;
  return words > 25 && sentences >= 2;
}

export function StartBox({ busy, drafts, onStart, onOpen, onCancel }: Props) {
  const [skillId, setSkillId] = useState<DirectorSkillId>(DEFAULT_SKILL);
  const [texto, setTexto] = useState('');
  const [keep, setKeep] = useState(true);
  const [confidencial, setConfidencial] = useState(false);
  const [pdf, setPdf] = useState<{ name: string; dataUrl: string } | null>(null);
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const skill = getDirectorSkill(skillId)!;
  const isScript = !pdf && looksLikeScript(texto);

  const addRefs = async (files: FileList | null) => {
    if (!files) return;
    setNote(null);
    const list = Array.from(files);
    const pdfs = list.filter((f) => f.type === 'application/pdf');
    const imgs = list.filter((f) => f.type.startsWith('image/'));
    if (pdfs.length) {
      const f = pdfs[0];
      if (f.size > 20 * 1024 * 1024) setNote('El PDF debe pesar menos de 20 MB.');
      else setPdf({ name: f.name, dataUrl: await readFileAsDataUrl(f) });
      if (pdfs.length > 1) setNote('Por ahora se usa un solo PDF: tomé el primero.');
    }
    if (imgs.length) setPhotos((cur) => [...cur, ...imgs.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))].slice(0, 14));
    if (list.length > pdfs.length + imgs.length) setNote('Solo se admiten PDF e imágenes.');
  };

  const removePhoto = (i: number) =>
    setPhotos((cur) => {
      URL.revokeObjectURL(cur[i].url);
      return cur.filter((_, j) => j !== i);
    });

  const start = () => {
    if (!pdf && !texto.trim()) return setNote('Escribe la idea, pega el guion o añade un PDF con + Ref.');
    onStart({
      tipo: pdf ? 'pdf' : isScript ? 'guion' : 'idea',
      texto,
      mantenerPalabras: isScript && keep,
      confidencial,
      skill: skillId,
      ...(pdf ? { pdfBase64: pdf.dataUrl, pdfNombre: pdf.name } : {}),
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 py-4">
      <h2 className="text-center font-display text-[22px] text-fg">¿Qué video hacemos?</h2>

      {/* Skill */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de video">
        {DIRECTOR_SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={skillId === s.id}
            onClick={() => setSkillId(s.id)}
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              skillId === s.id ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="block text-[13px] font-medium text-fg">
              <span aria-hidden>{s.icono}</span> {s.nombre}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{s.descripcion}</span>
          </button>
        ))}
      </div>

      {/* Caja */}
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)] focus-within:border-line-strong">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder={pdf ? 'Indicaciones sobre el PDF (opcional): producto, público, qué destacar…' : skill.placeholder}
          className="w-full resize-y bg-transparent p-1 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
          aria-label="Idea o guion"
        />

        {(pdf || photos.length > 0) && (
          <div className="mt-2 space-y-2 border-t border-line pt-2">
            {pdf && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg">
                <FileText className="h-3.5 w-3.5 text-fg-subtle" /> {pdf.name}
                <span className="text-[10.5px] text-emerald-700 dark:text-emerald-400">se usa como material</span>
                <button type="button" onClick={() => setPdf(null)} aria-label="Quitar el PDF" className="cursor-pointer text-fg-subtle hover:text-fg">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {photos.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
                <p className="flex items-start gap-1.5 text-[12px] text-amber-900 dark:text-amber-200">
                  <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Estas fotos todavía no se guardan.</strong> Agruparlas en personas, lugares y productos llega en el paso 2;
                    por ahora no se envían ni quedan en el borrador.
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {photos.map((p, i) => (
                    <span key={p.url} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.name} className="h-12 w-12 rounded-md object-cover opacity-70" />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label={`Quitar ${p.name}`}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-fg text-bg"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-2 text-[12px] text-fg-muted">
          <input ref={fileInput} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => {
            void addRefs(e.target.files);
            e.target.value = '';
          }} />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn-secondary h-8 px-2.5 text-[12px]"
            title="Un PDF se usa ya como material. Las fotos todavía no se guardan (paso 2)."
          >
            <Paperclip className="h-3.5 w-3.5" /> + Ref
          </button>
          {isScript && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Mantener mis palabras
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-1.5" title="Gemini gratis puede usar los datos para mejorar productos de Google">
            <input type="checkbox" checked={confidencial} onChange={(e) => setConfidencial(e.target.checked)} />
            Confidencial
          </label>
          <div className="ml-auto flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn-secondary h-8 px-3 text-[12px]">
                Volver al borrador
              </button>
            )}
            <button type="button" onClick={start} disabled={busy} className="btn-primary h-8 px-4 text-[12.5px]">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Empezar
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          + Ref: un PDF se usa ya como material. Las fotos todavía no se guardan: llega en el paso 2.
          {confidencial ? ' Confidencial: se usa Claude Haiku (de pago, menos de 1 ¢ por paso), no Gemini gratis.' : ''}
        </p>
        {note && <p className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">{note}</p>}
      </div>

      <p className="text-[11.5px] text-fg-subtle">
        {skill.nombre}: {skill.ajustes.formato} · {skill.ajustes.duracionSeg} s · {VOICE_MODES.find((v) => v.id === skill.ajustes.modoVoz)?.label}. Lo
        confirmas en Ajustes antes del guion.
      </p>

      {/* Ejemplos */}
      <div className="flex flex-wrap gap-1.5">
        {skill.ejemplos.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setTexto(e)}
            className="rounded-full border border-line px-3 py-1 text-left text-[12px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
          >
            {e}
          </button>
        ))}
      </div>

      {drafts.length > 0 && (
        <div>
          <p className="text-[12px] text-fg-subtle">Seguir con un borrador</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {drafts.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
                >
                  {r.nombre} · {new Date(r.actualizada).toLocaleDateString('es')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
