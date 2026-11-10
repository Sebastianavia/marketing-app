import fs from 'fs/promises';
import path from 'path';
import { MaterialError } from './material';

/** Tipos que se pueden adjuntar al chat de Claude (fotos, video, audio, PDF y textos de guion/brief). */
export const ATTACHABLE = /\.(jpe?g|png|webp|gif|mp4|mov|m4v|webm|mp3|wav|m4a|aac|pdf|txt|md|srt|csv|docx)$/i;
export const ATTACH_ACCEPT = 'image/*,video/*,audio/*,application/pdf,.txt,.md,.srt,.csv,.docx';
const MAX_BYTES = 500 * 1048576;

/**
 * Guarda los archivos del formulario (campo `archivos`) en `<carpeta>/adjuntos/` sin pisar los que
 * ya hay. Devuelve sus rutas relativas a la carpeta (lo que Claude recibe en el mensaje).
 */
export async function saveAttachments(carpeta: string, form: FormData): Promise<string[]> {
  const dir = path.join(/*turbopackIgnore: true*/ carpeta, 'adjuntos');
  await fs.mkdir(dir, { recursive: true });
  const saved: string[] = [];
  for (const v of form.getAll('archivos')) {
    if (!(v instanceof File)) continue;
    if (!ATTACHABLE.test(v.name)) throw new MaterialError(`Tipo de archivo no admitido: ${v.name}`);
    if (v.size > MAX_BYTES) throw new MaterialError(`${v.name} pesa más de 500 MB.`);
    const base = v.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'archivo';
    let name = base;
    for (let n = 2; await fs.stat(path.join(/*turbopackIgnore: true*/ dir, name)).then(() => true, () => false); n++) name = `${path.parse(base).name}-${n}${path.extname(base)}`;
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), Buffer.from(await v.arrayBuffer()));
    saved.push(`adjuntos/${name}`);
  }
  if (!saved.length) throw new MaterialError('No llegó ningún archivo.');
  return saved;
}
