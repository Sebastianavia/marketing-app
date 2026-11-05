import path from 'path';

/**
 * ¿`target` está dentro de `root` (o es `root`)? Resuelve `..` y, en Windows, compara sin
 * distinguir mayúsculas (C:\Users y c:\users son la misma carpeta). Para validar rutas que
 * llegan de Claude o de la pantalla antes de leer o escribir.
 */
export function isInside(root: string, target: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(/*turbopackIgnore: true*/ p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const base = norm(root);
  const t = norm(target);
  return t === base || t.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}
