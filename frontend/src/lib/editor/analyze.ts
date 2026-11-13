import { applyBackgroundReport, detectBackgroundVoices } from './voices';
import { detectRestarts } from './restarts';
import fs from 'fs/promises';
import { z } from 'zod';
import { orchestrateObject, FreeQuotaError, resolveMode } from '@/lib/ai/orchestrator';
import { startClaudeFirstPass } from './claude-agent';
import { transcribeWithElevenLabs } from '@/lib/generation/transcribe';
import { errorMessage } from '@/lib/errors';
import { extractAudio, ffmpeg } from './media';
import { transcribeLocal } from './advanced';
import { getEnvSettings } from './python-env';
import { parseSilences } from '@/lib/director-mode/voiceover';
import { buildPhrases, phraseText, formatClock, keptIntervals, totalDuration } from './timeline';
import { planGraphics } from './graphics';
import { editFile, getEdit, logActivity, updateEdit } from './edit-store';
import type { EditPhrase, EditProject, EditWord } from './types';

/**
 * Análisis de una edición:
 *  1. Transcripción palabra por palabra (ElevenLabs Scribe, de pago: ~$0.0037 por minuto).
 *  2. La IA (selector "IA" de la app: Gemini gratis o Claude) propone qué frases cortar,
 *     un texto gancho y las palabras clave a resaltar. Solo propone: la persona revisa.
 */

const AnalysisSchema = z.object({
  cortes: z
    .array(
      z.object({
        id: z.string().describe('id de la frase a cortar, p. ej. "f3"'),
        motivo: z.string().describe('Motivo corto en español: falso comienzo, repetición, muletilla, error, fuera de tema, comentario a cámara, para ajustar duración'),
      })
    )
    .describe('Frases que NO deben entrar al video. Vacío si todo sirve.'),
  gancho: z.string().describe('Texto gancho para los primeros segundos: máximo 8 palabras, en el idioma del video, sin emojis ni comillas'),
  resaltar: z.array(z.string()).describe('Una palabra clave por idea (máximo 15): números, resultados, nombres o la palabra con más fuerza de la frase. Una palabra cada una, tal como aparece en la transcripción. Se ven más grandes y en color.'),
  resumen: z.string().describe('Una o dos frases en español explicando qué cortaste y por qué'),
});

function systemPrompt(): string {
  return `Eres un editor profesional de videos cortos verticales (Reels, TikTok, Shorts) donde una persona habla a cámara.
Recibes la transcripción del video en bruto dividida en frases numeradas con sus tiempos.
Tu trabajo es decidir qué frases sobran para que el video quede limpio y con ritmo, como lo haría un buen editor humano.

Corta:
- Falsos comienzos: cuando la persona empieza una idea, se traba y la vuelve a decir. Conserva la ÚLTIMA versión completa y bien dicha; corta los intentos anteriores.
- Repeticiones de la misma idea o tomas repetidas (si grabó varias veces lo mismo, deja la mejor, normalmente la última).
- Frases que son solo muletillas o titubeos ("eh", "bueno…", "este…").
- Comentarios a cámara que no son contenido ("espera, lo hago de nuevo", "¿ya está grabando?", "corta").
- Frases claramente fuera de tema.

Nunca cortes contenido que haga falta para entender el mensaje. Si dudas, NO cortes.
Si el pedido pide una duración, elige las mejores frases para acercarte a ella sin romper el sentido.
Responde solo con el formato pedido.`;
}

