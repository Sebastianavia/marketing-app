import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir } from '@/lib/data/data-dir';
import type { EditProfile } from '@/config/editor-looks';
import { ffmpeg } from './media';
import { generateMusic, sfxImpact, sfxWhoosh, writeWav } from './synth';

/**
 * Pasada de sonido (después del video):
 *  1. la voz ya viene limpia del render (graves fuera, ruido, compresor suave),
 *  2. efectos generados en sus eventos (golpe en el gancho, whoosh en los cortes con zoom), 20–25 dB bajo la voz,
 *  3. música (generada o tuya) N dB bajo la voz, que baja otros M dB mientras hablas (ducking),
 *  4. máster en dos pasadas a −14 LUFS y pico real ≤ −1,5 dB.
 * Todo con FFmpeg (sin Python).
 */

export interface SfxEvent {
  tipo: 'impacto' | 'whoosh';
  /** Segundo del video final. */
  t: number;
}

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];

/** Carpeta de música propia: <datos>/musica. */
export async function musicDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'musica');
  await fs.mkdir(d, { recursive: true });
  return d;
}

export async function listMusic(): Promise<string[]> {
  const d = await musicDir();
  return (await fs.readdir(d)).filter((f) => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase())).sort();
}

/** Volumen integrado (LUFS) y pico real (dBTP) de un archivo. */
export async function measureLoudness(file: string, maxSeconds?: number): Promise<{ lufs: number; tp: number }> {
  const out = await ffmpeg({
    args: ['-hide_banner', '-nostats', ...(maxSeconds ? ['-t', String(maxSeconds)] : []), '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    timeoutMs: 5 * 60 * 1000,
  });
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary);
  const tp = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  const num = (m: RegExpExecArray | null) => (m && m[1] !== '-inf' ? Number(m[1]) : -70);
  return { lufs: num(i), tp: num(tp) };
}

const STEREO = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

export interface FinalAudio {
  master: string;
  notas: string[];
}

/**
 * Mezcla y máster. `voz` es el WAV que sale del render (misma duración que el video).
 * Devuelve el WAV final dentro de la carpeta de trabajo.
 */
