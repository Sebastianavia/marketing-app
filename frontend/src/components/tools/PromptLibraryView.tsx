'use client';

import React, { useMemo, useState } from 'react';
import { Check, Copy, ImageIcon, Search, Star, X } from 'lucide-react';
import {
  PROMPT_IMAGE_DIR,
  PROMPT_IMAGE_EXTENSIONS,
  PROMPT_LIBRARY,
  type PhraseList,
  type PromptCard,
  type PromptGroup,
  type PromptSection,
} from '@/config/prompt-library';

/**
 * Biblioteca de prompts: índice lateral + secciones A (imagen), B (video) y C (formatos).
 * Cada tarjeta trae un recuadro para la imagen de ejemplo: si existe
 * `public/prompt-library/<id>.(webp|jpg|png)` se muestra; si no, queda el hueco listo.
 */

/* ------------------------------- utilidades ------------------------------- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Respaldo para contextos sin permiso de portapapeles.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    }
  };
  return { copied, copy };
}

/** Resalta los huecos [así] que el usuario debe rellenar. */
function PromptText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <mark key={i} className="rounded bg-accent/12 px-0.5 font-semibold text-accent">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

const KIND_LABEL: Record<PromptCard['kind'], string> = { foto: 'Foto', video: 'Video', texto: 'Texto' };

function matches(card: PromptCard, q: string) {
  if (!q) return true;
  return `${card.title} ${card.prompt}`.toLowerCase().includes(q);
}

function filterGroup(group: PromptGroup, q: string): PromptGroup | null {
  if (!q) return group;
  const blocks = group.blocks
    .map((b) => ({
      ...b,
      cards: b.cards?.filter((c) => matches(c, q)),
      lists: b.lists
        ?.map((l) => ({ ...l, items: l.items.filter((it) => `${it.es} ${it.en}`.toLowerCase().includes(q)) }))
        .filter((l) => l.items.length > 0),
      table: undefined,
      note: undefined,
      intro: undefined,
    }))
    .filter((b) => (b.cards?.length ?? 0) > 0 || (b.lists?.length ?? 0) > 0);
  return blocks.length ? { ...group, intro: undefined, blocks } : null;
}

/* ------------------------------ imagen ejemplo ----------------------------- */

function PromptImage({ id, title, refs }: { id: string; title: string; refs?: string[] }) {
  const [extIndex, setExtIndex] = useState(0);
  const missing = extIndex >= PROMPT_IMAGE_EXTENSIONS.length;
  const src = missing ? null : `${PROMPT_IMAGE_DIR}/${id}.${PROMPT_IMAGE_EXTENSIONS[extIndex]}`;

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden border-y border-line bg-surface-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setExtIndex((i) => i + 1)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-3 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-center">
          <ImageIcon className="h-6 w-6 text-fg-subtle" />
          <p className="text-[12px] font-medium text-fg-muted">Tu imagen aquí</p>
          <p className="px-4 font-mono text-[10px] text-fg-subtle">public/prompt-library/{id}.webp</p>
        </div>
      )}

      {refs && refs.length > 0 && (
        <div className="absolute bottom-2.5 right-2.5 flex gap-1.5">
          {refs.map((r) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded bg-accent px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-wide text-accent-fg">
                {r}
              </span>
              <span className="flex h-12 w-10 items-center justify-center rounded-md border border-dashed border-line-strong bg-surface/80 backdrop-blur">
                <ImageIcon className="h-3.5 w-3.5 text-fg-subtle" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- tarjetas -------------------------------- */

function CopyButton({ done, onClick, label = 'copiar' }: { done: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
        done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-accent text-accent-fg hover:bg-accent-hover'
      }`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'copiado' : label}
    </button>
  );
}

function Card({ card, copied, onCopy }: { card: PromptCard; copied: boolean; onCopy: () => void }) {
  return (
    <article className="surface-card flex flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
          <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
          <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
        </span>
        <h4 className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-fg" title={card.title}>
          {card.featured && <Star className="mr-1 inline h-3 w-3 -translate-y-px fill-accent text-accent" />}
          {card.title}
        </h4>
        <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-subtle">
          {KIND_LABEL[card.kind]}
        </span>
        <CopyButton done={copied} onClick={onCopy} />
      </header>

      {!card.noImage && <PromptImage id={card.id} title={card.title} refs={card.refs} />}

      <p className="whitespace-pre-line px-3.5 py-3 font-mono text-[12px] leading-relaxed text-fg-muted">
        <PromptText text={card.prompt} />
      </p>
    </article>
  );
}

function ListBlock({ list, copiedKey, onCopy }: { list: PhraseList; copiedKey: string | null; onCopy: (k: string, t: string) => void }) {
  return (
    <div className="surface-card p-4">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{list.title}</p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {list.items.map((it) => {
          const key = `list:${list.title}:${it.en}`;
          const done = copiedKey === key;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onCopy(key, it.en)}
                title="Copiar el texto en inglés"
                className="group flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2"
              >
                <span className="shrink-0 text-fg">{it.es}</span>
                <span className="text-fg-subtle">→</span>
                <span className="min-w-0 flex-1 font-mono text-[12px] text-fg-muted">{it.en}</span>
                {done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px] leading-relaxed text-fg-muted">{children}</p>
  );
}

function GroupView({ group, copiedKey, onCopy }: { group: PromptGroup; copiedKey: string | null; onCopy: (k: string, t: string) => void }) {
  return (
    <section id={`g-${group.id}`} className="scroll-mt-6 space-y-5">
      <div className="border-b border-line-strong pb-2">
        <h3 className="text-lg font-semibold text-fg">{group.title}</h3>
      </div>
      {group.intro && <p className="max-w-[70ch] text-[14px] leading-relaxed text-fg-muted">{group.intro}</p>}

      {group.blocks.map((block, bi) => {
        const imageCards = block.cards?.filter((c) => !c.noImage) ?? [];
        const textCards = block.cards?.filter((c) => c.noImage) ?? [];
        return (
          <div key={bi} className="space-y-4">
            {block.subtitle && <h4 className="pt-2 text-[15px] font-semibold text-fg">{block.subtitle}</h4>}
            {block.intro && <p className="max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">{block.intro}</p>}

            {block.table && (
              <div className="surface-card overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      {block.table.head.map((h) => (
                        <th key={h} className="px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.table.rows.map((row) => (
                      <tr key={row[0]} className="border-b border-line last:border-0">
                        {row.map((cell, ci) => (
                          <td key={ci} className={`px-4 py-2.5 align-top ${ci === 2 ? 'font-mono text-[12px] text-fg-muted' : 'text-fg'}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {imageCards.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {imageCards.map((card) => (
                  <Card key={card.id} card={card} copied={copiedKey === card.id} onCopy={() => onCopy(card.id, card.prompt)} />
                ))}
              </div>
            )}

            {textCards.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {textCards.map((card) => (
                  <Card key={card.id} card={card} copied={copiedKey === card.id} onCopy={() => onCopy(card.id, card.prompt)} />
                ))}
              </div>
            )}

            {block.lists?.map((list) => (
              <ListBlock key={list.title} list={list} copiedKey={copiedKey} onCopy={onCopy} />
            ))}

            {block.note && <Note>{block.note}</Note>}
          </div>
        );
      })}
    </section>
  );
}

