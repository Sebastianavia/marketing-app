'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AudioLines, FileText, Lock, Paperclip, Sparkles, SlidersHorizontal } from 'lucide-react';
import { VOICE_MODES, getBrollModel } from '@/config/broll-models';
import { getDirectorSkill } from '@/config/director-skills';
import { formatTime } from '@/lib/director-mode/durations';
import { sceneRefs, sceneTags, tagKindLabel, tagRefs } from '@/lib/director-mode/mentions';
import type { DirectorState } from '@/lib/director-mode/types';
import type { DirectorNode, NodeTone } from './build-graph';
import { TYPE_LABEL } from '../ScriptSceneCard';
import { MentionText, RefThumb, TagChip } from '../refs/ref-common';

/** Un solo tipo de nodo ("director") que se dibuja según `data.kind`. Colores con los tokens de la app. */

const TONE: Record<NodeTone, { label: string; dot: string; text: string }> = {
  ok: { label: 'Aprobado', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  review: { label: 'Por revisar', dot: 'bg-accent', text: 'text-accent' },
  stale: { label: 'Desactualizado', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  pending: { label: 'Pendiente', dot: 'bg-fg-subtle', text: 'text-fg-muted' },
  blocked: { label: 'Bloqueado', dot: 'bg-line-strong', text: 'text-fg-subtle' },
  error: { label: 'Error', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  future: { label: 'Próximamente', dot: 'bg-line-strong', text: 'text-fg-subtle' },
};

function Status({ tone, label }: { tone: NodeTone; label?: string }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] ${t.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
      {label ?? t.label}
    </span>
  );
}

function Shell({
  selected,
  tone,
  width = 250,
  dashed,
  children,
}: {
  selected: boolean;
  tone: NodeTone;
  width?: number;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ width }}
      className={`rounded-xl border bg-surface p-3 text-left shadow-[var(--shadow-card)] transition-colors ${
        dashed ? 'border-dashed opacity-60' : ''
      } ${
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : tone === 'stale'
          ? 'border-amber-500/50'
          : tone === 'error'
          ? 'border-red-500/50'
          : 'border-line hover:border-line-strong'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-line-strong" />
      {children}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-line-strong" />
    </div>
  );
}

function Header({ icon, title, right }: { icon?: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[12px] font-semibold text-fg">{title}</span>
      <span className="ml-auto">{right}</span>
    </div>
  );
}

const clamp = 'overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-box-orient:vertical]';

function DirectorNodeView({ data, selected }: NodeProps<DirectorNode>) {
  switch (data.kind) {
    case 'idea': {
      const e = data.d.entrada;
      const skill = getDirectorSkill(data.d.skill);
      return (
        <Shell selected={selected} tone={data.tone}>
          <Header icon={<FileText className="h-3.5 w-3.5 text-fg-subtle" />} title="Idea" right={<Status tone={data.tone} />} />
          <p className="mt-1 text-[10.5px] text-fg-subtle">
            {skill ? `${skill.icono} ${skill.nombre}` : 'Sin plantilla'} · {e.tipo === 'guion' ? 'Guion' : e.tipo === 'idea' ? 'Idea' : 'PDF'}
            {data.d.confidencial ? ' · confidencial' : ''}
          </p>
          {e.pdfNombre && <p className="mt-1 truncate text-[11px] text-fg-muted">📄 {e.pdfNombre}</p>}
          {e.texto && (
            <p className={`mt-1.5 text-[11.5px] leading-snug text-fg-muted ${clamp}`} style={{ WebkitLineClamp: 4 }}>
              {e.texto}
            </p>
          )}
        </Shell>
      );
    }
    case 'direccion': {
      const d = data.d;
      const a = d.ajustes;
      const answered = d.preguntas.filter((q) => q.respuesta);
      return (
        <Shell selected={selected} tone={data.tone}>
          <Header icon={<SlidersHorizontal className="h-3.5 w-3.5 text-fg-subtle" />} title="Dirección" right={<Status tone={data.tone} />} />
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-fg-muted">
            {answered.length ? (
              answered.map((q) => (
                <li key={q.id} className="truncate" title={`${q.pregunta} → ${q.respuesta}`}>
                  · {q.respuesta}
                </li>
              ))
            ) : (
              <li className="text-fg-subtle">{d.preguntas.length ? 'Preguntas sin responder' : 'Sin preguntas todavía'}</li>
            )}
          </ul>
          <p className="mt-1.5 text-[10.5px] leading-snug text-fg-subtle">
            {a.formato} · {a.duracionSeg} s · {VOICE_MODES.find((v) => v.id === a.modoVoz)?.label} · {getBrollModel(a.modeloBroll).name}
            {a.avatarNombre ? ` · «${a.avatarNombre}»` : ''}
            {d.locucion?.usarComoVoz ? ' · voz: tu locución' : ''}
          </p>
        </Shell>
      );
    }
    case 'guion-pendiente':
      return (
        <Shell selected={selected} tone={data.tone}>
          <Header icon={<Sparkles className="h-3.5 w-3.5 text-fg-subtle" />} title="Guion por escenas" right={<Status tone={data.tone} />} />
          <p className="mt-1.5 text-[11.5px] text-fg-muted">Las escenas aparecerán aquí cuando la IA escriba el guion.</p>
        </Shell>
      );
    case 'escena': {
      const s = data.scene;
      return (
        <Shell selected={selected} tone={data.tone}>
          <Header
            title={`Escena ${s.orden}`}
            right={<span className="font-mono text-[10.5px] text-fg-subtle">[{formatTime(s.inicio)}–{formatTime(s.fin)}]</span>}
          />
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-fg-muted">{TYPE_LABEL[s.tipo]}</span>
            <Status tone={data.tone} />
          </div>
          <p className={`mt-1.5 text-[11px] leading-snug text-fg-muted ${clamp}`} style={{ WebkitLineClamp: 2 }}>
            {s.queSeVe ? <MentionText text={s.queSeVe} tags={data.d.etiquetas} /> : '—'}
          </p>
          {s.dialogo && (
            <p className={`mt-1 text-[11.5px] leading-snug text-fg ${clamp}`} style={{ WebkitLineClamp: 2 }}>
              «{s.dialogo}»
            </p>
          )}
          {s.duracionPedidaSeg !== undefined && (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
              Pediste {s.duracionPedidaSeg} s → {s.duracionSeg} s por el modelo
            </p>
          )}
          {s.audio && (
            <p className="mt-1 text-[10px] text-fg-subtle" title="Inicio, fin y diálogo los manda tu locución">
              🎙️ Sigue tu audio · clip de {s.clipSeg} s{s.clipSeg && s.clipSeg > s.duracionSeg + 0.05 ? `, se recorta a ${s.duracionSeg.toFixed(1)} s` : ''}
            </p>
          )}
          <SceneRefsLine d={data.d} sceneId={s.id} />
        </Shell>
      );
    }
    case 'prompt': {
      const s = data.scene;
      const label = !s.prompt ? (data.tone === 'blocked' ? 'Bloqueado' : 'Sin prompt') : undefined;
      return (
        <Shell selected={selected} tone={data.tone}>
          <Header title={`Prompt ${s.orden}`} right={<Status tone={data.tone} label={label} />} />
          {s.prompt ? (
            <>
              <p className={`mt-1.5 font-mono text-[10.5px] leading-snug text-fg-muted ${clamp}`} style={{ WebkitLineClamp: 4 }}>
                {s.prompt.texto}
              </p>
              <p className="mt-1 text-[10px] text-fg-subtle">
                {s.prompt.modelo === 'manual' ? 'Editado a mano' : s.prompt.modelo} · $0
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] text-fg-subtle">Todavía no hay prompt para esta escena.</p>
          )}
        </Shell>
      );
    }
    case 'etiqueta': {
      const t = data.tag;
      const own = tagRefs(data.d, t.id);
      const k = tagKindLabel(t.tipo);
      return (
        <Shell selected={selected} tone={data.tone} width={230} dashed={!t.confirmada && !selected}>
          <Header title={`${k.icono} ${k.label}`} right={<Status tone={data.tone} label={t.confirmada ? 'Confirmada' : 'Propuesta'} />} />
          <div className="mt-1.5">
            <TagChip tag={t} />
            {t.nombre !== t.mencion && <span className="ml-1.5 text-[11px] text-fg-muted">{t.nombre}</span>}
          </div>
          {own.length > 0 && (
            <div className="mt-1.5 flex gap-1">
              {own.slice(0, 4).map((r) => (
                <RefThumb key={r.id} productionId={data.pid} r={r} size={34} />
              ))}
              {own.length > 4 && <span className="self-center text-[10px] text-fg-subtle">+{own.length - 4}</span>}
            </div>
          )}
          {t.avatarNombre && <p className="mt-1 truncate text-[10.5px] text-fg-subtle">Avatar «{t.avatarNombre}»</p>}
          {!own.length && !t.avatarNombre && <p className="mt-1 text-[10.5px] text-fg-subtle">Sin archivos</p>}
        </Shell>
      );
    }
    case 'locucion': {
      const loc = data.d.locucion!;
      const t = loc.transcripcion;
      return (
        <Shell selected={selected} tone={data.tone} width={230}>
          <Header icon={<AudioLines className="h-3.5 w-3.5 text-fg-subtle" />} title="Tu locución" right={<Status tone={data.tone} label={t ? 'Transcrita' : 'Sin transcribir'} />} />
          <p className="mt-1.5 text-[11px] text-fg-muted">
            {Math.round(loc.duracionSeg)} s{t ? ` · ${t.frases.length} frases · ${t.motor === 'gemini' ? 'Gemini (aprox.)' : 'ElevenLabs'}` : ''}
          </p>
          <p className="mt-1 text-[10.5px] text-fg-subtle">{loc.usarComoVoz ? 'Es la voz del video ($0 en ElevenLabs)' : 'Solo como referencia'}</p>
        </Shell>
      );
    }
    case 'sueltas': {
      const loose = (data.d.referencias ?? []).filter((r) => !r.etiquetaId && !r.escenaId && r.id !== data.d.locucion?.refId);
      return (
        <Shell selected={selected} tone={data.tone} width={230}>
          <Header icon={<Paperclip className="h-3.5 w-3.5 text-fg-subtle" />} title="Sin etiqueta" right={<span className="text-[10.5px] text-fg-subtle">{loose.length}</span>} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {loose.slice(0, 6).map((r) => (
              <RefThumb key={r.id} productionId={data.pid} r={r} size={30} />
            ))}
          </div>
          <p className="mt-1 text-[10.5px] text-fg-subtle">Toca para etiquetarlas</p>
        </Shell>
      );
    }
    case 'futuro':
      return (
        <Shell selected={false} tone="future" width={data.compacto ? 150 : 200} dashed>
          <Header icon={<Lock className="h-3 w-3 text-fg-subtle" />} title={data.titulo} />
          <p className="mt-1 text-[10px] text-fg-subtle">Próximamente · Fase {data.fase}</p>
        </Shell>
      );
  }
}

/** Etiquetas que usa la escena y cuántas referencias son solo suyas. */
function SceneRefsLine({ d, sceneId }: { d: DirectorState; sceneId: string }) {
  const s = d.guion?.escenas.find((x) => x.id === sceneId);
  if (!s) return null;
  const tags = sceneTags(d, s);
  const own = sceneRefs(d, sceneId).length;
  if (!tags.length && !own) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {tags.slice(0, 4).map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {tags.length > 4 && <span className="text-[10px] text-fg-subtle">+{tags.length - 4}</span>}
      {own > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10.5px] text-fg-subtle" title="Referencias solo para esta escena">
          <Paperclip className="h-3 w-3" />
          {own}
        </span>
      )}
    </div>
  );
}

export const nodeTypes = { director: memo(DirectorNodeView) };
