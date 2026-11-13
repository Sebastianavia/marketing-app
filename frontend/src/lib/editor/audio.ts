import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir } from '@/lib/data/data-dir';
import type { EditProfile } from '@/config/editor-looks';
import { ffmpeg } from './media';
import { generateMusic, sfxImpact, sfxWhoosh, writeWav } from './synth';
import { generateStyledMusic, MUSIC_CATALOG } from './music';
import { buildSfxTrack, decodeMono, sfxSamples, type SfxPlacement } from './sfx';
import type { ResolvedDirection } from './direction';
import type { SubWord } from './timeline';
import { applyCorrections, buildAmbientTrack, processVoice } from './voice';

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

/**
 * Volumen final por red (LUFS integrados). Instagram y YouTube normalizan a ≈ −14: más fuerte no
 * suena más alto, solo se aplasta. TikTok normaliza menos: −13 sin perder dinámica.
 */
export const LOUDNESS_BY_NETWORK: Record<string, number> = { instagram: -14, shorts: -14, tiktok: -13 };

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
  /** Plan de Claude: su música y sus efectos sustituyen a los del perfil. */
  direccion?: ResolvedDirection | null;
  /** Palabras con tiempos del video (para atenuar respiraciones entre ellas). */
  words?: SubWord[];
}): Promise<FinalAudio> {
  const { carpeta, duracion: D, perfil } = o;
  const sonido = perfil.sonido;
  const notas: string[] = [];
  const f = (name: string) => path.join(/*turbopackIgnore: true*/ carpeta, name);

  // Voz: palabras corregidas con la voz clonada, mejora, respiraciones y efectos por tramo (solo con plan)
  let voz = o.voz;
  if (o.direccion?.correcciones.length) {
    voz = await applyCorrections(carpeta, voz, D, o.direccion.correcciones);
    notas.push(`${o.direccion.correcciones.length} palabra(s) corregida(s) con la voz clonada.`);
  }
  if (o.direccion?.voz) {
    const pv = await processVoice({ carpeta, voz, D, plan: o.direccion.voz, words: o.words ?? [] });
    voz = pv.file;
    notas.push(...pv.notas);
  }

  // Música (la del plan de Claude manda; si el plan no dice nada, la del perfil)
  let music: string | null = null;
  let musicBajoVoz = sonido.musicaBajoVozDb;
  let ducking = sonido.duckingDb;
  let musicStart = 0;
  let musicSections: Array<{ desde: number; hasta: number; energia: string }> = [];
  const dm = o.direccion?.musica;
  if (dm) {
    musicBajoVoz = dm.bajoVozDb;
    ducking = dm.ducking;
    if (dm.modo === 'generada' && dm.estilo) {
      const g = generateStyledMusic(dm.estilo, D + 0.5, dm.secciones, o.seed, !o.direccion?.bucle);
      music = f(`musica-${dm.estilo}.wav`);
      await writeWav(music, g.left, g.right);
      notas.push(`Música ${dm.estilo} generada (${MUSIC_CATALOG[dm.estilo].bpm} BPM${dm.secciones.length ? `, ${dm.secciones.length} secciones` : ''}).`);
    } else if (dm.modo === 'archivo' && dm.abs) {
      music = dm.abs;
      musicStart = dm.inicioArchivo;
      musicSections = dm.secciones;
      notas.push(`Música: ${path.basename(dm.abs)}.`);
    } else if (dm.modo === 'archivo') {
      notas.push('No se encontró la música elegida por Claude: va sin música.');
    }
  } else if (sonido.musica === 'pad' || sonido.musica === 'pulso') {
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

  // Efectos del plan de Claude: todos en una pista (sin límite práctico de cantidad)
  let sfxTrack: string | null = null;
  const plan = o.direccion?.sonidos ?? [];
  if (plan.length) {
    const placements: SfxPlacement[] = [];
    const decoded = new Map<string, Float32Array>();
    for (const s of plan) {
      let muestras: Float32Array;
      if (s.tipo === 'archivo' && s.abs) {
        if (!decoded.has(s.abs)) decoded.set(s.abs, await decodeMono(s.abs).catch(() => new Float32Array(0)));
        muestras = decoded.get(s.abs)!;
      } else if (s.tipo !== 'archivo') muestras = sfxSamples(s.tipo);
      else continue;
      if (muestras.length) placements.push({ t: s.t, muestras, volumenDb: s.volumen, pan: s.pan });
    }
    const tr = buildSfxTrack(D, placements);
    sfxTrack = f('sfx-pista.wav');
    await writeWav(sfxTrack, tr.left, tr.right);
    notas.push(`${placements.length} efectos de sonido elegidos por Claude, ~${sonido.efectosBajoVozDb} dB bajo la voz.`);
  }

  // Efectos automáticos del perfil (solo sin plan)
  const eventos = sonido.efectos && !o.direccion ? o.eventos.filter((e) => e.t >= 0 && e.t < D - 0.2).slice(0, 16) : [];
  if (eventos.some((e) => e.tipo === 'impacto')) await writeWav(f('sfx-impacto.wav'), sfxImpact());
  if (eventos.some((e) => e.tipo === 'whoosh')) await writeWav(f('sfx-whoosh.wav'), sfxWhoosh());

  // Ambientes de fondo (una pista con todos, cada uno a su nivel respecto a la voz)
  let ambTrack: string | null = null;
  let vozLufsCache: number | null = null;
  const vozLoudness = async () => (vozLufsCache ??= (await measureLoudness(voz)).lufs);
  const ambs = o.direccion?.ambientes ?? [];
  if (ambs.length) {
    const tr = await buildAmbientTrack(D, ambs, await vozLoudness(), o.seed);
    if (tr.usados) {
      ambTrack = f('ambiente-pista.wav');
      await writeWav(ambTrack, tr.left, tr.right);
      notas.push(`${tr.usados} ambiente${tr.usados === 1 ? '' : 's'} de fondo.`);
    }
  }

  let premix = voz;
  if (music || eventos.length || sfxTrack || ambTrack) {
    const vozLufs = await vozLoudness();
    const args: string[] = ['-y', '-hide_banner', '-i', voz];
    const graph: string[] = [];
    const mixIn: string[] = [];
    let idx = 1;

    graph.push(`[0:a]${STEREO}${music && ducking > 0 ? ',asplit=2[vo][vsc]' : '[vo]'}`);
    mixIn.push('[vo]');

    if (music) {
      const musicLufs = (await measureLoudness(music, 60)).lufs;
      const gain = vozLufs - musicBajoVoz - musicLufs;
      args.push('-stream_loop', '-1', ...(musicStart > 0 ? ['-ss', musicStart.toFixed(2)] : []), '-i', music);
      // En bucle la música no se desvanece al final (el video vuelve a empezar): solo un corte limpio
      const loop = !!o.direccion?.bucle;
      const fadeOut = Math.max(0, D - (loop ? 0.08 : 1.5));
      // Secciones sobre un archivo: silencio = 0, suave = −9 dB (rampas de 0,15 s)
      const sectionVol = musicSections.length
        ? `,volume='${musicSections
            .filter((x) => x.energia !== 'completa')
            .map((x) => {
              const depth = x.energia === 'silencio' ? 1 : 0.65;
              return `-${depth}*clip(min((t-${x.desde.toFixed(3)})/0.15,(${x.hasta.toFixed(3)}-t)/0.15),0,1)`;
            })
            .join('')
            .replace(/^/, '1') || '1'}':eval=frame`
        : '';
      graph.push(
        `[${idx}:a]${STEREO},atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,volume=${gain.toFixed(2)}dB${sectionVol},` +
          `afade=t=in:d=0.6,afade=t=out:st=${fadeOut.toFixed(3)}:d=${loop ? '0.08' : '1.5'},apad=whole_dur=${D.toFixed(3)}[mq]`
      );
      if (ducking > 0) {
        // Umbral 14 dB por debajo de la voz: con este ratio la música baja ~duckingDb mientras hablas
        const th = Math.min(1, Math.max(0.001, Math.pow(10, (vozLufs - 14) / 20)));
        const ratio = Math.min(20, 1 / Math.max(0.05, 1 - ducking / 14));
        graph.push(`[mq][vsc]sidechaincompress=threshold=${th.toFixed(5)}:ratio=${ratio.toFixed(2)}:attack=40:release=450:knee=3[mus]`);
        mixIn.push('[mus]');
      } else {
        mixIn.push('[mq]');
      }
      idx++;
      notas.push(`Música ${musicBajoVoz} dB bajo la voz${ducking > 0 ? `, baja ${ducking} dB más mientras hablas` : ''}.`);
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
    if (sfxTrack) {
      // La pista de efectos tiene 6 dB de margen (buildSfxTrack): se compensa aquí
      args.push('-i', sfxTrack);
      graph.push(`[${idx}:a]${STEREO},volume=${(sfxDb + 6).toFixed(2)}dB,apad=whole_dur=${D.toFixed(3)},atrim=0:${D.toFixed(3)}[sfx]`);
      mixIn.push('[sfx]');
      idx++;
    }

    if (ambTrack) {
      // Ya viene a su nivel respecto a la voz (buildAmbientTrack)
      args.push('-i', ambTrack);
      graph.push(`[${idx}:a]${STEREO},apad=whole_dur=${D.toFixed(3)},atrim=0:${D.toFixed(3)}[amb]`);
      mixIn.push('[amb]');
      idx++;
    }

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

  // Máster en dos pasadas: medir y aplicar en lineal. Volumen por red (lo que pida el plan manda)
  const lufs = o.direccion?.volumenFinal ?? LOUDNESS_BY_NETWORK[perfil.red] ?? -14;
  const target = `I=${lufs}:TP=-1.5:LRA=11`;
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
  notas.push(`Máster a ${String(lufs).replace('-', '−')} LUFS (dos pasadas).`);
  return { master, notas };
}
