'use client';

/** Llamadas de la carpeta de material (ver lib/material/material.ts). */

export type MaterialKind = 'imagen' | 'video' | 'audio' | 'pdf' | 'texto' | 'diseno' | 'otro';

export interface MaterialInfo {
  carpeta: string | null;
  problema?: string;
  total?: number;
  truncado?: boolean;
  tipos?: Partial<Record<MaterialKind, number>>;
  muestra?: string[];
}

export interface BrowseResult {
  ruta: string;
  padre: string | null;
  carpetas: { nombre: string; ruta: string }[];
  archivos: number;
  tipos: Partial<Record<MaterialKind, number>>;
  imagenes: string[];
  usable: boolean;
  problema: string | null;
  raices: { nombre: string; ruta: string }[];
  separador: string;
}

async function json<T>(r: Response, fallback: string): Promise<T> {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || fallback);
  return d as T;
}

export const materialApi = {
  get: (clave: string) => fetch(`/api/material?clave=${encodeURIComponent(clave)}`, { cache: 'no-store' }).then((r) => json<MaterialInfo>(r, 'No se pudo leer la carpeta de material.')),
  set: (clave: string, carpeta: string | null) =>
    fetch('/api/material', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave, carpeta }),
    }).then((r) => json<MaterialInfo>(r, 'No se pudo guardar la carpeta.')),
  browse: (ruta?: string) =>
    fetch(`/api/material/browse${ruta ? `?ruta=${encodeURIComponent(ruta)}` : ''}`, { cache: 'no-store' }).then((r) => json<BrowseResult>(r, 'No se pudo abrir la carpeta.')),
  imageUrl: (carpeta: string, archivo: string) => `/api/material/file?carpeta=${encodeURIComponent(carpeta)}&f=${encodeURIComponent(archivo)}`,
};

/** Sube adjuntos (campo `archivos`) a una ruta …/files y devuelve las rutas guardadas. */
export async function uploadAttachments(endpoint: string, files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of files) form.append('archivos', f);
  const r = await fetch(endpoint, { method: 'POST', body: form });
  const d = await json<{ archivos: string[] }>(r, 'No se pudieron adjuntar los archivos.');
  return d.archivos;
}

const KIND_LABEL: Record<MaterialKind, [string, string]> = {
  imagen: ['imagen', 'imágenes'],
  video: ['video', 'videos'],
  audio: ['audio', 'audios'],
  pdf: ['PDF', 'PDF'],
  texto: ['texto', 'textos'],
  diseno: ['archivo de diseño', 'archivos de diseño'],
  otro: ['otro', 'otros'],
};

export function describeKinds(tipos: Partial<Record<MaterialKind, number>> | undefined): string {
  const parts = Object.entries(tipos ?? {})
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${KIND_LABEL[k as MaterialKind][n === 1 ? 0 : 1]}`);
  return parts.join(' · ') || 'sin archivos';
}

export function folderName(ruta: string): string {
  return ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;
}
