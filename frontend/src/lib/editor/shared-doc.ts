import fs from 'fs/promises';
import path from 'path';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { feedbackConfigured, getJsonTagged, putJsonIfUnchanged } from '@/lib/feedback/r2';

/**
 * Documento JSON compartido por el equipo en el bucket R2 de feedback (como el manual, la
 * biblioteca de audio y las marcas): lectura con copia local, escritura condicional (If-Match) con
 * reintentos. Sin R2 configurado, el documento vive solo en este PC.
 */
export interface SharedDoc<T> {
  load(): Promise<{ data: T; compartido: boolean; aviso?: string }>;
  update<R>(fn: (d: T) => R): Promise<{ data: T; result: R }>;
}

export function sharedDoc<T extends { version?: number }>(key: string, localName: string, empty: () => T): SharedDoc<T> {
  const local = () => path.join(/*turbopackIgnore: true*/ getDataDir(), localName);
  const readLocal = async (): Promise<T | null> => {
    try {
      return JSON.parse(await fs.readFile(local(), 'utf8')) as T;
    } catch {
      return null;
    }
  };
  const saveLocal = async (d: T) => {
    await fs.mkdir(path.dirname(local()), { recursive: true });
    await writeJsonAtomic(local(), d).catch(() => undefined);
  };
  return {
    async load() {
      if (feedbackConfigured()) {
        try {
          const { data } = await getJsonTagged<T>(key);
          const d = data ?? (await readLocal()) ?? empty();
          await saveLocal(d);
          return { data: d, compartido: true };
        } catch (err) {
          return { data: (await readLocal()) ?? empty(), compartido: false, aviso: `Sin conexión con los datos compartidos (${err instanceof Error ? err.message : 'error'}): se usa la copia de este PC.` };
        }
      }
      return { data: (await readLocal()) ?? empty(), compartido: false, aviso: 'Solo en este PC: configura la app de feedback (FEEDBACK_R2_*) para compartirlo con el equipo.' };
    },
    async update(fn) {
      const apply = (d: T) => {
        const copy = JSON.parse(JSON.stringify(d)) as T;
        const result = fn(copy);
        copy.version = (d.version ?? 0) + 1;
        return { copy, result };
      };
      if (feedbackConfigured()) {
        for (let i = 0; i < 6; i++) {
          const { data, etag } = await getJsonTagged<T>(key);
          const { copy, result } = apply(data ?? (await readLocal()) ?? empty());
          if (await putJsonIfUnchanged(key, copy, data ? etag : null)) {
            await saveLocal(copy);
            return { data: copy, result };
          }
          await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
        }
        throw new Error('Otra persona está cambiando estos datos a la vez: vuelve a intentarlo.');
      }
      const { copy, result } = apply((await readLocal()) ?? empty());
      await saveLocal(copy);
      return { data: copy, result };
    },
  };
}
