import fs from 'fs/promises';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { ffmpeg } from './media';
import { envStatus, findPython, getEnvSettings, matteModelPath, pythonScript, runProcess } from './python-env';
import type { EditWord } from './types';

/**
 * Pasos que usan el Python del PC: recorte del sujeto (RVM) y transcripción con Whisper.
 */

export class AdvancedUnavailable extends Error {}

/**
 * Mate del sujeto sobre `src` (video ya cortado y encuadrado). Escribe `out` (gris, blanco = persona).
 * `prueba`: sin PyTorch, solo para tests automáticos.
 */
export async function runMatte(o: {
  src: string;
  out: string;
  w: number;
  h: number;
  frames: number;
  onProgress?: (done: number, total: number, fps: number) => void;
  prueba?: boolean;
}): Promise<{ dispositivo: string }> {
  const py = await findPython();
  if (!py) throw new AdvancedUnavailable('No hay Python en este PC. Instálalo en Edición → Herramientas.');
  let model = '';
  if (!o.prueba) {
    if (!py.torch) throw new AdvancedUnavailable('Falta PyTorch. Instálalo en Edición → Herramientas.');
    const settings = await getEnvSettings();
    const m = await matteModelPath(settings.recorteModelo, py.cuda);
    if (!m) throw new AdvancedUnavailable('Falta el modelo de recorte. Descárgalo en Edición → Herramientas.');
    model = m.ruta;
  }
  let dispositivo = o.prueba ? 'prueba' : 'cpu';
  let error = '';
  const args = [
    ...py.args,
    pythonScript('lulo_matte.py'),
    '--ffmpeg',
    resolveFfmpegPath(),
    '--src',
    o.src,
    '--out',
    o.out,
    '--w',
    String(o.w),
    '--h',
    String(o.h),
    '--frames',
    String(o.frames),
    ...(o.prueba ? ['--prueba'] : ['--model', model]),
  ];
  const r = await runProcess(py.cmd, args, {
    timeoutMs: 4 * 60 * 60_000,
    onLine: (l) => {
      const p = /^PROGRESO (\d+) (\d+) ([\d.]+)/.exec(l);
      if (p) o.onProgress?.(Number(p[1]), Number(p[2]), Number(p[3]));
      const d = /^DISPOSITIVO (\S+)/.exec(l);
      if (d) dispositivo = d[1];
      if (l.startsWith('ERROR ')) error = l.slice(6);
    },
  });
  if (r.code !== 0) throw new Error(`El recorte falló: ${error || r.out.split(/\r?\n/).filter(Boolean).slice(-3).join(' ')}`);
  return { dispositivo };
}

/** Transcripción con Whisper en este PC. Devuelve palabras con tiempos. */
export async function transcribeLocal(o: { video: string; workWav: string; outJson: string; vocab?: string }): Promise<{ palabras: EditWord[]; dispositivo: string; modelo: string }> {
  const status = await envStatus();
  if (!status.whisperListo || !status.python) {
    throw new AdvancedUnavailable('Whisper no está listo en este PC. Instálalo en Edición → Herramientas o cambia la transcripción a ElevenLabs.');
  }
  const modelo = status.ajustes.whisperModelo;
  await ffmpeg({ args: ['-y', '-hide_banner', '-i', o.video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', o.workWav], timeoutMs: 10 * 60_000 });
  let error = '';
  let dispositivo = 'cpu';
  try {
    const r = await runProcess(
      status.python.cmd,
      [...status.python.args, pythonScript('lulo_whisper.py'), '--audio', o.workWav, '--out', o.outJson, '--lang', 'es', '--model', modelo, '--vocab', o.vocab ?? ''],
      {
        timeoutMs: 3 * 60 * 60_000,
        onLine: (l) => {
          if (l.startsWith('ERROR ')) error = l.slice(6);
          const d = /^DISPOSITIVO (\S+)/.exec(l);
          if (d) dispositivo = d[1];
        },
      }
    );
    if (r.code !== 0) throw new Error(`Whisper falló: ${error || r.out.split(/\r?\n/).filter(Boolean).slice(-3).join(' ')}`);
    const data = JSON.parse(await fs.readFile(o.outJson, 'utf-8')) as { words: Array<{ text: string; start: number; end: number }> };
    const palabras = data.words
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map((w) => ({ t: w.text.trim(), s: w.start, e: Math.max(w.start, w.end) }));
    return { palabras, dispositivo, modelo };
  } finally {
    await fs.rm(o.workWav, { force: true }).catch(() => undefined);
  }
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cajas de la cara (normalizadas 0–1) muestreadas a `fps` sobre el video base. */
export interface FaceTrack {
  fps: number;
  frames: Array<FaceBox | null>;
}

/** Detecta la cara en el video base con OpenCV. Devuelve null si el detector no está instalado. */
export async function runFaces(o: { src: string; out: string; w: number; h: number }): Promise<FaceTrack | null> {
  const py = await findPython();
  if (!py?.opencv) return null;
  const sw = 360;
  const sh = Math.round((o.h * sw) / o.w / 2) * 2;
  let error = '';
  const r = await runProcess(
    py.cmd,
    [...py.args, pythonScript('lulo_faces.py'), '--ffmpeg', resolveFfmpegPath(), '--src', o.src, '--sw', String(sw), '--sh', String(sh), '--fps', '4', '--out', o.out],
    {
      timeoutMs: 30 * 60_000,
      onLine: (l) => {
        if (l.startsWith('ERROR ')) error = l.slice(6);
      },
    }
  );
  if (r.code !== 0) throw new Error(`El detector de caras falló: ${error || r.out.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`);
  return JSON.parse(await fs.readFile(o.out, 'utf-8')) as FaceTrack;
}
