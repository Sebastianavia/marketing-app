import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getDataDir } from '@/lib/data/data-dir';

/**
 * Skills de video para los Claude de la app (editor, director, Estudio Claude).
 *
 * Los agentes arrancan con `--setting-sources local` en la carpeta de cada proyecto, así que no ven
 * las skills del repo. Se copian las elegidas a `<datos>/claude-skills/lulo-video/` como un plugin
 * y se cargan con `--plugin-dir` (probado con Claude Code 2.1.316: funciona con setting-sources
 * local). Fuera de la carpeta de herramientas para que Claude pueda leerlas pero no cambiarlas.
 * Fuente: `.agents/skills/` del repo (git); se vuelve a copiar cuando cambian.
 *
 * Fuera a propósito: las de HeyGen (el avatar y la voz van por las herramientas de Lulo) y las de
 * Remotion (renderizan con node y Chrome: no corren en el aislamiento ni se pueden renderizar desde
 * el servidor sin ejecutar código del proyecto). En la terminal del repo siguen disponibles.
 */
export const AGENT_VIDEO_SKILLS = [
  'hyperframes',
  'hyperframes-cli',
  'hyperframes-registry',
  'media-use',
  'reverse-any-video',
  'style-sampling',
  'camera-3d-captions',
  'duo',
  'p5-paint-animation',
  'vox-explainer',
  'video',
  'social',
  'ad-creative',
  'marketing-psychology',
] as const;

const PLUGIN_NAME = 'lulo-video';

function sourceDir(): string {
  // process.cwd() = frontend/ (igual que mcp/lulo-mcp.mjs en agent-runner)
  return path.join(/*turbopackIgnore: true*/ process.cwd(), '..', '.agents', 'skills');
}

export function videoSkillsRoot(): string {
  return path.join(/*turbopackIgnore: true*/ getDataDir(), 'claude-skills');
}

/** Huella de las skills de origen (tamaño y fecha de cada archivo). */
async function fingerprint(src: string, names: string[]): Promise<string> {
  const h = createHash('sha256');
  const walk = async (d: string) => {
    const entries = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(/*turbopackIgnore: true*/ d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const st = await fs.stat(full);
        h.update(`${path.relative(src, full)}:${st.size}:${st.mtimeMs}\n`);
      }
    }
  };
  for (const n of names) await walk(path.join(/*turbopackIgnore: true*/ src, n));
  return h.digest('hex');
}

let pending: Promise<string | null> | null = null;

/**
 * Deja el plugin al día y devuelve su carpeta (para `--plugin-dir`), o null si el repo no tiene
 * las skills. Nunca lanza: sin skills el agente funciona igual.
 */
export function ensureVideoSkillsPlugin(): Promise<string | null> {
  pending ??= build().finally(() => {
    pending = null;
  });
  return pending;
}

async function build(): Promise<string | null> {
  try {
    const src = sourceDir();
    const names = AGENT_VIDEO_SKILLS.filter((n) => fsSync.existsSync(path.join(/*turbopackIgnore: true*/ src, n, 'SKILL.md')));
    if (!names.length) return null;
    const dest = path.join(/*turbopackIgnore: true*/ videoSkillsRoot(), PLUGIN_NAME);
    const stamp = path.join(/*turbopackIgnore: true*/ dest, '.huella');
    const fp = await fingerprint(src, names);
    if ((await fs.readFile(stamp, 'utf8').catch(() => '')) === fp) return dest;

    // Se arma en una carpeta nueva y se cambia de una vez (un agente puede estar leyéndola)
    const tmp = `${dest}.nuevo-${process.pid}`;
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(path.join(/*turbopackIgnore: true*/ tmp, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(/*turbopackIgnore: true*/ tmp, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: PLUGIN_NAME, version: '1.0.0', description: 'Skills de video de Lulo Studio (HyperFrames, guiones, redes).' }, null, 2)
    );
    for (const n of names) {
      await fs.cp(path.join(/*turbopackIgnore: true*/ src, n), path.join(/*turbopackIgnore: true*/ tmp, 'skills', n), { recursive: true, dereference: true });
    }
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ tmp, '.huella'), fp);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(tmp, dest);
    return dest;
  } catch (err) {
    console.error('[skills-video]', err);
    return null;
  }
}

/** Bloque del prompt de sistema: qué skills hay y cómo encajan con las herramientas de Lulo. */
export function videoSkillsPrompt(o: { renderTool: string | null; entregar: string }): string {
  return `
## Skills de video (herramienta Skill)
Tienes skills de video (plugin lulo-video): hyperframes (léela primero para cualquier video hecho con código), hyperframes-registry (unos 450 bloques listos: subtítulos animados, títulos, transiciones, gráficos, movimientos de cámara), hyperframes-cli, media-use, reverse-any-video y style-sampling (copiar el estilo de un video viral), camera-3d-captions, duo (meme de dos pantallas), p5-paint-animation, vox-explainer, y para guion y estrategia: video, social, ad-creative y marketing-psychology. Cárgalas con la herramienta Skill cuando el pedido lo pida; no hace falta para cortes o subtítulos normales que ya hace la app.
Reglas al usarlas dentro de Lulo Studio:
- No ejecutes \`npx hyperframes events\`, \`feedback\`, \`auth\`, \`publish\`, \`cloud\`, \`lambda\` ni \`cloudrun\`; la telemetría está apagada.
- No uses HeyGen ni otros servicios de pago que mencionen las skills (voz, avatar, video generado): esos pasos van por las herramientas de Lulo, que piden aprobación. Lo gratis y local (FFmpeg, bloques del registry, fuentes, imágenes de la carpeta) sí.
- Crea el proyecto HyperFrames dentro de tu carpeta, p. ej. \`claude/<nombre>/\` (\`npx hyperframes init claude/<nombre> --non-interactive --skip-skills --resolution portrait\`; para bloques: \`npx hyperframes add …\`). Copia dentro los videos, audios e imágenes que use (sin enlaces simbólicos).
${o.renderTool ? `- Para revisar usa \`revisar_html_video\` y para renderizar \`${o.renderTool}\` (no \`npx hyperframes check\`, \`render\`, \`preview\` ni \`snapshot\`: en tu Bash no arranca Chrome; \`npx hyperframes lint\` sí funciona). \`calidad: draft\` mientras pruebas. Para superponer gráficos sobre un video: renderiza en webm (transparente) o con el video dentro de la composición, y combina con FFmpeg.` : '- Aquí no puedes renderizar HyperFrames: si hace falta, déjalo indicado para el editor de video.'}
- Mira los fotogramas del resultado (FFmpeg + Read) antes de entregarlo. ${o.entregar}`;
}
