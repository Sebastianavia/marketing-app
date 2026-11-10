'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import type { AvatarDto } from '@/lib/avatars/avatar-dto';
import { IMAGE_MODELS, getImageModel } from '@/config/image-models';
import { parseNodeId } from './build-graph';
import { tagKindLabel } from '@/lib/director-mode/mentions';
import type { DirectorSceneType, TagKind } from '@/lib/director-mode/types';
import type { useDirectorMode } from '../useDirectorMode';

type DM = ReturnType<typeof useDirectorMode>;

interface Props {
  dm: DM;
  selectedId: string | null;
  onClose: () => void;
}

/**
 * Inspector flotante de edición directa en el Lienzo (estilo Buzzy):
 * - Escena: editar qué se ve, diálogo, duración, insertar @etiquetas en 1 clic o rehacer con IA.
 * - Prompt: editar el prompt visual directamente ($0) o regenerarlo con IA.
 * - @Etiqueta: editar nombre/descripción, vincular un Avatar de Lulo Studio o generar una foto maestra
 *   de referencia con Nano Banana Pro / Seedream 5.0 Pro / GPT Image 2 y adjuntarla a la etiqueta.
 */
export function NodeInspector({ dm, selectedId, onClose }: Props) {
  const p = dm.production;
  const d = p?.director;
  const parsed = parseNodeId(selectedId);

  if (!p || !d || !parsed) return null;

  if (parsed.kind === 'escena' && parsed.sceneId) {
    const scene = d.guion?.escenas.find((s) => s.id === parsed.sceneId);
    if (!scene) return null;
    return <SceneInspector key={scene.id} dm={dm} sceneId={scene.id} onClose={onClose} />;
  }

  if (parsed.kind === 'prompt' && parsed.sceneId) {
    const scene = d.guion?.escenas.find((s) => s.id === parsed.sceneId);
    if (!scene) return null;
    return <PromptInspector key={scene.id} dm={dm} sceneId={scene.id} onClose={onClose} />;
  }

  if (parsed.kind === 'etiqueta' && parsed.sceneId) {
    const tag = d.etiquetas?.find((t) => t.id === parsed.sceneId);
    if (!tag) return null;
    return <TagInspector key={tag.id} dm={dm} tagId={tag.id} onClose={onClose} />;
  }

  return null;
}

