'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Clapperboard, Loader2, Music2, Palette, Plus, Wrench } from 'lucide-react';
import type { EditProfile } from '@/config/editor-looks';
import type { EditSummary } from '@/lib/editor/types';
import { editorApi, type SystemStatus } from './editor-api';
import { NewEdit } from './NewEdit';
import { ProfilesPanel } from './ProfilesPanel';
import { EditsList } from './EditsList';
import { EditDetail } from './EditDetail';
import { ToolsPanel } from './ToolsPanel';
import { ManualPanel } from './ManualPanel';
import { AudioLibraryPanel } from './AudioLibraryPanel';

/**
 * Edición de video: subes un video en bruto, eliges tu perfil y la app lo transcribe,
 * la IA propone los cortes, tú revisas y FFmpeg arma el reel con tus subtítulos.
 * Todo corre en este PC; solo la transcripción y la IA llaman a servicios externos.
 */

type Tab = 'nueva' | 'ediciones' | 'perfiles' | 'manual' | 'audio' | 'herramientas';
const OPEN_KEY = 'lulo_editor_open';

export function VideoEditorView() {
  const [tab, setTab] = useState<Tab>('nueva');
  const [openId, setOpenId] = useState<string | null>(null);
  const [perfiles, setPerfiles] = useState<EditProfile[] | null>(null);
  const [profileFocus, setProfileFocus] = useState<string | undefined>();
  const [ediciones, setEdiciones] = useState<EditSummary[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshEdits = useCallback(async () => {
    try {
      setEdiciones(await editorApi.edits());
    } catch {
      // se reintenta en el próximo refresco
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, s, e] = await Promise.all([editorApi.profiles(), editorApi.system(), editorApi.edits()]);
        if (!alive) return;
        setPerfiles(p);
        setSystem(s);
        setEdiciones(e);
        // Retomar la edición que estaba abierta
        let last: string | null = null;
        try {
          last = localStorage.getItem(OPEN_KEY);
        } catch {
          last = null;
        }
        if (last && e.some((x) => x.id === last)) {
          setOpenId(last);
          setTab('ediciones');
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudo cargar la edición de video.');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const open = (id: string | null) => {
    setOpenId(id);
    try {
      if (id) localStorage.setItem(OPEN_KEY, id);
      else localStorage.removeItem(OPEN_KEY);
    } catch {
      // sin almacenamiento: no pasa nada
    }
  };

  // La lista se refresca sola mientras haya algo procesándose
  const anyWorking = ediciones.some((e) => ['en_cola', 'transcribiendo', 'analizando', 'renderizando'].includes(e.estado));
  useEffect(() => {
    if (!anyWorking || tab !== 'ediciones' || openId) return;
    const t = setInterval(() => void refreshEdits(), 2500);
    return () => clearInterval(t);
  }, [anyWorking, tab, openId, refreshEdits]);

  if (error) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-rose-600 dark:text-rose-400">
        <AlertCircle className="h-4 w-4" /> {error}
      </p>
    );
  }
  if (!perfiles) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }> = [
    { id: 'nueva', label: 'Nueva edición', icon: Plus },
    { id: 'ediciones', label: 'Mis ediciones', icon: Clapperboard, count: ediciones.length },
    { id: 'perfiles', label: 'Perfiles', icon: Palette, count: perfiles.length },
    { id: 'manual', label: 'Manual', icon: BookOpen },
    { id: 'audio', label: 'Audio', icon: Music2 },
    { id: 'herramientas', label: 'Herramientas', icon: Wrench },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5 border-b border-line pb-3" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(t.id);
                if (t.id !== 'ediciones') open(null);
                if (t.id === 'ediciones') void refreshEdits();
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors cursor-pointer ${
                active ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count ? <span className="rounded-md bg-surface px-1.5 text-[11px] tabular-nums text-fg-subtle">{t.count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === 'nueva' && (
        <NewEdit
          perfiles={perfiles}
          system={system}
          onCreated={(edit) => {
            void refreshEdits();
            setTab('ediciones');
            open(edit.id);
          }}
          onEditProfiles={(id) => {
            setProfileFocus(id);
            setTab('perfiles');
          }}
        />
      )}

      {tab === 'ediciones' &&
        (openId ? (
          <EditDetail id={openId} perfiles={perfiles} onBack={() => open(null)} onChanged={() => void refreshEdits()} />
        ) : (
          <EditsList ediciones={ediciones} onOpen={(id) => open(id)} />
        ))}

      {tab === 'herramientas' && <ToolsPanel system={system} />}
      {tab === 'manual' && <ManualPanel />}
      {tab === 'audio' && <AudioLibraryPanel />}

      {tab === 'perfiles' && (
        <ProfilesPanel
          perfiles={perfiles}
          initialId={profileFocus}
          musica={system?.musica ?? []}
          onMusicRefresh={() => {
            editorApi
              .system()
              .then(setSystem)
              .catch(() => undefined);
          }}
          onChanged={(list, selectId) => {
            setPerfiles(list);
            if (selectId) setProfileFocus(selectId);
          }}
        />
      )}
    </div>
  );
}
