'use client';

import type { EditProfile, ProfileInput } from '@/config/editor-looks';
import type { EditProject, EditSummary } from '@/lib/editor/types';
import type { EditorEnvSettings, EnvStatus, InstallJob, InstallTarget } from '@/lib/editor/python-env';

/** Llamadas de la pantalla de Edición a /api/editor/*. */

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.error || 'Algo salió mal.', r.status, d.code);
  return d as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface SystemStatus {
  ffmpeg: string | null;
  subtitulos: boolean;
  elevenlabs: boolean;
  carpetaFuentes: string;
  carpetaMusica: string;
  musica: string[];
  costoMinuto: number;
  videos: Array<{ ruta: string; titulo: string; categoria: string; fecha: string }>;
}

export const editorApi = {
  system: () => api<SystemStatus>('/api/editor/system'),
  openFonts: () => api<{ ok: boolean }>('/api/editor/system', { method: 'POST', ...json({ accion: 'abrir_fuentes' }) }),
  openMusic: () => api<{ ok: boolean }>('/api/editor/system', { method: 'POST', ...json({ accion: 'abrir_musica' }) }),
  profileFromReferences: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('imagenes', f));
    return api<{ perfil: ProfileInput; explicacion: string }>('/api/editor/profiles/from-references', { method: 'POST', body: form });
  },

  profiles: () => api<{ perfiles: EditProfile[] }>('/api/editor/profiles').then((d) => d.perfiles),
  createProfile: (p: ProfileInput) =>
    api<{ perfil: EditProfile }>('/api/editor/profiles', { method: 'POST', ...json(p) }).then((d) => d.perfil),
  updateProfile: (id: string, p: ProfileInput) =>
    api<{ perfil: EditProfile }>(`/api/editor/profiles/${id}`, { method: 'PUT', ...json(p) }).then((d) => d.perfil),
  deleteProfile: (id: string) => api<{ ok: boolean }>(`/api/editor/profiles/${id}`, { method: 'DELETE' }),

  env: (detectar = false) => api<{ estado: EnvStatus; instalaciones: InstallJob[] }>(`/api/editor/env${detectar ? '?detectar=1' : ''}`),
  install: (que: InstallTarget) => api<{ instalacion: InstallJob }>('/api/editor/env', { method: 'POST', ...json({ accion: 'instalar', que }) }),
  envSettings: (patch: Partial<Omit<EditorEnvSettings, 'python'>>) =>
    api<{ ajustes: EditorEnvSettings }>('/api/editor/env', { method: 'POST', ...json({ accion: 'ajustes', ...patch }) }),
  proposeGraphics: (id: string) => api<{ edicion: EditProject }>(`/api/editor/projects/${id}`, { method: 'POST', ...json({ accion: 'proponer_graficos' }) }),

  edits: () => api<{ ediciones: EditSummary[] }>('/api/editor/projects').then((d) => d.ediciones),
  edit: (id: string) => api<{ edicion: EditProject }>(`/api/editor/projects/${id}`).then((d) => d.edicion),
  action: (id: string, body: Record<string, unknown>) =>
    api<{ edicion: EditProject }>(`/api/editor/projects/${id}`, { method: 'POST', ...json(body) }).then((d) => d.edicion),
  remove: (id: string) => api<{ ok: boolean }>(`/api/editor/projects/${id}`, { method: 'DELETE' }),
  openFolder: (id: string) => api<{ ok: boolean }>(`/api/editor/projects/${id}/folder`, { method: 'POST' }),

  fromProjects: (meta: NewEditPayload & { rutaLocal: string }) =>
    api<{ edicion: EditProject }>('/api/editor/projects', { method: 'POST', ...json(meta) }).then((d) => d.edicion),
};

export interface NewEditPayload {
  titulo: string;
  pedido: string;
  perfilId: string;
  revisarAntes: boolean;
  carpetaMaterial?: string;
}

/**
 * Sube el video como cuerpo de la petición (el servidor lo escribe a disco por partes).
 * XMLHttpRequest en vez de fetch: es lo único que informa el progreso de subida.
 */
export function uploadEdit(file: File, meta: NewEditPayload, onProgress: (pct: number) => void): Promise<EditProject> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/editor/projects');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Edit-Meta', encodeURIComponent(JSON.stringify({ ...meta, archivo: file.name })));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let d: { edicion?: EditProject; error?: string; code?: string } = {};
      try {
        d = JSON.parse(xhr.responseText);
      } catch {
        // respuesta vacía
      }
      if (xhr.status >= 200 && xhr.status < 300 && d.edicion) resolve(d.edicion);
      else reject(new ApiError(d.error || 'No se pudo subir el video.', xhr.status, d.code));
    };
    xhr.onerror = () => reject(new ApiError('Se cortó la conexión con la app mientras subía el video.', 0));
    xhr.send(file);
  });
}

export const mediaUrl = (id: string, f: 'original' | 'borrador' | 'portada', version?: number) =>
  `/api/editor/projects/${id}/media?f=${f}${version ? `&v=${version}` : ''}`;

export const downloadUrl = (id: string, f: 'borrador' | 'portada' = 'borrador') => `/api/editor/projects/${id}/media?f=${f}&descargar=1`;

/** Datos editables de un perfil guardado (sin id ni fechas). */
export function toInput(p: EditProfile): ProfileInput {
  const { id: _id, creado: _c, actualizado: _a, ...rest } = p;
  void _id;
  void _c;
  void _a;
  return JSON.parse(JSON.stringify(rest)) as ProfileInput;
}