function SceneInspector({ dm, sceneId, onClose }: { dm: DM; sceneId: string; onClose: () => void }) {
  const d = dm.production!.director!;
  const scene = d.guion!.escenas.find((s) => s.id === sceneId)!;
  const [tipo, setTipo] = useState<DirectorSceneType>(scene.tipo);
  const [duracionSeg, setDuracionSeg] = useState<number>(scene.duracionSeg);
  const [queSeVe, setQueSeVe] = useState(scene.queSeVe);
  const [dialogo, setDialogo] = useState(scene.dialogo);
  const [indicacion, setIndicacion] = useState('');
  const tags = d.etiquetas ?? [];

  // Si la escena cambia por fuera (IA, otra pestaña), el formulario se pone al día (ajuste durante el render)
  const sceneSig = `${scene.version}|${scene.tipo}|${scene.duracionSeg}|${scene.queSeVe}|${scene.dialogo}`;
  const [syncedScene, setSyncedScene] = useState(sceneSig);
  if (syncedScene !== sceneSig) {
    setSyncedScene(sceneSig);
    setTipo(scene.tipo);
    setDuracionSeg(scene.duracionSeg);
    setQueSeVe(scene.queSeVe);
    setDialogo(scene.dialogo);
  }

  const insertMention = (mencion: string) => {
    const token = `@${mencion}`;
    if (queSeVe.includes(token)) return;
    setQueSeVe((cur) => `${cur.trim()}${cur.trim() ? ' ' : ''}${token} `);
  };

  const save = () =>
    void dm.act(
      {
        accion: 'editar_escena',
        escenaId: scene.id,
        cambios: { tipo, duracionSeg: Number(duracionSeg) || scene.duracionSeg, queSeVe, dialogo },
      },
      `editar_escena:${scene.id}`
    );

  const redo = () =>
    void dm.act(
      {
        accion: 'rehacer_escena',
        escenaId: scene.id,
        indicacion: indicacion.trim(),
      },
      `rehacer_escena:${scene.id}`
    );

  return (
    <div className="nodrag nopan absolute right-3 top-14 z-20 w-80 max-w-[calc(100%-24px)] space-y-2.5 rounded-xl border border-line bg-surface/95 p-3.5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-fg">Editar Escena {scene.orden}</span>
        <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg cursor-pointer" aria-label="Cerrar inspector">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5 text-[11px] text-fg-subtle">
          <span>Tipo de toma</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as DirectorSceneType)}
            disabled={d.ajustes.modoVoz !== 'avatar'}
            className="input-clean h-7 w-full px-1.5 text-[11.5px] text-fg"
          >
            <option value="broll">Toma de apoyo</option>
            <option value="avatar">Persona hablando</option>
          </select>
        </label>
        <label className="space-y-0.5 text-[11px] text-fg-subtle">
          <span>Duración (s)</span>
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={duracionSeg}
            disabled={Boolean(scene.audio)}
            onChange={(e) => setDuracionSeg(Number(e.target.value))}
            className="input-clean h-7 w-full px-2 text-[11.5px] text-fg"
          />
        </label>
      </div>

      <label className="block space-y-1 text-[11px] text-fg-subtle">
        <span>Qué se ve en la escena</span>
        <textarea
          rows={3}
          value={queSeVe}
          onChange={(e) => setQueSeVe(e.target.value)}
          className="input-clean w-full resize-y p-2 text-[12px] leading-snug text-fg"
        />
      </label>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-fg-subtle">+ Mención:</span>
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => insertMention(t.mencion)}
              className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted hover:text-fg cursor-pointer"
              title={`Insertar @${t.mencion} en la escena`}
            >
              @{t.mencion}
            </button>
          ))}
        </div>
      )}

      <label className="block space-y-1 text-[11px] text-fg-subtle">
        <span>Diálogo / Locución</span>
        <textarea
          rows={2}
          value={dialogo}
          disabled={Boolean(scene.audio)}
          onChange={(e) => setDialogo(e.target.value)}
          className="input-clean w-full resize-y p-2 text-[12px] leading-snug text-fg"
        />
      </label>

      <div className="flex items-center gap-1.5">
        <button type="button" disabled={!!dm.busy} onClick={save} className="btn-primary h-7 flex-1 px-2.5 text-[11.5px]">
          <Save className="h-3 w-3" /> Guardar · $0
        </button>
      </div>

      <div className="space-y-1.5 border-t border-line pt-2">
        <input
          value={indicacion}
          onChange={(e) => setIndicacion(e.target.value)}
          placeholder="Indicación opcional para rehacer con IA…"
          className="input-clean h-7 w-full px-2 text-[11px]"
        />
        <button type="button" disabled={!!dm.busy} onClick={redo} className="btn-secondary h-7 w-full px-2.5 text-[11px]">
          {dm.busy === `rehacer_escena:${scene.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Rehacer escena con IA
        </button>
      </div>
    </div>
  );
}

function PromptInspector({ dm, sceneId, onClose }: { dm: DM; sceneId: string; onClose: () => void }) {
  const d = dm.production!.director!;
  const scene = d.guion!.escenas.find((s) => s.id === sceneId)!;
  const [texto, setTexto] = useState(scene.prompt?.texto ?? '');
  const [indicacion, setIndicacion] = useState('');

  const promptText = scene.prompt?.texto ?? '';
  const [syncedPrompt, setSyncedPrompt] = useState(promptText);
  if (syncedPrompt !== promptText) {
    setSyncedPrompt(promptText);
    setTexto(promptText);
  }

  const save = () => {
    if (!texto.trim()) return;
    void dm.act({ accion: 'editar_prompt', escenaId: scene.id, texto: texto.trim() }, `editar_prompt:${scene.id}`);
  };

  const redo = () =>
    void dm.act(
      { accion: 'rehacer_prompt', escenaId: scene.id, indicacion: indicacion.trim() },
      `rehacer_prompt:${scene.id}`
    );

  return (
    <div className="nodrag nopan absolute right-3 top-14 z-20 w-80 max-w-[calc(100%-24px)] space-y-2.5 rounded-xl border border-line bg-surface/95 p-3.5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-fg">Prompt · Escena {scene.orden}</span>
        <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg cursor-pointer" aria-label="Cerrar inspector">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="block space-y-1 text-[11px] text-fg-subtle">
        <span>Prompt visual (en inglés para los motores de imagen y video)</span>
        <textarea
          rows={5}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe o edita el prompt visual de esta escena…"
          className="input-clean w-full resize-y font-mono p-2 text-[11.5px] leading-snug text-fg"
        />
      </label>

      <button type="button" disabled={!!dm.busy || !texto.trim()} onClick={save} className="btn-primary h-7 w-full px-2.5 text-[11.5px]">
        <Save className="h-3 w-3" /> Guardar prompt · $0
      </button>

      <div className="space-y-1.5 border-t border-line pt-2">
        <input
          value={indicacion}
          onChange={(e) => setIndicacion(e.target.value)}
          placeholder="Ej.: plano detalle cinematográfico con luz cálida…"
          className="input-clean h-7 w-full px-2 text-[11px]"
        />
        <button type="button" disabled={!!dm.busy} onClick={redo} className="btn-secondary h-7 w-full px-2.5 text-[11px]">
          {dm.busy === `rehacer_prompt:${scene.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerar prompt con IA
        </button>
      </div>
    </div>
  );
}