export async function buildFinalAudio(o: {
  carpeta: string;
  voz: string;
  duracion: number;
  perfil: EditProfile;
  eventos: SfxEvent[];
  seed: number;
}): Promise<FinalAudio> {
  const { carpeta, voz, duracion: D, perfil } = o;
  const sonido = perfil.sonido;
  const notas: string[] = [];
  const f = (name: string) => path.join(/*turbopackIgnore: true*/ carpeta, name);

  // Música
  let music: string | null = null;
  if (sonido.musica === 'pad' || sonido.musica === 'pulso') {
    const g = generateMusic(sonido.musica, D + 2, o.seed);
    music = f(`musica-${sonido.musica}.wav`);
    await writeWav(music, g.left, g.right);
    notas.push(sonido.musica === 'pad' ? 'Música suave generada.' : 'Música synth generada.');
  } else if (sonido.musica === 'archivo') {
    const name = path.basename(sonido.musicaArchivo || '');
    const file = name ? path.join(/*turbopackIgnore: true*/ await musicDir(), name) : '';
    if (!name || !fsSync.existsSync(file)) {
      throw new Error(`No encuentro tu música "${name || '(sin elegir)'}" en la carpeta de música. Elige otra en el perfil o cambia a música generada.`);
    }
    music = file;
    notas.push(`Música: ${name}.`);
  }

  // Efectos
  const eventos = sonido.efectos ? o.eventos.filter((e) => e.t >= 0 && e.t < D - 0.2).slice(0, 16) : [];
  if (eventos.some((e) => e.tipo === 'impacto')) await writeWav(f('sfx-impacto.wav'), sfxImpact());
  if (eventos.some((e) => e.tipo === 'whoosh')) await writeWav(f('sfx-whoosh.wav'), sfxWhoosh());

  let premix = voz;
  if (music || eventos.length) {
    const vozLufs = (await measureLoudness(voz)).lufs;
    const args: string[] = ['-y', '-hide_banner', '-i', voz];
    const graph: string[] = [];
    const mixIn: string[] = [];
    let idx = 1;

    graph.push(`[0:a]${STEREO}${music && sonido.duckingDb > 0 ? ',asplit=2[vo][vsc]' : '[vo]'}`);
    mixIn.push('[vo]');

    if (music) {
      const musicLufs = (await measureLoudness(music, 60)).lufs;
      const gain = vozLufs - sonido.musicaBajoVozDb - musicLufs;
      args.push('-stream_loop', '-1', '-i', music);
      const fadeOut = Math.max(0, D - 1.5);
      graph.push(
        `[${idx}:a]${STEREO},atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,volume=${gain.toFixed(2)}dB,` +
          `afade=t=in:d=0.6,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.5,apad=whole_dur=${D.toFixed(3)}[mq]`
      );
      if (sonido.duckingDb > 0) {
        // Umbral 14 dB por debajo de la voz: con este ratio la música baja ~duckingDb mientras hablas
        const th = Math.min(1, Math.max(0.001, Math.pow(10, (vozLufs - 14) / 20)));
        const ratio = Math.min(20, 1 / Math.max(0.05, 1 - sonido.duckingDb / 14));
        graph.push(`[mq][vsc]sidechaincompress=threshold=${th.toFixed(5)}:ratio=${ratio.toFixed(2)}:attack=40:release=450:knee=3[mus]`);
        mixIn.push('[mus]');
      } else {
        mixIn.push('[mq]');
      }
      idx++;
      notas.push(`Música ${sonido.musicaBajoVozDb} dB bajo la voz${sonido.duckingDb > 0 ? `, baja ${sonido.duckingDb} dB más mientras hablas` : ''}.`);
    }

    // Los efectos se normalizan a pico; un golpe corto suena ~12 dB por debajo de su pico
    const sfxDb = vozLufs - sonido.efectosBajoVozDb + 12;
    for (const e of eventos) {
      args.push('-i', f(e.tipo === 'impacto' ? 'sfx-impacto.wav' : 'sfx-whoosh.wav'));
      const ms = Math.max(0, Math.round(e.t * 1000));
      graph.push(
        `[${idx}:a]${STEREO},volume=${(e.tipo === 'impacto' ? sfxDb : sfxDb - 3).toFixed(2)}dB,adelay=${ms}|${ms},apad=whole_dur=${D.toFixed(3)},atrim=0:${D.toFixed(3)}[s${idx}]`
      );
      mixIn.push(`[s${idx}]`);
      idx++;
    }
    if (eventos.length) notas.push(`${eventos.length} efecto${eventos.length === 1 ? '' : 's'} de sonido, ~${sonido.efectosBajoVozDb} dB bajo la voz.`);

    // amix divide entre el número de entradas: todas duran D, así que se compensa con un volumen fijo
    graph.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:duration=first:dropout_transition=0,volume=${mixIn.length},${STEREO}[mix]`);
    await fs.writeFile(f('mezcla-filtros.txt'), graph.join(';\n'), 'utf-8');
    premix = f('mezcla.wav');
    await ffmpeg({
      cwd: carpeta,
      args: [...args, '-filter_complex', graph.join(';'), '-map', '[mix]', '-t', D.toFixed(3), '-c:a', 'pcm_s16le', premix],
      timeoutMs: 10 * 60 * 1000,
    });
  }

  if (!perfil.ritmo.normalizarAudio) return { master: premix, notas };

  // Máster en dos pasadas: medir y aplicar en lineal
  const target = 'I=-14:TP=-1.5:LRA=11';
  const measure = await ffmpeg({ args: ['-hide_banner', '-nostats', '-i', premix, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'] });
  const json = measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1);
  let m: Record<string, string> | null = null;
  try {
    m = JSON.parse(json);
  } catch {
    m = null;
  }
  const master = f('master.wav');
  const valid = m && [m.input_i, m.input_tp, m.input_lra, m.input_thresh].every((v) => v && v !== '-inf' && Number.isFinite(Number(v)));
  const af = valid
    ? `loudnorm=${target}:measured_I=${m!.input_i}:measured_TP=${m!.input_tp}:measured_LRA=${m!.input_lra}:measured_thresh=${m!.input_thresh}:offset=${m!.target_offset}:linear=true,aresample=48000`
    : `loudnorm=${target},aresample=48000`;
  await ffmpeg({ args: ['-y', '-hide_banner', '-i', premix, '-af', af, '-c:a', 'pcm_s16le', master], timeoutMs: 10 * 60 * 1000 });
  notas.push('Máster a −14 LUFS (dos pasadas).');
  return { master, notas };
}