function userPrompt(p: EditProject, phrases: EditPhrase[]): string {
  const perfil = p.perfil;
  const total = phrases.length ? phrases[phrases.length - 1].e : p.original.duracion;
  const lines = phrases.map((f) => `${f.id} [${f.s.toFixed(1)}–${f.e.toFixed(1)} s] ${f.palabras.map((w) => w.t).join(' ')}${f.voz === 'fondo' ? '  ← VOZ DE FONDO (no es la persona; ya se corta)' : ''}`);
  const parts = [
    perfil.sobreTi ? `SOBRE QUIEN HABLA:\n${perfil.sobreTi}` : '',
    perfil.instrucciones ? `REGLAS PROPIAS DE EDICIÓN (síguelas siempre):\n${perfil.instrucciones}` : '',
    `PEDIDO PARA ESTE VIDEO:\n${p.pedido.trim() || 'Limpiar el video: quitar errores y repeticiones.'}`,
    p.indicacion?.trim() ? `CAMBIO PEDIDO AHORA (prioridad alta):\n${p.indicacion.trim()}` : '',
    perfil.ritmo.quitarErrores
      ? ''
      : 'IMPORTANTE: esta persona NO quiere que cortes errores ni repeticiones. Corta solo si el pedido lo pide explícitamente.',
    `Duración del video en bruto: ${formatClock(total)} (${total.toFixed(1)} s).`,
    `TRANSCRIPCIÓN (${phrases.length} frases):\n${lines.join('\n')}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** Aplica la propuesta de la IA a las frases, validando los ids. Si lo cortara todo, no corta nada. */
function applyCuts(phrases: EditPhrase[], cortes: Array<{ id: string; motivo: string }>): EditPhrase[] {
  const valid = new Map<string, string>();
  for (const c of cortes) {
    const id = c.id.trim().toLowerCase();
    if (phrases.some((f) => f.id === id)) valid.set(id, c.motivo.trim().slice(0, 60) || 'propuesta de la IA');
  }
  if (valid.size >= phrases.length) valid.clear();
  // Las voces de fondo (Fase 8) se cortan siempre, diga lo que diga la IA
  return phrases.map((f) => (f.voz === 'fondo' ? f : { ...f, cortar: valid.has(f.id), motivo: valid.get(f.id) }));
}

/**
 * Whisper alarga palabras sobre los silencios (una palabra puede "durar" 3 s).
 * Si un silencio real de más de 0,3 s cae dentro de una palabra, se corta la palabra en ese silencio.
 */
async function trimToSilences(video: string, words: EditWord[]): Promise<EditWord[]> {
  let stderr = '';
  try {
    stderr = await ffmpeg({ args: ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'silencedetect=noise=-38dB:d=0.3', '-f', 'null', '-'], timeoutMs: 10 * 60_000 });
  } catch {
    return words;
  }
  const silences = parseSilences(stderr);
  return words.map((w) => {
    let { s, e } = w;
    for (const sil of silences) {
      if (sil.start > s + 0.05 && sil.start < e) e = Math.max(s + 0.05, sil.start);
      if (sil.end > s && sil.end < e - 0.05 && sil.start <= s) s = sil.end;
    }
    return { ...w, s, e };
  });
}

async function fail(id: string, err: unknown) {
  const code = err instanceof FreeQuotaError || (err as { code?: string })?.code === 'free_exhausted' ? 'free_exhausted' : undefined;
  const mensaje = errorMessage(err, 'No se pudo analizar el video.');
  await updateEdit(id, (p) => {
    p.estado = 'error';
    p.tarea = undefined;
    p.error = { mensaje, codigo: code, tarea: 'analizar' };
    logActivity(p, `Error: ${mensaje}`);
  });
}

export async function runAnalysis(id: string): Promise<void> {
  try {
    let p = await getEdit(id);

    // 1. Transcripción (solo una vez por video; volver a analizar no vuelve a pagar)
    if (!p.transcripcion) {
      if (!p.original.tieneAudio) throw new Error('El video no tiene audio: no hay nada que transcribir.');
      ({ edit: p } = await updateEdit(id, (x) => {
        x.estado = 'transcribiendo';
        logActivity(x, 'Transcribiendo el audio…');
      }));
      const settings = await getEnvSettings();
      let palabras: EditWord[];
      let costo = 0;
      let modelo: string;
      if (settings.transcriptor === 'whisper') {
        const r = await transcribeLocal({
          video: editFile(p, p.original.archivo),
          workWav: editFile(p, 'audio16k.wav'),
          outJson: editFile(p, 'whisper.json'),
          vocab: p.perfil.sobreTi.slice(0, 200),
        });
        // Whisper estira palabras sobre los silencios: se recortan con el silencio real del audio
        palabras = await trimToSilences(editFile(p, p.original.archivo), r.palabras);
        modelo = `whisper-${r.modelo} (${r.dispositivo})`;
      } else {
        const audio = editFile(p, 'audio-transcripcion.mp3');
        let r: Awaited<ReturnType<typeof transcribeWithElevenLabs>>;
        try {
          await extractAudio(editFile(p, p.original.archivo), audio);
          r = await transcribeWithElevenLabs(audio, { seconds: p.original.duracion, tool: 'video-editor', label: p.titulo, diarize: true });
        } finally {
          await fs.rm(audio, { force: true }).catch(() => undefined);
        }
        palabras = r.words
          .filter((w) => (w.type ?? 'word') === 'word' && w.text.trim())
          .map((w) => ({ t: w.text.trim(), s: Number(w.start), e: Number(w.end), ...(w.speaker_id ? { h: String(w.speaker_id) } : {}) }));
        costo = r.costUSD;
        modelo = r.model;
      }
      if (!palabras.length) throw new Error('No se escuchó ninguna palabra en el video. ¿Tiene voz?');
      ({ edit: p } = await updateEdit(id, (x) => {
        x.transcripcion = { palabras, costoUSD: costo, creada: new Date().toISOString(), modelo };
        x.costoUSD = Math.round(((x.costoUSD ?? 0) + costo) * 10000) / 10000;
        x.frases = buildPhrases(palabras);
        logActivity(x, `Audio transcrito con ${modelo}: ${palabras.length} palabras en ${x.frases.length} frases (${costo ? `$${costo.toFixed(4)}` : 'gratis'}).`);
      }));
    }

    // Frases: si no existen (p. ej. edición vieja), se reconstruyen desde las palabras
    if (!p.frases?.length && p.transcripcion) {
      ({ edit: p } = await updateEdit(id, (x) => {
        x.frases = buildPhrases(x.transcripcion!.palabras);
      }));
    }

    // Fase 8 · Cortes limpios: voces de fondo (hablantes, labios y voz sin transcribir). Gratis y local.
    if (!p.vocesFondo) {
      try {
        ({ edit: p } = await updateEdit(id, (x) => {
          x.estado = 'analizando';
          logActivity(x, 'Buscando voces de fondo (quién habla y si se mueven tus labios)…');
        }));
        const report = await detectBackgroundVoices(p);
        ({ edit: p } = await updateEdit(id, (x) => {
          applyBackgroundReport(x, report);
          logActivity(x, report.resumen);
          // Fase 9: arranques y tomas repetidas (queda la última), cortando por palabra
          const rs = detectRestarts(x.frases);
          if (rs.length) logActivity(x, `Arranques repetidos quitados (queda la última toma): ${rs.map((r) => `«${r.quitado}» (${r.en})`).join(', ')}.`);
        }));
      } catch (err) {
        await updateEdit(id, (x) => logActivity(x, `No se pudieron revisar las voces de fondo (${errorMessage(err)}).`));
      }
    }

    // Con Claude Code (suscripción o API Key), Claude (el que ve el video y usa herramientas) hace la edición
    // completa desde el principio: se le pasa el pedido como primer mensaje del chat.
    const resolved = await resolveMode(p.modoIA || undefined);
    if (!p.sinIA && (resolved === 'claude-subscription' || resolved === 'claude-apikey')) {
      // Primero se registra el turno de Claude y luego se libera la edición: así, cuando la
      // pantalla vea "por revisar", el chat ya encuentra a Claude trabajando.
      let started = true;
      await startClaudeFirstPass(id).catch(async (err) => {
        started = false;
        await updateEdit(id, (x) => logActivity(x, `Claude no pudo empezar (${errorMessage(err)}). Escríbele en el chat o renderiza a mano.`));
      });
      await updateEdit(id, (x) => {
        x.estado = 'por_revisar';
        x.tarea = undefined;
        x.error = undefined;
        x.indicacion = undefined;
        if (started) logActivity(x, 'Claude toma la edición: mira el video, decide los cortes y arma el borrador.');
      });
      return;
    }

    // 2. Propuesta de la IA
    if (p.sinIA) {
      ({ edit: p } = await updateEdit(id, (x) => {
        x.frases = x.frases.map((f) => (f.voz === 'fondo' ? f : { ...f, cortar: false, motivo: undefined }));
        x.resumenIA = 'Sin IA: solo se quitan las pausas largas.';
        logActivity(x, 'Sin IA: solo se quitarán las pausas.');
      }));
    } else {
      ({ edit: p } = await updateEdit(id, (x) => {
        x.estado = 'analizando';
        logActivity(x, 'La IA está revisando el guion: errores, repeticiones y gancho…');
      }));
      const { object, meta } = await orchestrateObject({
        tool: 'video-editor',
        description: `Edición · proponer cortes · ${p.titulo}`,
        system: systemPrompt(),
        prompt: userPrompt(p, p.frases),
        schema: AnalysisSchema,
        temperature: 0.2,
        mode: p.modoIA || undefined,
      });
      ({ edit: p } = await updateEdit(id, (x) => {
        x.frases = applyCuts(x.frases, object.cortes);
        const hook = object.gancho.replace(/["“”«»]/g, '').trim();
        x.gancho = hook.split(/\s+/).slice(0, 10).join(' ');
        x.resaltar = [...new Set(object.resaltar.map((w) => w.trim()).filter((w) => w && !/\s/.test(w)))].slice(0, 15);
        x.resumenIA = object.resumen.trim();
        x.costoUSD = Math.round(((x.costoUSD ?? 0) + meta.costUSD) * 10000) / 10000;
        x.indicacion = undefined;
        const n = x.frases.filter((f) => f.cortar).length;
        logActivity(x, `Guion listo (${meta.model}): ${n} frase${n === 1 ? '' : 's'} para cortar.`);
      }));
    }

    // 3. Plan de gráficos (si el perfil los quiere). Si falla, se sigue sin gráficos: no bloquea el video.
    if (!p.sinIA && p.perfil.graficos?.cantidad && p.perfil.graficos.cantidad !== 'ninguno') {
      try {
        ({ edit: p } = await updateEdit(id, (x) => logActivity(x, 'La IA planea los gráficos…')));
        const secs = totalDuration(keptIntervals(p.frases, p.perfil.ritmo, p.original.duracion));
        const plan = await planGraphics(p, secs);
        ({ edit: p } = await updateEdit(id, (x) => {
          x.graficos = plan.graficos;
          logActivity(x, `Plan de gráficos: ${plan.graficos.length}. ${plan.resumen}`);
        }));
      } catch (err) {
        await updateEdit(id, (x) => logActivity(x, `No se pudo planear los gráficos (${errorMessage(err)}). Puedes pedirlo de nuevo en la revisión.`));
      }
    }

    // 4. Revisar o seguir directo al video
    await updateEdit(id, (x) => {
      x.error = undefined;
      if (x.revisarAntes) {
        x.estado = 'por_revisar';
        x.tarea = undefined;
        logActivity(x, 'Listo para revisar.');
      } else {
        x.estado = 'en_cola';
        x.tarea = 'renderizar';
      }
    });
  } catch (err) {
    console.error('[edicion] análisis falló:', err);
    await fail(id, err);
  }
}

/** Texto de las frases conservadas (para el proyecto final). */
export function keptScript(p: EditProject): string {
  return p.frases.filter((f) => !f.cortar).map(phraseText).join(' ');
}
