// Cargador mínimo para correr scripts .ts/.mts con Node (≥ 23, tipos quitados de forma nativa):
// resuelve el alias "@/" a src/ y añade la extensión .ts a las importaciones relativas sin extensión.
// Uso: node --import ./scripts/ts-alias-loader.mjs scripts/<script>.mts
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
function withExt(url) {
  const file = fileURLToPath(url);
  for (const c of [file, file + '.ts', file + '.tsx', path.join(file, 'index.ts')]) if (statSync(c, { throwIfNoEntry: false })?.isFile()) return pathToFileURL(c).href;
  return url;
}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return { url: withExt(new URL(spec.slice(2), SRC).href), shortCircuit: true };
  const hasExt = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'].some((e) => spec.endsWith(e));
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:') && !hasExt) {
    return { url: withExt(new URL(spec, ctx.parentURL).href), shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) return next(url, { ...ctx, format: 'module-typescript' });
  return next(url, ctx);
}
`),
  import.meta.url
);
