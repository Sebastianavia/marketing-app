'use client';

import React, { useRef, useState } from 'react';
import { AtSign } from 'lucide-react';
import { fold, tagKindLabel } from '@/lib/director-mode/mentions';
import type { DirectorTag } from '@/lib/director-mode/types';

/**
 * Textarea con @: al escribir "@" sale la lista de etiquetas del proyecto (flechas, Enter o Tab para elegir, Esc para cerrar).
 * Si la lista está abierta, Enter elige en vez de enviar.
 */

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  tags?: DirectorTag[];
  /** Botón @ dentro de la caja (en el chat). */
  atButton?: boolean;
};

export function MentionTextarea({ value, onChange, tags, atButton, onKeyDown, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const q = query ? fold(query.text) : '';
  const matches = query ? (tags ?? []).filter((t) => fold(t.mencion).startsWith(q) || fold(t.nombre).includes(q)).slice(0, 6) : [];

  const detect = (v: string, caret: number) => {
    const m = /(^|\s)@([\p{L}\p{N}_]*)$/u.exec(v.slice(0, caret));
    setQuery(m ? { start: caret - m[2].length - 1, text: m[2] } : null);
    setActive(0);
  };

  const pick = (t: DirectorTag) => {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${t.mencion} `;
    onChange(value.slice(0, query.start) + insert + value.slice(caret));
    const pos = query.start + insert.length;
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const insertAt = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const sep = caret > 0 && !/\s/.test(value[caret - 1]) ? ' ' : '';
    const next = value.slice(0, caret) + sep + '@' + value.slice(caret);
    onChange(next);
    const pos = caret + sep.length + 1;
    setQuery({ start: pos - 1, text: '' });
    setActive(0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(matches[Math.min(active, matches.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={`${className ?? ''} ${atButton ? 'pr-8' : ''}`}
        aria-autocomplete="list"
        {...rest}
      />
      {atButton && tags && tags.length > 0 && (
        <button
          type="button"
          onClick={insertAt}
          disabled={rest.disabled}
          className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          aria-label="Nombrar una etiqueta con @"
          title="Nombrar una etiqueta con @"
        >
          <AtSign className="h-3.5 w-3.5" />
        </button>
      )}
      {matches.length > 0 && (
        <ul role="listbox" className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-card)]">
          {matches.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${i === active ? 'bg-surface-2 text-fg' : 'text-fg-muted'}`}
              >
                <span aria-hidden>{tagKindLabel(t.tipo).icono}</span>
                <span className="font-medium">@{t.mencion}</span>
                <span className="truncate text-[11px] text-fg-subtle">{t.nombre !== t.mencion ? t.nombre : tagKindLabel(t.tipo).label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