/* ---------------------------------- vista ---------------------------------- */

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function PromptLibraryView() {
  const [query, setQuery] = useState('');
  const { copied, copy } = useCopy();
  const q = query.trim().toLowerCase();

  const sections = useMemo<PromptSection[]>(
    () =>
      PROMPT_LIBRARY.map((s) => ({
        ...s,
        groups: s.groups.map((g) => filterGroup(g, q)).filter((g): g is PromptGroup => g !== null),
      })).filter((s) => s.groups.length > 0),
    [q]
  );

  const total = useMemo(
    () => PROMPT_LIBRARY.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.blocks.reduce((k, b) => k + (b.cards?.length ?? 0), 0), 0), 0),
    []
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
      {/* Índice */}
      <aside className="hidden lg:block">
        <nav className="surface-card sticky top-4 max-h-[calc(100dvh-140px)] overflow-y-auto p-3" aria-label="Índice de la biblioteca">
          <p className="px-2 pb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">Índice</p>
          {PROMPT_LIBRARY.map((s) => (
            <div key={s.id} className="mb-2 border-b border-line pb-2 last:mb-0 last:border-0 last:pb-0">
              <button
                type="button"
                onClick={() => scrollToId(`s-${s.id}`)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold text-fg hover:bg-surface-2"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent font-mono text-[11px] text-accent-fg">
                  {s.letter}
                </span>
                {s.title}
              </button>
              {s.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => scrollToId(`g-${g.id}`)}
                  className="block w-full rounded-lg py-1 pl-9 pr-2 text-left text-[12px] leading-snug text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  {g.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Contenido */}
      <div className="min-w-0 space-y-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-fg-muted">
            {total} prompts · copia, pega y genera. Los huecos <mark className="rounded bg-accent/12 px-0.5 font-semibold text-accent">[así]</mark>{' '}
            se rellenan.
          </p>
          <label className="relative block sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar prompt…"
              className="input-clean h-9 w-full pl-8 pr-8 text-[13px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Borrar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>

        {sections.length === 0 && <Note>No hay prompts que coincidan con “{query}”.</Note>}

        {sections.map((s) => (
          <section key={s.id} id={`s-${s.id}`} className="scroll-mt-6 space-y-10">
            <header className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent font-mono text-lg font-semibold text-accent-fg">
                {s.letter}
              </span>
              <div>
                <h2 className="text-[26px] font-semibold leading-tight text-fg">{s.title}</h2>
                <p className="mt-1 max-w-[70ch] text-[14px] text-fg-muted">{s.intro}</p>
              </div>
            </header>
            {s.groups.map((g) => (
              <GroupView key={g.id} group={g} copiedKey={copied} onCopy={copy} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
