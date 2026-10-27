'use client';

import React, { useRef, useState } from 'react';
import { FileText, Loader2, Music2, Paperclip, X } from 'lucide-react';
import { DEFAULT_SKILL, DIRECTOR_SKILLS, getDirectorSkill, type DirectorSkillId } from '@/config/director-skills';
import { VOICE_MODES } from '@/config/broll-models';
import type { DraftRow } from './useDirectorMode';
import { readFileAsDataUrl } from './stage-forms';

/**
 * Caja de inicio del modo Director (estilo Buzzy): skill + idea o guion + referencias.
 * "+ Ref": el primer PDF es el material de la idea; fotos, audios y otros PDF se guardan en la carpeta
 * de la producción al empezar y el agente propone etiquetas (personas, lugares, productos, estilo).
 */

interface Props {
  busy: boolean;
  drafts: DraftRow[];
  /** `refs`: archivos que se guardan como referencias del proyecto tras crear el borrador. */
  onStart: (entrada: Record<string, unknown>, refs: File[], locucion?: string) => void;
  onOpen: (id: string) => void;
  onCancel?: () => void;
}

interface PendingRef {
  file: File;
  /** Vista previa (solo fotos). */
  url?: string;
}

const MAX_START_REFS = 20;

/** ¿Parece un guion ya escrito? (varias frases y más de 25 palabras) */
function looksLikeScript(t: string) {
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const sentences = (t.match(/[.!?¿¡…]/g) ?? []).length;
  return words > 25 && sentences >= 2;
}

/** Windows reporta los «.mp3.mpeg» como video/mpeg: también se reconoce el audio por extensión. */
const isAudioFile = (f: File) => f.type.startsWith('audio/') || /\.(mp3|mpeg|mpga|wav|m4a|aac|ogg|flac)$/i.test(f.name);

export function StartBox({ busy, drafts, onStart, onOpen, onCancel }: Props) {
  const [skillId, setSkillId] = useState<DirectorSkillId>(DEFAULT_SKILL);
  const [texto, setTexto] = useState('');
  const [keep, setKeep] = useState(true);
  const [confidencial, setConfidencial] = useState(false);
  const [pdf, setPdf] = useState<{ name: string; dataUrl: string } | null>(null);
  const [refs, setRefs] = useState<PendingRef[]>([]);
  /** Nombre del audio que es la locución del video (null = ninguno). */
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  const audios = refs.filter((r) => isAudioFile(r.file));
  // Si se quitó el audio elegido, no queda elegido
  const voiceFile = voiceChoice && audios.some((r) => r.file.name === voiceChoice) ? voiceChoice : null;
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const skill = getDirectorSkill(skillId)!;
  const isScript = !pdf && looksLikeScript(texto);

  const addRefs = async (files: FileList | null) => {
    if (!files) return;
    setNote(null);
    const list = Array.from(files);
    const pdfs = list.filter((f) => f.type === 'application/pdf');
    const media = list.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || isAudioFile(f));
    const extra: File[] = [...media];
    if (pdfs.length) {
      // El primer PDF (si aún no hay) es el material de la idea; los demás van como referencias
      const [first, ...rest] = pdfs;
      if (!pdf) {
        if (first.size > 20 * 1024 * 1024) setNote('El PDF debe pesar menos de 20 MB.');
        else setPdf({ name: first.name, dataUrl: await readFileAsDataUrl(first) });
        extra.push(...rest);
      } else extra.push(...pdfs);
    }
    if (extra.length) {
      setRefs((cur) => {
        const next = [...cur, ...extra.map((f) => ({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }))];
        if (next.length > MAX_START_REFS) setNote(`Máximo ${MAX_START_REFS} archivos al empezar; luego puedes añadir más desde el chat.`);
        return next.slice(0, MAX_START_REFS);
      });
    }
    if (list.length > pdfs.length + media.length) setNote('Solo se admiten fotos (JPG, PNG, WebP), audio o PDF.');
  };

  const removeRef = (i: number) =>
    setRefs((cur) => {
      if (cur[i].url) URL.revokeObjectURL(cur[i].url!);
      return cur.filter((_, j) => j !== i);
    });

  const start = () => {
    if (!pdf && !texto.trim()) return setNote('Escribe la idea, pega el guion o añade un PDF con + Ref.');
    onStart(
      {
      tipo: pdf ? 'pdf' : isScript ? 'guion' : 'idea',
      texto,
      mantenerPalabras: isScript && keep,
      confidencial,
      skill: skillId,
      ...(pdf ? { pdfBase64: pdf.dataUrl, pdfNombre: pdf.name } : {}),
      },
      refs.map((r) => r.file),
      voiceFile ?? undefined
    );
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

        {(pdf || refs.length > 0) && (
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
            {refs.length > 0 && (
              <div>
                <p className="text-[11.5px] text-fg-muted">
                  Se guardan en la carpeta de la producción al empezar. El agente propondrá etiquetas para las fotos (personas, lugares, productos, estilo) y tú las corriges.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {refs.map((r, i) => (
                    <span key={`${r.file.name}-${i}`} className="relative" title={r.file.name}>
                      {r.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.url} alt={r.file.name} className="h-12 w-12 rounded-md border border-line object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-subtle">
                          {isAudioFile(r.file) ? <Music2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRef(i)}
                        aria-label={`Quitar ${r.file.name}`}
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
          <input ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,audio/*,.mp3,.mpeg,.mpga,.wav,.m4a,.aac,.ogg,.flac" className="hidden" onChange={(e) => {
            void addRefs(e.target.files);
            e.target.value = '';
          }} />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn-secondary h-8 px-2.5 text-[12px]"
            title="Fotos, audio o PDF. Se guardan en la carpeta de la producción."
          >
            <Paperclip className="h-3.5 w-3.5" /> + Ref
          </button>
          {isScript && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Mantener mis palabras
            </label>
          )}
          {audios.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5" title="El video se arma sobre tu audio: mide su duración, lo transcribe y reparte las escenas">
              <input
                type="checkbox"
                checked={Boolean(voiceFile)}
                onChange={(e) => setVoiceChoice(e.target.checked ? audios[0].file.name : null)}
              />
              {audios.length === 1 ? 'El audio es mi locución' : 'Mi locución es'}
              {audios.length > 1 && voiceFile && (
                <select value={voiceFile} onChange={(e) => setVoiceChoice(e.target.value)} className="input-clean h-7 max-w-[160px] px-1.5 text-[11.5px]">
                  {audios.map((r) => (
                    <option key={r.file.name} value={r.file.name}>
                      {r.file.name}
                    </option>
                  ))}
                </select>
              )}
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
          + Ref: fotos de personas, lugares o productos, audio (voz o música) y PDF. El primer PDF es el material de la idea.
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