function TagInspector({ dm, tagId, onClose }: { dm: DM; tagId: string; onClose: () => void }) {
  const d = dm.production!.director!;
  const tag = d.etiquetas!.find((t) => t.id === tagId)!;
  const [nombre, setNombre] = useState(tag.nombre);
  const [tipo, setTipo] = useState<TagKind>(tag.tipo);
  const [descripcion, setDescripcion] = useState(tag.descripcion);
  const [avatarId, setAvatarId] = useState<string>(tag.avatarId ?? '');
  const [avatars, setAvatars] = useState<AvatarDto[]>([]);
  const [genModel, setGenModel] = useState<string>('gemini-3-pro-image-preview');
  const [generatingRef, setGeneratingRef] = useState(false);

  const tagSig = `${tag.rev}|${tag.nombre}|${tag.tipo}|${tag.descripcion}|${tag.avatarId ?? ''}`;
  const [syncedTag, setSyncedTag] = useState(tagSig);
  if (syncedTag !== tagSig) {
    setSyncedTag(tagSig);
    setNombre(tag.nombre);
    setTipo(tag.tipo);
    setDescripcion(tag.descripcion);
    setAvatarId(tag.avatarId ?? '');
  }

  useEffect(() => {
    fetch('/api/avatars')
      .then((r) => r.json())
      .then((res) => setAvatars(Array.isArray(res.avatars) ? res.avatars.filter((a: AvatarDto) => a.photos.length > 0) : []))
      .catch(() => setAvatars([]));
  }, []);

  const save = () =>
    void dm.act(
      {
        accion: 'guardar_etiqueta',
        etiquetaId: tag.id,
        tipo,
        nombre: nombre.trim() || tag.nombre,
        descripcion: descripcion.trim(),
        avatarId: tipo === 'personaje' && avatarId ? avatarId : null,
      },
      `guardar_etiqueta:${tag.id}`
    );

  const generateMasterRef = async () => {
    const promptText = descripcion.trim() || `${nombre} (${tagKindLabel(tipo).label}), studio reference sheet, clean lighting, high detail`;
    setGeneratingRef(true);
    dm.setError(null);
    try {
      const modelSpec = getImageModel(genModel);
      const res = modelSpec.defaultResolution || modelSpec.resolutions[0];
      const r = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelSpec.id,
          prompt: promptText,
          aspectRatio: d.ajustes.formato,
          resolution: res,
          count: 1,
          realism: true,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(data.images) || !data.images[0]?.url) {
        throw new Error(data.error || 'No se pudo generar la foto de referencia.');
      }
      const imgBlob = await fetch(data.images[0].url).then((x) => x.blob());
      const ext = imgBlob.type.includes('jpeg') ? 'jpg' : 'png';
      const file = new File([imgBlob], `${tag.mencion}-ref.${ext}`, { type: imgBlob.type || 'image/png' });
      await dm.uploadRefs([file], { etiquetaId: tag.id });
    } catch (err) {
      dm.setError(err instanceof Error ? err.message : 'No se pudo generar la referencia.');
    } finally {
      setGeneratingRef(false);
    }
  };

  return (
    <div className="nodrag nopan absolute right-3 top-14 z-20 w-80 max-w-[calc(100%-24px)] space-y-2.5 rounded-xl border border-line bg-surface/95 p-3.5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-fg">
          Etiqueta @{tag.mencion}
        </span>
        <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg cursor-pointer" aria-label="Cerrar inspector">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5 text-[11px] text-fg-subtle">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="input-clean h-7 w-full px-2 text-[11.5px] text-fg" />
        </label>
        <label className="space-y-0.5 text-[11px] text-fg-subtle">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TagKind)} className="input-clean h-7 w-full px-1.5 text-[11.5px] text-fg">
            <option value="personaje">Personaje</option>
            <option value="producto">Producto</option>
            <option value="lugar">Lugar</option>
            <option value="estilo">Estilo</option>
          </select>
        </label>
      </div>

      {tipo === 'personaje' && (
        <label className="block space-y-0.5 text-[11px] text-fg-subtle">
          <span>Vincular Avatar de Lulo Studio</span>
          <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className="input-clean h-7 w-full px-1.5 text-[11.5px] text-fg">
            <option value="">Sin avatar (usar fotos subidas)</option>
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.photos.length} fotos)
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1 text-[11px] text-fg-subtle">
        <span>Descripción visual (se inyecta en las escenas que usan @{tag.mencion})</span>
        <textarea
          rows={3}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej.: woman, 30s, curly dark hair, olive blazer…"
          className="input-clean w-full resize-y p-2 text-[11.5px] leading-snug text-fg"
        />
      </label>

      <button type="button" disabled={!!dm.busy} onClick={save} className="btn-primary h-7 w-full px-2.5 text-[11.5px]">
        <Check className="h-3 w-3" /> {tag.confirmada ? 'Guardar etiqueta · $0' : 'Confirmar y guardar · $0'}
      </button>

      <div className="space-y-1.5 border-t border-line pt-2">
        <span className="block text-[10.5px] text-fg-subtle">Generar foto maestra de referencia con IA</span>
        <select value={genModel} onChange={(e) => setGenModel(e.target.value)} className="input-clean h-7 w-full px-1.5 text-[11px] text-fg">
          {IMAGE_MODELS.map((im) => {
            const defRes = im.defaultResolution || im.resolutions[0];
            return (
              <option key={im.id} value={im.id}>
                {im.name} (${(im.pricePerImage[defRes] ?? 0).toFixed(3)})
              </option>
            );
          })}
        </select>
        <button type="button" disabled={generatingRef || !!dm.busy} onClick={generateMasterRef} className="btn-secondary h-7 w-full px-2.5 text-[11px]">
          {generatingRef ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {generatingRef ? 'Generando foto para @' + tag.mencion + '…' : `Generar foto para @${tag.mencion}`}
        </button>
      </div>
    </div>
  );
}

