'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, Copy, FolderOpen, ImagePlus, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import {
  EDIT_FORMATS,
  FONT_SUGGESTIONS,
  GRAPHICS_AMOUNTS,
  MUSIC_CHOICES,
  SOCIAL_NETWORKS,
  SUBTITLE_POSITIONS,
  SUBTITLE_STYLES,
  blankProfileInput,
  type EditProfile,
  type ProfileInput,
} from '@/config/editor-looks';
import { editorApi, toInput } from './editor-api';
import { LookDots, LookPreview } from './LookPreview';

/**
 * Biblioteca de perfiles de edición ("tu marca"): todo lo que se repite en cada video
 * se guarda una vez y se elige con un clic al editar.
 */

interface Props {
  perfiles: EditProfile[];
  onChanged: (perfiles: EditProfile[], selectId?: string) => void;
  initialId?: string;
  /** Archivos de la carpeta de música propia. */
  musica: string[];
  onMusicRefresh: () => void;
}

export function ProfilesPanel({ perfiles, onChanged, initialId, musica, onMusicRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(initialId ?? perfiles[0]?.id ?? null);
  const selected = selectedId && selectedId !== 'new' ? perfiles.find((p) => p.id === selectedId) : undefined;

  const [draftSeed, setDraftSeed] = useState<ProfileInput | null>(null);
  const [refNote, setRefNote] = useState<string | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const startNew = (from?: EditProfile) => {
    setSelectedId('new');
    setRefNote(null);
    setDraftSeed(from ? { ...toInput(from), nombre: `${from.nombre} (copia)` } : blankProfileInput());
  };
  const fromReferences = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, 6);
    if (!files.length) return;
    setRefBusy(true);
    setRefError(null);
    try {
      const r = await editorApi.profileFromReferences(files);
      setSelectedId('new');
      setDraftSeed(r.perfil);
      setRefNote(r.explicacion);
    } catch (err) {
      setRefError(err instanceof Error ? err.message : 'No se pudo analizar las referencias.');
    } finally {
      setRefBusy(false);
      if (refInput.current) refInput.current.value = '';
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-fg-muted">Tus perfiles</p>
          <button type="button" onClick={() => startNew()} className="btn-secondary h-8 px-2.5 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </button>
        </div>
        {perfiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedId(p.id)}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              selectedId === p.id ? 'border-accent bg-surface' : 'border-line bg-surface hover:border-fg-subtle'
            }`}
          >
            <LookDots look={p} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-fg">{p.nombre}</span>
              <span className="line-clamp-2 text-[11px] text-fg-subtle">{p.descripcion || 'Sin descripción'}</span>
            </span>
          </button>
        ))}
        {perfiles.length === 0 && <p className="text-[12px] text-fg-subtle">Todavía no hay perfiles. Crea el primero.</p>}

        <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Crear desde referencias
          </p>
          <p className="text-[11px] text-fg-subtle">Sube 1 a 6 capturas de reels que te gusten: la IA propone colores, fuente y estilo de subtítulos.</p>
          <input ref={refInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => void fromReferences(e.target.files)} />
          <button type="button" disabled={refBusy} onClick={() => refInput.current?.click()} className="btn-secondary h-8 w-full px-3 text-[12px]">
            {refBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {refBusy ? 'Analizando…' : 'Elegir capturas'}
          </button>
          {refError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{refError}</p>}
        </div>
      </aside>

      {selectedId === 'new' && draftSeed ? (
        <ProfileForm
          key={`new-${draftSeed.nombre}-${refNote ?? ''}`}
          initial={draftSeed}
          note={refNote}
          musica={musica}
          onMusicRefresh={onMusicRefresh}
          onSave={async (input) => {
            const created = await editorApi.createProfile(input);
            const list = await editorApi.profiles();
            onChanged(list, created.id);
            setSelectedId(created.id);
          }}
          onCancel={() => setSelectedId(perfiles[0]?.id ?? null)}
        />
      ) : selected ? (
        <ProfileForm
          key={selected.id + selected.actualizado}
          initial={toInput(selected)}
          musica={musica}
          onMusicRefresh={onMusicRefresh}
          onSave={async (input) => {
            await editorApi.updateProfile(selected.id, input);
            onChanged(await editorApi.profiles(), selected.id);
          }}
          onDuplicate={() => startNew(selected)}
          onDelete={async () => {
            await editorApi.deleteProfile(selected.id);
            const list = await editorApi.profiles();
            onChanged(list);
            setSelectedId(list[0]?.id ?? null);
          }}
        />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-line p-12 text-[13px] text-fg-subtle">
          Elige un perfil o crea uno nuevo.
        </div>
      )}
    </div>
  );
}

// ── Formulario ────────────────────────────────────────────────────────────────

interface FormProps {
  initial: ProfileInput;
  note?: string | null;
  musica: string[];
  onMusicRefresh: () => void;
  onSave: (p: ProfileInput) => Promise<void>;
  onCancel?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => Promise<void>;
}

function ProfileForm({ initial, note, musica, onMusicRefresh, onSave, onCancel, onDuplicate, onDelete }: FormProps) {
  const [p, setP] = useState<ProfileInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => {
    setSaved(false);
    setP((x) => ({ ...x, [k]: v }));
  };
  const sub = <K extends keyof ProfileInput['subtitulos']>(k: K, v: ProfileInput['subtitulos'][K]) =>
    set('subtitulos', { ...p.subtitulos, [k]: v });
  const hook = <K extends keyof ProfileInput['gancho']>(k: K, v: ProfileInput['gancho'][K]) => set('gancho', { ...p.gancho, [k]: v });
  const rit = <K extends keyof ProfileInput['ritmo']>(k: K, v: ProfileInput['ritmo'][K]) => set('ritmo', { ...p.ritmo, [k]: v });
  const gra = <K extends keyof ProfileInput['graficos']>(k: K, v: ProfileInput['graficos'][K]) => set('graficos', { ...p.graficos, [k]: v });
  const son = <K extends keyof ProfileInput['sonido']>(k: K, v: ProfileInput['sonido'][K]) => set('sonido', { ...p.sonido, [k]: v });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(p);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm(`¿Borrar el perfil "${p.nombre}"? Las ediciones hechas con él no cambian.`)) return;
    setBusy(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar.');
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_230px]">
      <div className="space-y-5">
        {note && (
          <p className="flex items-start gap-2 rounded-xl border border-accent/40 bg-surface px-4 py-3 text-[12px] text-fg">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {note} Revísalo y dale a Guardar.
          </p>
        )}
        <Section title="Perfil">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *">
              <input value={p.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Mi marca" className="input-clean h-9 w-full px-3 text-[13px]" />
            </Field>
            <Field label="Descripción corta">
              <input value={p.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Para reconocerlo en la lista" className="input-clean h-9 w-full px-3 text-[13px]" />
            </Field>
          </div>
          <Field label="Sobre ti (para que la IA entienda tu negocio)">
            <textarea
              value={p.sobreTi}
              onChange={(e) => set('sobreTi', e.target.value)}
              rows={3}
              placeholder="Ej.: Vendo cursos de marketing para emprendedoras en Colombia. Hablo cercano y directo."
              className="input-clean w-full resize-y px-3 py-2 text-[13px]"
            />
          </Field>
          <Field label="Tus reglas de edición (la IA las sigue siempre)">
            <textarea
              value={p.instrucciones}
              onChange={(e) => set('instrucciones', e.target.value)}
              rows={3}
              placeholder="Ej.: Nunca cortes los precios. Si repito el inicio, deja la última toma. Máximo 60 segundos."
              className="input-clean w-full resize-y px-3 py-2 text-[13px]"
            />
          </Field>
          <Field label="Formato">
            <Segmented value={p.formato} options={EDIT_FORMATS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => set('formato', v)} />
          </Field>
          <Field label="Red principal (zona segura: los textos no quedan debajo de sus botones)">
            <Segmented value={p.red} options={SOCIAL_NETWORKS.map((n) => ({ id: n.id, label: n.label }))} onChange={(v) => set('red', v)} />
          </Field>
        </Section>

        <Section title="Subtítulos" toggle={{ on: p.subtitulos.activo, set: (v) => sub('activo', v) }}>
          <fieldset disabled={!p.subtitulos.activo} className="space-y-3 disabled:opacity-50">
            <Field label="Estilo">
              <Segmented value={p.subtitulos.estilo} options={SUBTITLE_STYLES.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))} onChange={(v) => sub('estilo', v)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fuente">
                <input list="lulo-editor-fonts" value={p.subtitulos.fuente} onChange={(e) => sub('fuente', e.target.value)} className="input-clean h-9 w-full px-3 text-[13px]" />
                <datalist id="lulo-editor-fonts">
                  {FONT_SUGGESTIONS.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </Field>
              <Field label="Posición">
                <Segmented value={p.subtitulos.posicion} options={SUBTITLE_POSITIONS} onChange={(v) => sub('posicion', v)} />
              </Field>
              <Range label="Tamaño" value={p.subtitulos.tamano} min={30} max={160} step={2} unit="px" onChange={(v) => sub('tamano', v)} />
              <Range
                label="Palabras a la vez"
                value={p.subtitulos.estilo === 'palabra' ? 1 : p.subtitulos.palabrasPorLinea}
                min={1}
                max={8}
                step={1}
                disabled={p.subtitulos.estilo === 'palabra'}
                onChange={(v) => sub('palabrasPorLinea', v)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <ColorField label="Texto" value={p.subtitulos.colorTexto} onChange={(v) => sub('colorTexto', v)} />
              <ColorField label="Resaltado" value={p.subtitulos.colorResaltado} onChange={(v) => sub('colorResaltado', v)} />
              <ColorField label="Borde" value={p.subtitulos.colorBorde} onChange={(v) => sub('colorBorde', v)} disabled={p.subtitulos.caja} />
              <ColorField label="Caja" value={p.subtitulos.colorCaja} onChange={(v) => sub('colorCaja', v)} disabled={!p.subtitulos.caja} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Range label="Grosor del borde" value={p.subtitulos.grosorBorde} min={0} max={12} step={1} unit="px" disabled={p.subtitulos.caja} onChange={(v) => sub('grosorBorde', v)} />
              <Range label="Tamaño de la palabra clave" value={p.subtitulos.escalaClave} min={100} max={250} step={5} unit="%" onChange={(v) => sub('escalaClave', v)} />
              <div className="flex flex-wrap items-end gap-4 pb-1">
                <Check label="Caja detrás del texto" checked={p.subtitulos.caja} onChange={(v) => sub('caja', v)} />
                <Check label="MAYÚSCULAS" checked={p.subtitulos.mayusculas} onChange={(v) => sub('mayusculas', v)} />
              </div>
            </div>
          </fieldset>
        </Section>

        <Section title="Texto gancho (primeros segundos)" toggle={{ on: p.gancho.activo, set: (v) => hook('activo', v) }}>
          <fieldset disabled={!p.gancho.activo} className="grid gap-3 disabled:opacity-50 sm:grid-cols-4">
            <ColorField label="Texto" value={p.gancho.colorTexto} onChange={(v) => hook('colorTexto', v)} />
            <ColorField label="Fondo" value={p.gancho.colorFondo} onChange={(v) => hook('colorFondo', v)} />
            <Range label="Tamaño" value={p.gancho.tamano} min={30} max={140} step={2} unit="px" onChange={(v) => hook('tamano', v)} />
            <Range label="Duración" value={p.gancho.duracionSeg} min={1} max={10} step={0.5} unit="s" onChange={(v) => hook('duracionSeg', v)} />
          </fieldset>
          <p className="text-[11px] text-fg-subtle">La IA propone el texto en cada video y tú lo puedes cambiar antes de crear el video.</p>
        </Section>

        <Section title="Ritmo y cortes">
          <div className="grid gap-3 sm:grid-cols-2">
            <Range label="Cortar pausas más largas que" value={p.ritmo.pausaMaxSeg} min={0.15} max={2} step={0.05} unit="s" onChange={(v) => rit('pausaMaxSeg', v)} />
            <Range label="Aire antes y después de cada frase" value={p.ritmo.margenSeg} min={0} max={0.4} step={0.02} unit="s" onChange={(v) => rit('margenSeg', v)} />
            <Range label="Zoom en los cortes" value={p.ritmo.zoomPct} min={5} max={25} step={1} unit="%" disabled={!p.ritmo.zoomEnCortes && !p.ritmo.zoomSuave} onChange={(v) => rit('zoomPct', v)} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Check label="Quitar errores y repeticiones con IA" checked={p.ritmo.quitarErrores} onChange={(v) => rit('quitarErrores', v)} />
            <Check label="Zoom alterno en los cortes" checked={p.ritmo.zoomEnCortes} onChange={(v) => rit('zoomEnCortes', v)} />
            <Check label="Zoom suave (acercamiento lento en cada plano)" checked={p.ritmo.zoomSuave} onChange={(v) => rit('zoomSuave', v)} />
            <Check label="Igualar volumen (Instagram/TikTok)" checked={p.ritmo.normalizarAudio} onChange={(v) => rit('normalizarAudio', v)} />
          </div>
        </Section>

        <Section title="Gráficos animados">
          <Field label="Cantidad (la IA propone, tú apruebas)">
            <Segmented value={p.graficos.cantidad} options={GRAPHICS_AMOUNTS.map((g) => ({ id: g.id, label: g.label, hint: g.hint }))} onChange={(v) => gra('cantidad', v)} />
          </Field>
          <fieldset disabled={p.graficos.cantidad === 'ninguno'} className="space-y-3 disabled:opacity-50">
            <div className="grid gap-3 sm:grid-cols-4">
              <ColorField label="Fondo tarjeta" value={p.graficos.colorFondo} onChange={(v) => gra('colorFondo', v)} />
              <ColorField label="Borde" value={p.graficos.colorBorde} onChange={(v) => gra('colorBorde', v)} />
              <ColorField label="Texto" value={p.graficos.colorTexto} onChange={(v) => gra('colorTexto', v)} />
              <ColorField label="Acento" value={p.graficos.colorAcento} onChange={(v) => gra('colorAcento', v)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Range label="Opacidad de la tarjeta" value={p.graficos.opacidad} min={30} max={100} step={1} unit="%" onChange={(v) => gra('opacidad', v)} />
              <Field label="Fuente de cifras y palabras gigantes">
                <input list="lulo-editor-fonts" value={p.graficos.fuenteImpacto} onChange={(e) => gra('fuenteImpacto', e.target.value)} className="input-clean h-9 w-full px-3 text-[13px]" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Check label="Palabras gigantes detrás de mi cabeza (necesita el recorte)" checked={p.graficos.textoDetras} onChange={(v) => gra('textoDetras', v)} />
              <Check label="Ocultar subtítulos mientras se ve un gráfico" checked={p.graficos.ocultarSubtitulos} onChange={(v) => gra('ocultarSubtitulos', v)} />
            </div>
          </fieldset>
        </Section>

        <Section title="Sonido">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Check label="Limpiar la voz (graves, ruido y compresor suave)" checked={p.sonido.limpiarVoz} onChange={(v) => son('limpiarVoz', v)} />
            <Check label="Efectos: golpe en el gancho y whoosh en los cortes" checked={p.sonido.efectos} onChange={(v) => son('efectos', v)} />
          </div>
          <Field label="Música de fondo">
            <Segmented value={p.sonido.musica} options={MUSIC_CHOICES.map((m) => ({ id: m.id, label: m.label, hint: m.hint }))} onChange={(v) => son('musica', v)} />
          </Field>
          {p.sonido.musica === 'archivo' && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[220px] flex-1 space-y-1 text-[12px] text-fg-muted">
                <span className="block">Archivo de tu carpeta de música</span>
                <select value={p.sonido.musicaArchivo} onChange={(e) => son('musicaArchivo', e.target.value)} className="input-clean h-9 w-full px-2 text-[13px]">
                  <option value="">{musica.length ? 'Elige una canción' : 'La carpeta está vacía'}</option>
                  {musica.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void editorApi.openMusic()} className="btn-secondary h-9 px-3 text-[12px]">
                <FolderOpen className="h-3.5 w-3.5" /> Abrir carpeta
              </button>
              <button type="button" onClick={onMusicRefresh} className="btn-secondary h-9 px-3 text-[12px]">
                Actualizar lista
              </button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Range label="Música bajo la voz" value={p.sonido.musicaBajoVozDb} min={6} max={30} step={1} unit=" dB" disabled={p.sonido.musica === 'ninguna'} onChange={(v) => son('musicaBajoVozDb', v)} />
            <Range label="Baja más mientras hablas" value={p.sonido.duckingDb} min={0} max={15} step={1} unit=" dB" disabled={p.sonido.musica === 'ninguna'} onChange={(v) => son('duckingDb', v)} />
            <Range label="Efectos bajo la voz" value={p.sonido.efectosBajoVozDb} min={10} max={35} step={1} unit=" dB" disabled={!p.sonido.efectos} onChange={(v) => son('efectosBajoVozDb', v)} />
          </div>
          <p className="text-[11px] text-fg-subtle">Recomendado: música 12 dB bajo la voz, que baje 7 dB más cuando hablas, y efectos 20–25 dB bajo la voz.</p>
        </Section>

        {error && (
          <p className="flex items-center gap-2 text-[12px] text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={busy || p.nombre.trim().length < 2} className="btn-primary h-9 px-4 text-[13px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar perfil
          </button>
          {saved && <span className="text-[12px] text-fg-muted">Guardado</span>}
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-secondary h-9 px-4 text-[13px]">
              Cancelar
            </button>
          )}
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} className="btn-secondary h-9 px-3 text-[13px]">
              <Copy className="h-3.5 w-3.5" /> Duplicar
            </button>
          )}
          <button type="button" onClick={() => void editorApi.openFonts()} className="btn-secondary h-9 px-3 text-[13px]" title="Copia aquí archivos .ttf u .otf para usarlos en los subtítulos">
            <FolderOpen className="h-3.5 w-3.5" /> Mis fuentes
          </button>
          {onDelete && (
            <button type="button" onClick={remove} disabled={busy} className="btn-secondary ml-auto h-9 px-3 text-[13px] text-rose-600 dark:text-rose-400">
              <Trash2 className="h-3.5 w-3.5" /> Borrar
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
        <p className="text-[12px] font-medium text-fg-muted">Vista previa</p>
        <LookPreview look={p} width={210} />
        <p className="max-w-[210px] text-[11px] text-fg-subtle">Aproximada: el video final usa la misma fuente y colores.</p>
      </div>
    </div>
  );
}

// ── Piezas del formulario ─────────────────────────────────────────────────────

function Section({ title, toggle, children }: { title: string; toggle?: { on: boolean; set: (v: boolean) => void }; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {toggle && <Check label={toggle.on ? 'Activado' : 'Desactivado'} checked={toggle.on} onChange={toggle.set} />}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-[12px] text-fg-muted">
      <span className="block">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={`block space-y-1 text-[12px] text-fg-muted ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-fg">
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-minimal w-full"
      />
    </label>
  );
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  return (
    <label className={`block space-y-1 text-[12px] text-fg-muted ${disabled ? 'opacity-50' : ''}`}>
      <span className="block">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
        />
        <input
          value={text}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toUpperCase());
          }}
          className="input-clean h-9 w-full min-w-0 px-2 font-mono text-[12px] uppercase"
        />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer ${
            value === o.id ? 'border-accent bg-surface-2 font-medium text-fg' : 'border-line text-fg-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
