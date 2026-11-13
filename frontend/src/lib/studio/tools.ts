import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import { errorMessage } from '@/lib/errors';
import { getStorageBasePath } from '@/lib/storage/project-storage';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { generateStoryboard, reviseScene } from '@/services/ugc-studio/orchestrator.service';
import { dispatchSceneRender, getSceneRenderStatus, planSceneRender } from '@/services/ugc-studio/scene-render.service';
import { assembleStoryboard } from '@/services/ugc-studio/assemble.service';
import { sanitizeSettings, type ReferenceRole, type Storyboard, type UgcReference } from '@/types/ugc-studio.types';
import { createEdit } from '@/lib/editor/actions';
import { getEdit } from '@/lib/editor/edit-store';
import { listProfiles } from '@/lib/editor/profile-store';
import { isTurnActive, sendToClaude } from '@/lib/editor/claude-agent';
import { ACTIVE_STATUSES } from '@/lib/editor/types';
import { defaultAppUrl } from '@/lib/ai/claude-code/agent-runner';
import { ffmpeg, probeVideo } from '@/lib/editor/media';
import { StudioError, getStudioProject, insideStudio, newApprovalId, newMediaId, updateStudioProject, type StudioProject } from './store';
import { STUDIO_SERVICES } from './services';
import { getAvatar, avatarPhotoPath, listAvatars } from '@/lib/avatars/avatar-store';
import { getStoredVoices } from '@/lib/storage/voice-storage';
import { getConfiguredVoiceId } from '@/services/elevenlabs/elevenlabs.service';
import { synthesizeSpeech } from '@/lib/generation/voice';
import { createRenderJob } from '@/lib/jobs/create-job';
import { getJob } from '@/lib/jobs/job-store';
import { probeMedia } from '@/lib/video/ffmpeg';
import { ttsCost, videoRate } from '@/config/cost-rates';
import { DEFAULT_ELEVEN_MODEL, ELEVEN_MODELS, isKnownElevenModel } from '@/config/elevenlabs-models';
import { generateImages, imageUnitPrice } from '@/lib/generation/image';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, getImageModel, isValidImageModelId } from '@/config/image-models';

import { isInside } from '@/lib/fs/inside';
import { CODE_CHECK_DESCRIPTION, CODE_VIDEO_BATCH_DESCRIPTION, CodeCheckSchema, CodeVideoBatchSchema, CodeVideoError, checkCodeVideo, renderCodeVideos } from '@/lib/ai/claude-code/code-video';
import { SEEDANCE_MODELS, transformVideoSeedance, validateAndBuildSeedancePayload } from '@/services/faceswap.service';
import type { SeedanceModelId, SeedanceResolution, SeedanceSize, SeedanceTransformInput } from '@/types/faceswap.types';
import { downloadToLibrary } from '@/lib/storage/generated-library';
import { assertWithinDailyLimit, recordUsage } from '@/lib/usage/usage-store';
import { getSettings } from '@/lib/data/settings';
import { feedbackForClaude, originFeedbackForClaude, respondFromAgent, reviewUrl, takeFeedbackFromAgent, uploadToFeedback } from '@/lib/feedback/feedback';

/**
 * Herramientas de Claude en el Estudio Claude (MCP lulo-studio-chat, LULO_TOOLSET=studio).
 * Encadenan herramientas de la app que ya funcionan: UGC Studio (storyboard → costo → render →
 * montaje) y Edición de video (Claude editor). Lo que cuesta dinero exige una aprobación de la
 * persona en el chat (pedir_aprobacion → tarjeta → la persona aprueba en la app).
 */

interface StudioTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (studioId: string, input: z.infer<S>) => Promise<unknown>;
}
const tool = <S extends z.ZodType>(t: StudioTool<S>) => t as unknown as StudioTool;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token = (id: string) => `[[media:${id}]]`;

/** Una ruta que puede venir relativa a la carpeta del proyecto o absoluta dentro de la carpeta de proyectos. */
async function resolveFile(p: StudioProject, file: string): Promise<string> {
  if (path.isAbsolute(file)) {
    if (!isInside(await getStorageBasePath(), file)) throw new StudioError('Solo se pueden usar archivos de la carpeta de proyectos.');
    return path.resolve(file);
  }
  return insideStudio(p, file);
}

function kindOf(file: string): 'video' | 'imagen' | 'audio' {
  const ext = path.extname(file).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) return 'audio';
  return 'imagen';
}

async function registerMedia(studioId: string, ruta: string, titulo: string) {
  const id = newMediaId();
  await updateStudioProject(studioId, (p) => {
    p.medios.push({ id, tipo: kindOf(ruta), ruta, titulo, creado: new Date().toISOString() });
  });
  return id;
}

/** Aprobación vigente con saldo suficiente para gastar `needUSD`. */
function assertBudget(p: StudioProject, approvalId: string, needUSD: number) {
  const a = p.aprobaciones.find((x) => x.id === approvalId);
  if (!a) throw new StudioError('Esa aprobación no existe: usa pedir_aprobacion.', 404);
  if (a.estado === 'pendiente') throw new StudioError('La persona todavía no aprobó ese gasto. Termina tu turno y espera.', 403);
  if (a.estado === 'rechazada') throw new StudioError('La persona rechazó ese gasto.', 403);
  const left = a.montoUSD * 1.1 - a.usadoUSD; // 10 % de margen, como en el Director
  if (needUSD > left + 1e-4) {
    throw new StudioError(`Esto costaría $${needUSD.toFixed(3)} y quedan $${Math.max(0, left).toFixed(3)} de lo aprobado. Pide otra aprobación.`, 409);
  }
  return a;
}

function ugcSummary(sb: Storyboard) {
  return {
    titulo: sb.title,
    gancho: sb.hook,
    cta: sb.cta,
    revisionClaude: sb.claudeReview?.resumen,
    escenas: sb.scenes.map((s) => ({
      escena: s.index,
      segundos: s.durationSeconds,
      dialogo: s.dialogue.map((d) => `${d.speaker}: ${d.line}`).join(' / '),
      transicion: s.transition.type,
      renderizada: Boolean(s.render?.videoUrl),
    })),
  };
}

// ── Servicios y proyecto ────────────────────────────────────────────────────

const servicios = tool({
  name: 'servicios',
  description: 'Qué herramientas de la app puedes usar desde el estudio, su estado (listo / en pruebas / en construcción) y costo aproximado.',
  schema: z.object({}),
  run: async () => ({ servicios: STUDIO_SERVICES }),
});

const verProyecto = tool({
  name: 'ver_proyecto',
  description: 'Estado del proyecto del estudio: adjuntos que subió la persona, storyboard UGC (si hay), videos mostrados, aprobaciones de gasto y ediciones.',
  schema: z.object({}),
  run: async (id) => {
    const p = await getStudioProject(id);
    const adjuntos = fsSync.existsSync(path.join(/*turbopackIgnore: true*/ p.carpeta, 'adjuntos'))
      ? (await fs.readdir(path.join(/*turbopackIgnore: true*/ p.carpeta, 'adjuntos'))).map((f) => `adjuntos/${f}`)
      : [];
    return {
      titulo: p.titulo,
      carpeta: p.carpeta,
      adjuntos,
      ugc: p.ugc ? { ...ugcSummary(p.ugc.storyboard), videoFinal: p.ugc.finalPath ?? null } : null,
      medios: p.medios.map((m) => ({ id: m.id, tipo: m.tipo, titulo: m.titulo, token: token(m.id) })),
      aprobaciones: p.aprobaciones,
      ediciones: p.ediciones,
      gastoUSD: p.gastoUSD,
    };
  },
});

const pedirAprobacion = tool({
  name: 'pedir_aprobacion',
  description:
    'Pide a la persona que apruebe un gasto (aparece una tarjeta con botones en el chat). Devuelve el id. Después TERMINA tu turno: cuando apruebe, recibirás un mensaje y podrás seguir. Pide el total de una vez (p. ej. todo el render).',
  schema: z.object({ concepto: z.string().min(3).max(200), montoUSD: z.number().positive().max(20) }),
  run: async (id, { concepto, montoUSD }) => {
    const ap = { id: newApprovalId(), concepto, montoUSD: Number(montoUSD.toFixed(4)), usadoUSD: 0, estado: 'pendiente' as const, pedida: new Date().toISOString() };
    await updateStudioProject(id, (p) => {
      p.aprobaciones.push(ap);
    });
    return { aprobacionId: ap.id, nota: 'Tarjeta mostrada en el chat. Termina tu turno y espera a que la persona apruebe.' };
  },
});

const mostrar = tool({
  name: 'mostrar',
  description:
    'Muestra un video, imagen o audio en el chat. `archivo`: ruta relativa a tu carpeta o absoluta dentro de la carpeta de proyectos. Devuelve un token [[media:ID]]: escríbelo tal cual en tu respuesta, en su propia línea, donde quieras que aparezca.',
  schema: z.object({ archivo: z.string().min(1).max(500), titulo: z.string().min(1).max(120) }),
  run: async (id, { archivo, titulo }) => {
    const p = await getStudioProject(id);
    const ruta = await resolveFile(p, archivo);
    if (!fsSync.existsSync(ruta)) throw new StudioError(`No existe ${archivo}.`, 404);
    return { token: token(await registerMedia(id, ruta, titulo)) };
  },
});

const verFotogramas = tool({
  name: 'ver_fotogramas',
  description:
    'Saca una hoja de fotogramas (8 imágenes) de un video, aunque esté fuera de tu carpeta (p. ej. el video final de UGC o un borrador del editor), y la deja en ./claude/fotogramas/ para que la mires con Read.',
  schema: z.object({ archivo: z.string().min(1).max(500) }),
  run: async (id, { archivo }) => {
    const p = await getStudioProject(id);
    const src = await resolveFile(p, archivo);
    const info = await probeVideo(src);
    const dir = path.join(/*turbopackIgnore: true*/ p.carpeta, 'claude', 'fotogramas');
    await fs.mkdir(dir, { recursive: true });
    const name = `hoja-${Date.now()}.jpg`;
    const fps = Math.max(0.1, 8 / Math.max(1, info.duracion));
    await ffmpeg({ args: ['-y', '-hide_banner', '-i', src, '-vf', `fps=${fps.toFixed(3)},scale=240:-1,tile=4x2`, '-frames:v', '1', path.join(dir, name)], timeoutMs: 120_000 });
    return { imagen: `claude/fotogramas/${name}`, duracionSeg: info.duracion, tamano: `${info.ancho}x${info.alto}` };
  },
});

// ── UGC Studio ──────────────────────────────────────────────────────────────

const ugcStoryboard = tool({
  name: 'ugc_storyboard',
  description:
    'UGC Studio: el equipo de agentes (Gemini) arma el storyboard y Claude jefe de producción lo revisa. $0. Tarda 2–4 min. `referencias`: fotos de tu carpeta (p. ej. adjuntos/producto.jpg) con su rol. Reemplaza el storyboard anterior del proyecto.',
  schema: z.object({
    brief: z.string().min(10).max(4000),
    referencias: z
      .array(z.object({ archivo: z.string(), rol: z.enum(['personaje', 'producto', 'locacion', 'estilo', 'otro']), etiqueta: z.string().max(120) }))
      .max(6)
      .default([]),
    ajustes: z
      .object({
        segundosTotales: z.number().int().min(5).max(60).optional(),
        escenasMax: z.number().int().min(1).max(6).optional(),
        resolucion: z.enum(['480p', '768p']).optional(),
        formato: z.enum(['9:16', '16:9', '1:1']).optional(),
        idioma: z.enum(['es', 'en', 'pt']).optional(),
      })
      .default({}),
  }),
  run: async (id, { brief, referencias, ajustes }) => {
    const p = await getStudioProject(id);
    const references: UgcReference[] = [];
    for (const [i, r] of referencias.entries()) {
      const file = await resolveFile(p, r.archivo);
      const up = await cloudinaryStorageService.uploadImage(await fs.readFile(file), path.basename(file), 'lulo-studio/ugc-studio/references');
      references.push({ id: `ref${i + 1}`, url: up.publicUrl, role: r.rol as ReferenceRole, label: r.etiqueta });
    }
    const settings = sanitizeSettings({
      ...(ajustes.segundosTotales ? { maxTotalSeconds: ajustes.segundosTotales } : {}),
      ...(ajustes.escenasMax ? { maxScenes: ajustes.escenasMax } : {}),
      ...(ajustes.resolucion ? { resolution: ajustes.resolucion } : {}),
      ...(ajustes.formato ? { aspectRatio: ajustes.formato } : {}),
      ...(ajustes.idioma ? { language: ajustes.idioma } : {}),
    });
    const storyboard = await generateStoryboard({ brief, references, settings }, () => {});
    storyboard.scenes = storyboard.scenes.map((s) => ({ ...s, status: 'approved' }));
    await updateStudioProject(id, (x) => {
      x.ugc = { storyboard, references, settings };
    });
    return ugcSummary(storyboard);
  },
});

const ugcCambiarEscena = tool({
  name: 'ugc_cambiar_escena',
  description: 'UGC Studio: el equipo rehace una escena del storyboard con tus instrucciones. $0. Si ya estaba renderizada, habrá que volver a renderizarla.',
  schema: z.object({ escena: z.number().int().min(1), instrucciones: z.string().min(5).max(1500) }),
  run: async (id, { escena, instrucciones }) => {
    const p = await getStudioProject(id);
    if (!p.ugc) throw new StudioError('Primero crea el storyboard con ugc_storyboard.', 409);
    const scene = p.ugc.storyboard.scenes.find((s) => s.index === escena);
    if (!scene) throw new StudioError(`No existe la escena ${escena}.`, 404);
    const sb = await reviseScene({ storyboard: p.ugc.storyboard, references: p.ugc.references, settings: p.ugc.settings, sceneId: scene.id, feedback: instrucciones }, () => {});
    // La escena cambiada y las que la continúan (parten de su último fotograma) hay que renderizarlas otra vez
    const stale = new Set<number>([escena]);
    for (const s of [...sb.scenes].sort((a, b) => a.index - b.index)) {
      if (s.index > escena && s.transition.type === 'continua' && stale.has(s.index - 1)) stale.add(s.index);
    }
    sb.scenes = sb.scenes.map((s) => (stale.has(s.index) ? { ...s, status: 'approved', render: undefined } : s));
    await updateStudioProject(id, (x) => {
      x.ugc = { ...x.ugc!, storyboard: sb, finalPath: undefined };
    });
    return { ...ugcSummary(sb), aRenderizarDeNuevo: [...stale].sort((x, y) => x - y) };
  },
});

async function estimateUgc(p: StudioProject) {
  const ugc = p.ugc!;
  const escenas = [];
  for (const s of ugc.storyboard.scenes) {
    if (s.render?.videoUrl) continue;
    const plan = await planSceneRender(ugc.storyboard, s, ugc.references, ugc.settings, { estimateOnly: true });
    escenas.push({ escena: s.index, segundos: s.durationSeconds, costoUSD: plan.estimatedCostUSD });
  }
  return { escenas, totalUSD: Number(escenas.reduce((t, e) => t + e.costoUSD, 0).toFixed(4)), resolucion: ugc.settings.resolution };
}

const ugcCosto = tool({
  name: 'ugc_costo',
  description: 'UGC Studio: costo de renderizar las escenas que faltan, con las tarifas actuales de OpenRouter (HeyGen). No gasta.',
  schema: z.object({}),
  run: async (id) => {
    const p = await getStudioProject(id);
    if (!p.ugc) throw new StudioError('Primero crea el storyboard con ugc_storyboard.', 409);
    return estimateUgc(p);
  },
});

const ugcRenderizar = tool({
  name: 'ugc_renderizar',
  description:
    'UGC Studio: renderiza con HeyGen las escenas que faltan, en orden (cada escena continua parte del último fotograma de la anterior). GASTA: necesita una aprobación aprobada con saldo. Espera hasta que terminen (unos minutos por escena).',
  schema: z.object({ aprobacionId: z.string().min(3) }),
  run: async (id, { aprobacionId }) => {
    let p = await getStudioProject(id);
    if (!p.ugc) throw new StudioError('Primero crea el storyboard con ugc_storyboard.', 409);
    const est = await estimateUgc(p);
    assertBudget(p, aprobacionId, est.totalUSD);
    const hechas: Array<{ escena: number; costoUSD: number }> = [];
    for (const s0 of [...p.ugc.storyboard.scenes].sort((a, b) => a.index - b.index)) {
      p = await getStudioProject(id);
      const sb = p.ugc!.storyboard;
      const s = sb.scenes.find((x) => x.id === s0.id)!;
      if (s.render?.videoUrl) continue;
      const plan = await planSceneRender(sb, s, p.ugc!.references, p.ugc!.settings);
      assertBudget(p, aprobacionId, plan.estimatedCostUSD);
      const taskId = await dispatchSceneRender(sb, s, plan, p.ugc!.settings);
      let done: Awaited<ReturnType<typeof getSceneRenderStatus>> | null = null;
      for (let i = 0; i < 150 && !done; i++) {
        await sleep(6000);
        const st = await getSceneRenderStatus(taskId).catch(() => null);
        if (st?.status === 'completed') done = st;
        else if (st?.status === 'failed') throw new StudioError(`La escena ${s.index} falló en HeyGen: ${st.error ?? 'sin detalle'}`, 502);
      }
      if (!done) throw new StudioError(`La escena ${s.index} tardó demasiado; vuelve a intentarlo más tarde (taskId ${taskId}).`, 504);
      const cost = done.costUSD ?? plan.estimatedCostUSD;
      await updateStudioProject(id, (x) => {
        const sc = x.ugc!.storyboard.scenes.find((y) => y.id === s.id)!;
        sc.status = 'rendered';
        sc.render = { taskId, videoUrl: done!.videoUrl, lastFrameUrl: done!.lastFrameUrl, costUSD: cost, resolution: x.ugc!.settings.resolution, aspectRatio: x.ugc!.settings.aspectRatio };
        const a = x.aprobaciones.find((y) => y.id === aprobacionId)!;
        a.usadoUSD = Number((a.usadoUSD + cost).toFixed(4));
        x.gastoUSD = Number((x.gastoUSD + cost).toFixed(4));
        x.ugc!.finalPath = undefined;
      });
      hechas.push({ escena: s.index, costoUSD: cost });
    }
    return { renderizadas: hechas, totalUSD: Number(hechas.reduce((t, h) => t + h.costoUSD, 0).toFixed(4)) };
  },
});

const ugcMontar = tool({
  name: 'ugc_montar',
  description: 'UGC Studio: une las escenas renderizadas en el video final ($0) y lo guarda en Proyectos → UGC. Devuelve la ruta y un token para mostrarlo.',
  schema: z.object({ nombre: z.string().max(80).optional() }),
  run: async (id, { nombre }) => {
    const p = await getStudioProject(id);
    if (!p.ugc) throw new StudioError('Primero crea el storyboard con ugc_storyboard.', 409);
    const r = await assembleStoryboard({ storyboard: p.ugc.storyboard, references: p.ugc.references, settings: p.ugc.settings, projectName: nombre || p.titulo });
    await updateStudioProject(id, (x) => {
      x.ugc = { ...x.ugc!, finalPath: r.videoPath };
    });
    const mediaId = await registerMedia(id, r.videoPath, `UGC montado · ${r.name}`);
    return { videoFinal: r.videoPath, token: token(mediaId) };
  },
});

// ── Edición de video ────────────────────────────────────────────────────────

async function waitEdit(editId: string, maxMs: number) {
  const until = Date.now() + maxMs;
  for (;;) {
    const e = await getEdit(editId);
    const busy = ACTIVE_STATUSES.includes(e.estado) || Boolean(e.tarea) || isTurnActive(editId);
    const last = e.claude?.mensajes.at(-1);
    if (!busy && e.estado === 'error') throw new StudioError(`La edición falló: ${e.error?.mensaje ?? 'sin detalle'}`, 502);
    if (!busy && (e.borrador || last?.rol === 'claude')) return e;
    if (Date.now() > until) throw new StudioError('La edición sigue trabajando; consulta más tarde con editar_mas o ver_proyecto.', 504);
    await sleep(5000);
  }
}

async function editResult(studioId: string, editId: string) {
  const e = await getEdit(editId);
  const last = [...(e.claude?.mensajes ?? [])].reverse().find((m) => m.rol === 'claude');
  let mediaToken: string | null = null;
  if (e.borrador) {
    const ruta = path.join(/*turbopackIgnore: true*/ e.carpeta, e.borrador.archivo);
    mediaToken = token(await registerMedia(studioId, ruta, `${e.titulo} · v${e.borrador.version}`));
  }
  return {
    edicionId: e.id,
    estado: e.estado,
    borrador: e.borrador ? { archivo: path.join(e.carpeta, e.borrador.archivo), version: e.borrador.version, duracionSeg: e.borrador.duracion } : null,
    resumenDelEditor: last?.texto.slice(0, 2500) ?? null,
    token: mediaToken,
    nota: 'La persona aprueba la edición en Edición de video → Mis ediciones.',
  };
}

const editarVideo = tool({
  name: 'editar_video',
  description:
    'Edición de video: crea una edición con un video (ruta relativa a tu carpeta o absoluta dentro de proyectos, p. ej. el video final de UGC) y el Claude editor la hace según `pedido` (cortes, subtítulos, efectos, pantalla dividida, color…). Transcribe con ElevenLabs (~$0,004/min). Espera hasta que el borrador esté listo (unos minutos) y devuelve un token para mostrarlo.',
  schema: z.object({ archivo: z.string().min(1).max(500), pedido: z.string().min(10).max(2000), titulo: z.string().max(80).optional() }),
  run: async (id, { archivo, pedido, titulo }) => {
    const p = await getStudioProject(id);
    const src = await resolveFile(p, archivo);
    if (!fsSync.existsSync(src)) throw new StudioError(`No existe ${archivo}.`, 404);
    const perfil = (await listProfiles())[0];
    if (!perfil) throw new StudioError('No hay perfiles de edición.', 409);
    const edit = await createEdit({ titulo: titulo || `${p.titulo} · edición`, pedido, perfilId: perfil.id, revisarAntes: false, rutaLocal: src }, null);
    await updateStudioProject(id, (x) => {
      x.ediciones.push(edit.id);
    });
    await waitEdit(edit.id, 25 * 60_000);
    return editResult(id, edit.id);
  },
});

const editarMas = tool({
  name: 'editar_mas',
  description: 'Edición de video: pide al Claude editor otro cambio sobre una edición del proyecto (nueva versión del borrador). Espera a que termine.',
  schema: z.object({ edicionId: z.string().min(10), pedido: z.string().min(5).max(2000) }),
  run: async (id, { edicionId, pedido }) => {
    const p = await getStudioProject(id);
    if (!p.ediciones.includes(edicionId)) throw new StudioError('Esa edición no es de este proyecto.', 404);
    if (!isTurnActive(edicionId)) await sendToClaude(edicionId, pedido, defaultAppUrl());
    await sleep(3000);
    await waitEdit(edicionId, 25 * 60_000);
    return editResult(id, edicionId);
  },
});


// ── Avatar Studio (foto + voz → persona hablando, HeyGen Avatar IV) ─────────

const AVATAR_MODEL = 'heygen/avatar-iv';
/** ElevenLabs habla ~15 caracteres por segundo en español: para estimar antes de generar la voz. */
const CHARS_PER_SEC = 15;

/**
 * Foto lista para subir: Cloudinary gratis no acepta imágenes de más de 10 MB y HeyGen no necesita
 * más de 2048 px. Se reduce con sharp si pesa más de 8 MB (si sharp no está, se sube tal cual).
 */
async function photoForUpload(file: string): Promise<{ buffer: Buffer; name: string }> {
  const raw = await fs.readFile(file);
  if (raw.length <= 8 * 1024 * 1024) return { buffer: raw, name: path.basename(file) };
  try {
    type SharpFn = (b: Buffer) => { rotate: () => { resize: (o: object) => { jpeg: (o: object) => { toBuffer: () => Promise<Buffer> } } } };
    const sharp = ((await import('sharp')) as unknown as { default: SharpFn }).default;
    const out = await sharp(raw).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return { buffer: out, name: `${path.parse(file).name}.jpg` };
  } catch {
    return { buffer: raw, name: path.basename(file) };
  }
}

const AvatarInput = z.object({
  avatarId: z.string().optional().describe('Avatar guardado (avatares_y_voces). Se usa su foto de portada.'),
  foto: z.string().optional().describe('O una foto de tu carpeta (p. ej. adjuntos/cara.jpg) con la persona de frente.'),
  texto: z.string().max(3000).optional().describe('Lo que dice: se genera la voz con ElevenLabs.'),
  audio: z.string().optional().describe('O un audio de tu carpeta (adjuntos/voz.mp3) en vez de texto.'),
  vozId: z.string().optional().describe('Voz de ElevenLabs (avatares_y_voces). Vacío = la configurada por defecto.'),
  formato: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  movimiento: z.string().max(400).optional().describe('Gestos y cuerpo en inglés, p. ej. "smiles, nods, natural hand gestures"'),
  expresividad: z.enum(['low', 'medium', 'high']).default('medium'),
});

async function avatarEstimate(p: StudioProject, input: z.infer<typeof AvatarInput>) {
  if (!input.texto?.trim() && !input.audio) throw new StudioError('Indica `texto` (se genera la voz) o `audio`.');
  let seconds: number;
  let vozUSD = 0;
  if (input.audio) {
    seconds = (await probeMedia(await resolveFile(p, input.audio))).duration ?? 0;
    if (!seconds) throw new StudioError('No pude medir ese audio.');
  } else {
    const chars = input.texto!.trim().length;
    seconds = Math.max(2, chars / CHARS_PER_SEC);
    vozUSD = ttsCost(DEFAULT_ELEVEN_MODEL, chars);
  }
  const videoUSD = seconds * videoRate(AVATAR_MODEL);
  return { segundos: Number(seconds.toFixed(1)), vozUSD: Number(vozUSD.toFixed(4)), videoUSD: Number(videoUSD.toFixed(4)), totalUSD: Number((vozUSD + videoUSD).toFixed(4)) };
}

const avataresYVoces = tool({
  name: 'avatares_y_voces',
  description: 'Avatares guardados en la app (persona con sus fotos) y voces de ElevenLabs disponibles (clonadas y la predeterminada), para avatar_video.',
  schema: z.object({}),
  run: async () => {
    const avatars = await listAvatars().catch(() => []);
    const voces = await getStoredVoices().catch(() => []);
    return {
      avatares: avatars.map((a) => ({ id: a.id, nombre: a.name, descripcion: a.description, fotos: a.photos.length })),
      voces: voces.map((v) => ({ id: v.id, nombre: v.name })),
      vozPredeterminada: getConfiguredVoiceId(),
    };
  },
});

const avatarCosto = tool({
  name: 'avatar_costo',
  description: 'Avatar Studio: cuánto costaría un video de una persona hablando (voz ElevenLabs + HeyGen Avatar IV ≈ $0,05/s). No gasta.',
  schema: AvatarInput,
  run: async (id, input) => avatarEstimate(await getStudioProject(id), input),
});

const avatarVideo = tool({
  name: 'avatar_video',
  description:
    'Avatar Studio: video de una persona (foto de un avatar guardado o adjunta) diciendo un texto o un audio, con labios sincronizados (HeyGen Avatar IV). GASTA: necesita una aprobación aprobada con saldo (usa avatar_costo antes). Espera a que termine (unos minutos) y devuelve un token para mostrarlo.',
  schema: AvatarInput.extend({ aprobacionId: z.string().min(3) }),
  run: async (id, input) => {
    const p = await getStudioProject(id);
    const est = await avatarEstimate(p, input);
    assertBudget(p, input.aprobacionId, est.totalUSD);

    // Foto: portada del avatar (o su primera foto) o un archivo de la carpeta
    let photo: string;
    if (input.avatarId) {
      const a = await getAvatar(input.avatarId).catch(() => null);
      const file = a?.cover ?? a?.photos[0]?.file;
      if (!a || !file) throw new StudioError('Ese avatar no existe o no tiene fotos (avatares_y_voces).', 404);
      photo = await avatarPhotoPath(a.id, file);
    } else if (input.foto) {
      photo = await resolveFile(p, input.foto);
    } else {
      throw new StudioError('Indica `avatarId` o `foto`.');
    }

    // Voz: ElevenLabs con el texto, o el audio adjunto
    let audioPath: string;
    let vozUSD = 0;
    if (input.audio) {
      audioPath = await resolveFile(p, input.audio);
    } else {
      const voice = await synthesizeSpeech({ text: input.texto!.trim(), voiceId: input.vozId || undefined, modelId: DEFAULT_ELEVEN_MODEL, tool: 'claude-studio' });
      vozUSD = voice.costUSD;
      if (voice.filePath) audioPath = voice.filePath;
      else {
        audioPath = path.join(/*turbopackIgnore: true*/ p.carpeta, 'claude', `voz-${Date.now()}.mp3`);
        await fs.mkdir(path.dirname(audioPath), { recursive: true });
        await fs.writeFile(audioPath, Buffer.from(voice.result.buffer));
      }
    }
    const seconds = (await probeMedia(audioPath)).duration ?? est.segundos;
    const videoUSD = Number((seconds * videoRate(AVATAR_MODEL)).toFixed(4));
    assertBudget(await getStudioProject(id), input.aprobacionId, vozUSD + videoUSD);

    const pic = await photoForUpload(photo);
    const [img, aud] = await Promise.all([
      cloudinaryStorageService.uploadImage(pic.buffer, pic.name, 'lulo-studio/portraits'),
      cloudinaryStorageService.uploadAudio(await fs.readFile(audioPath), path.basename(audioPath), 'lulo-studio/audio'),
    ]);
    // Los archivos en Cloudinary solo hacen falta durante el render (plan gratis: 25 créditos/mes)
    const cleanup = () =>
      Promise.all([cloudinaryStorageService.deleteAsset(img.publicId, 'image'), cloudinaryStorageService.deleteAsset(aud.publicId, 'video')]).catch(
        () => undefined
      );
    const job = await createRenderJob({
      tool: 'claude-studio',
      title: `Estudio Claude · avatar · ${p.titulo}`,
      model: AVATAR_MODEL,
      kind: 'avatar',
      input: {
        imageUrl: img.publicUrl,
        audioUrl: aud.publicUrl,
        aspectRatio: input.formato,
        ...(input.movimiento ? { motionPrompt: input.movimiento } : {}),
        expressiveness: input.expresividad,
      },
      estimatedCostUSD: videoUSD,
    });

    let done = await getJob(job.id);
    for (let i = 0; i < 240 && done && done.status !== 'completed' && done.status !== 'failed'; i++) {
      await sleep(5000);
      done = await getJob(job.id);
    }
    // Terminado (bien o mal): ya no hacen falta en Cloudinary. Si sigue en curso, se dejan.
    if (!done || done.status === 'completed' || done.status === 'failed') void cleanup();
    if (!done || done.status === 'failed') throw new StudioError(`El render del avatar falló: ${done?.error ?? 'sin detalle'}`, 502);
    if (done.status !== 'completed' || !done.outputPath) throw new StudioError(`El avatar sigue renderizándose (trabajo ${job.id}); vuelve a mirar más tarde.`, 504);

    const cost = Number((vozUSD + (done.costUSD ?? videoUSD)).toFixed(4));
    await updateStudioProject(id, (x) => {
      const a = x.aprobaciones.find((y) => y.id === input.aprobacionId)!;
      a.usadoUSD = Number((a.usadoUSD + cost).toFixed(4));
      x.gastoUSD = Number((x.gastoUSD + cost).toFixed(4));
    });
    const mediaId = await registerMedia(id, done.outputPath, `Avatar · ${p.titulo}`);
    return { video: done.outputPath, segundos: Number(seconds.toFixed(1)), costoUSD: cost, token: token(mediaId) };
  },
});

// ── Voice Studio (ElevenLabs) ───────────────────────────────────────────────

const VozInput = z.object({
  texto: z.string().trim().min(1).max(5000).describe('Lo que se dice. Puede llevar etiquetas de emoción de ElevenLabs v3/v4 como [laughs] o [whispers].'),
  vozId: z.string().optional().describe('Voz de ElevenLabs (avatares_y_voces). Vacío = la configurada por defecto.'),
  modelo: z
    .string()
    .optional()
    .describe(`Modelo de ElevenLabs. Vacío = ${DEFAULT_ELEVEN_MODEL}. Opciones: ${ELEVEN_MODELS.map((m) => m.id).join(', ')}`),
});

function vozModel(m?: string) {
  if (m && !isKnownElevenModel(m)) throw new StudioError(`Modelo de voz desconocido: "${m}". Usa uno de: ${ELEVEN_MODELS.map((x) => x.id).join(', ')}.`);
  return m || DEFAULT_ELEVEN_MODEL;
}

function vozEstimate(input: z.infer<typeof VozInput>) {
  const modelo = vozModel(input.modelo);
  const chars = input.texto.length;
  return { modelo, caracteres: chars, segundosAprox: Number(Math.max(1, chars / CHARS_PER_SEC).toFixed(1)), totalUSD: Number(ttsCost(modelo, chars).toFixed(4)) };
}

const vozCosto = tool({
  name: 'voz_costo',
  description: 'Voice Studio: cuánto costaría convertir un texto en voz con ElevenLabs. No gasta.',
  schema: VozInput,
  run: async (_id, input) => vozEstimate(input),
});

const vozGenerar = tool({
  name: 'voz_generar',
  description:
    'Voice Studio: genera un audio MP3 con ElevenLabs (voz clonada o la predeterminada). GASTA: necesita una aprobación aprobada con saldo (usa voz_costo antes). Devuelve la ruta del audio y un token para mostrarlo; el audio sirve luego para avatar_video (campo audio).',
  schema: VozInput.extend({ aprobacionId: z.string().min(3) }),
  run: async (id, input) => {
    const p = await getStudioProject(id);
    const est = vozEstimate(input);
    assertBudget(p, input.aprobacionId, est.totalUSD);
    const voice = await synthesizeSpeech({ text: input.texto, voiceId: input.vozId || undefined, modelId: est.modelo, tool: 'claude-studio' });
    // Copia dentro de la carpeta del proyecto: así avatar_video y la edición la encuentran por ruta relativa
    const rel = path.join('claude', `voz-${Date.now()}.mp3`);
    const dest = path.join(/*turbopackIgnore: true*/ p.carpeta, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (voice.filePath && fsSync.existsSync(voice.filePath)) await fs.copyFile(voice.filePath, dest);
    else await fs.writeFile(dest, Buffer.from(voice.result.buffer));
    const cost = Number(voice.costUSD.toFixed(4));
    await updateStudioProject(id, (x) => {
      const a = x.aprobaciones.find((y) => y.id === input.aprobacionId)!;
      a.usadoUSD = Number((a.usadoUSD + cost).toFixed(4));
      x.gastoUSD = Number((x.gastoUSD + cost).toFixed(4));
    });
    const seconds = (await probeMedia(dest).catch(() => null))?.duration;
    const mediaId = await registerMedia(id, dest, `Voz · ${input.texto.slice(0, 40)}${input.texto.length > 40 ? '…' : ''}`);
    return { audio: rel.replace(/\\/g, '/'), modelo: voice.effectiveModel ?? est.modelo, segundos: seconds ? Number(seconds.toFixed(1)) : est.segundosAprox, costoUSD: cost, token: token(mediaId) };
  },
});

// ── Creación de imágenes ────────────────────────────────────────────────────

const ImagenBase = z.object({
  modelo: z
    .string()
    .optional()
    .describe(
      `Vacío = ${DEFAULT_IMAGE_MODEL}. ` +
        IMAGE_MODELS.map((m) => `${m.id} (${m.name}; hasta ${m.maxRefs} referencias; resoluciones ${m.resolutions.join('/')}; ≈$${Object.values(m.pricePerImage)[0]}/imagen)`).join(' · ')
    ),
  resolucion: z.enum(['1K', '2K', '4K']).default('2K'),
  cantidad: z.number().int().min(1).max(4).default(1),
});

function imagenModel(m?: string) {
  if (m && !isValidImageModelId(m)) throw new StudioError(`Modelo de imagen desconocido: "${m}".`);
  return m || DEFAULT_IMAGE_MODEL;
}

function imagenEstimate(input: z.infer<typeof ImagenBase>) {
  const modelo = imagenModel(input.modelo);
  const { spec, resolution, unit } = imageUnitPrice(modelo, input.resolucion);
  return { modelo: spec.id, nombre: spec.name, resolucion: resolution, cantidad: input.cantidad, porImagenUSD: unit, totalUSD: Number((unit * input.cantidad).toFixed(4)) };
}

async function fileToDataUrl(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new StudioError(`${path.basename(file)}: usa JPG, PNG o WEBP como referencia.`);
  const pic = await photoForUpload(file);
  const mime = pic.name.toLowerCase().endsWith('.png') ? 'png' : pic.name.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg';
  return `data:image/${mime};base64,${pic.buffer.toString('base64')}`;
}

const imagenCosto = tool({
  name: 'imagen_costo',
  description: 'Creación de imágenes: cuánto costarían N imágenes con un modelo y resolución. No gasta.',
  schema: ImagenBase,
  run: async (_id, input) => imagenEstimate(input),
});

const imagenCrear = tool({
  name: 'imagen_crear',
  description:
    'Creación de imágenes: genera imágenes realistas a partir de un prompt, opcionalmente con un avatar guardado (sus fotos van como referencia de identidad) y fotos de referencia de tu carpeta (producto, ropa, lugar, estilo). GASTA: necesita una aprobación aprobada con saldo (usa imagen_costo antes). Devuelve rutas y tokens para mostrarlas; una imagen sirve luego como foto para avatar_video.',
  schema: ImagenBase.extend({
    prompt: z.string().trim().min(3).max(4000).describe('Qué se ve: persona, acción, lugar, luz, encuadre. Mejor en español o inglés, concreto.'),
    avatarId: z.string().optional().describe('Avatar guardado (avatares_y_voces): la persona generada será esa.'),
    referencias: z.array(z.string()).max(10).default([]).describe('Fotos de tu carpeta, p. ej. ["adjuntos/producto.png"].'),
    formato: z.string().max(12).default('9:16').describe('9:16, 16:9, 1:1, 4:5 o 3:4'),
    realismo: z.boolean().default(true).describe('Añade el bloque de realismo (piel real, luz natural, sin look de IA).'),
    aprobacionId: z.string().min(3),
  }),
  run: async (id, input) => {
    const p = await getStudioProject(id);
    const est = imagenEstimate(input);
    assertBudget(p, input.aprobacionId, est.totalUSD);
    const spec = getImageModel(est.modelo);
    if (input.referencias.length > spec.maxRefs - (input.avatarId ? 1 : 0)) {
      throw new StudioError(`${spec.name} acepta hasta ${spec.maxRefs} referencias en total${input.avatarId ? ' (contando al menos 1 foto del avatar)' : ''}.`);
    }
    if (input.avatarId) await getAvatar(input.avatarId).catch(() => {
      throw new StudioError('Ese avatar no existe (avatares_y_voces).', 404);
    });
    const references: string[] = [];
    for (const r of input.referencias) references.push(await fileToDataUrl(await resolveFile(p, r)));

    const res = await generateImages(
      {
        model: est.modelo,
        prompt: input.prompt,
        references,
        aspectRatio: input.formato,
        resolution: est.resolucion,
        count: input.cantidad,
        realism: input.realismo,
        avatarId: input.avatarId,
      },
      { tool: 'claude-studio', saveProject: false }
    );
    const cost = Number(res.images.reduce((s, i) => s + (i.costUSD ?? 0), 0).toFixed(4));
    if (cost > 0) {
      await updateStudioProject(id, (x) => {
        const a = x.aprobaciones.find((y) => y.id === input.aprobacionId)!;
        a.usadoUSD = Number((a.usadoUSD + cost).toFixed(4));
        x.gastoUSD = Number((x.gastoUSD + cost).toFixed(4));
      });
    }
    if (!res.images.length) throw new StudioError(`No salió ninguna imagen: ${res.errors.join(' · ') || 'sin detalle'}`, 502);

    // Copias en la carpeta del proyecto (para usarlas luego como foto o referencia)
    const imagenes: { ruta: string; token: string }[] = [];
    for (const [i, img] of res.images.entries()) {
      const rel = path.join('claude', `imagen-${Date.now()}-${i + 1}${path.extname(img.path) || '.png'}`);
      const dest = path.join(/*turbopackIgnore: true*/ p.carpeta, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(img.path, dest);
      const mediaId = await registerMedia(id, dest, `Imagen ${i + 1} · ${input.prompt.slice(0, 40)}${input.prompt.length > 40 ? '…' : ''}`);
      imagenes.push({ ruta: rel.replace(/\\/g, '/'), token: token(mediaId) });
    }
    return {
      imagenes,
      enviado: { modelo: res.sent.model, formato: res.sent.aspectRatio, resolucion: res.sent.resolution, avatar: res.sent.avatar, fotosAvatar: res.sent.avatarPhotos, referenciasExtra: res.sent.extraRefs },
      errores: res.errors,
      costoUSD: cost,
    };
  },
});

// ── Clonación y reemplazo (Seedance 2.0 en Apimart) ─────────────────────────

const ClonInput = z.object({
  video: z.string().optional().describe('Video base de tu carpeta (adjuntos/clip.mp4), 1,8–15 s: de él se copian movimiento, cámara y pose.'),
  avatarId: z.string().optional().describe('Avatar guardado cuya cara reemplaza al personaje (se usa su portada).'),
  cara: z.string().optional().describe('O una foto de tu carpeta con la cara nueva.'),
  objeto: z.string().optional().describe('Foto opcional de un producto/objeto que reemplaza al que sostiene.'),
  extras: z.array(z.string()).max(6).default([]).describe('Más fotos de referencia (ropa, lugar, estilo).'),
  audio: z.string().optional().describe('Audio opcional de tu carpeta (≤ 15 s) con la voz nueva; sincroniza la boca.'),
  prompt: z.string().max(3000).optional().describe('Indicaciones extra en inglés (lo que debe cambiar o mantenerse).'),
  modelo: z.enum(['seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini']).default('seedance-2.0-fast'),
  formato: z.enum(['adaptive', '9:16', '16:9', '1:1', '4:3', '3:4', '21:9']).default('adaptive'),
  resolucion: z.enum(['480p', '720p', '1080p', '4k']).default('720p'),
  duracion: z.number().int().min(4).max(15).optional().describe('Segundos del resultado (4–15). Vacío = lo que dura el video base (mín. 4).'),
  generarAudio: z.boolean().default(true),
});

async function clonPlan(p: StudioProject, input: z.infer<typeof ClonInput>) {
  if (!input.avatarId && !input.cara && !input.video) throw new StudioError('Indica al menos el `video` base y la cara (`avatarId` o `cara`).');
  let face: string | undefined;
  if (input.avatarId) {
    const a = await getAvatar(input.avatarId).catch(() => null);
    const file = a?.cover ?? a?.photos[0]?.file;
    if (!a || !file) throw new StudioError('Ese avatar no existe o no tiene fotos (avatares_y_voces).', 404);
    face = await avatarPhotoPath(a.id, file);
  } else if (input.cara) face = await resolveFile(p, input.cara);
  const video = input.video ? await resolveFile(p, input.video) : undefined;
  const audio = input.audio ? await resolveFile(p, input.audio) : undefined;
  let videoSec: number | undefined;
  if (video) {
    videoSec = (await probeMedia(video)).duration ?? undefined;
    if (!videoSec) throw new StudioError('No pude medir el video base.');
    if (videoSec < 1.8 || videoSec > 15.2) throw new StudioError(`El video base dura ${videoSec.toFixed(1)} s y Seedance acepta 1,8–15 s: recórtalo antes (editar_video o pídeselo a la persona).`);
  }
  let audioSec: number | undefined;
  if (audio) {
    audioSec = (await probeMedia(audio)).duration ?? undefined;
    if (audioSec && audioSec > 15) throw new StudioError(`El audio dura ${audioSec.toFixed(1)} s; Seedance acepta hasta 15 s.`);
  }
  const duration = input.duracion ?? Math.min(15, Math.max(4, Math.round(videoSec ?? 5)));
  const spec = SEEDANCE_MODELS.find((m) => m.id === input.modelo)!;
  if (!spec.resolutions.includes(input.resolucion)) throw new StudioError(`${spec.name} solo admite ${spec.resolutions.join(', ')}.`);
  const totalUSD = Number((duration * spec.costPerSecondUSD).toFixed(4));
  return { face, video, audio, videoSec, audioSec, duration, spec, totalUSD };
}

const clonacionCosto = tool({
  name: 'clonacion_costo',
  description:
    'Clonación y reemplazo: cuánto costaría reemplazar la persona (y opcionalmente el objeto o la voz) de un video corto con Seedance 2.0. Fast ≈ $0,04/s, Mini ≈ $0,03/s, Estándar ≈ $0,066/s (hasta 4K). No gasta.',
  schema: ClonInput,
  run: async (id, input) => {
    const plan = await clonPlan(await getStudioProject(id), input);
    return { modelo: plan.spec.id, segundos: plan.duration, videoBaseSegundos: plan.videoSec, totalUSD: plan.totalUSD };
  },
});

const clonacionVideo = tool({
  name: 'clonacion_video',
  description:
    'Clonación y reemplazo (Seedance 2.0): toma el movimiento, la cámara y la pose de un video base y pone la cara de un avatar o foto (y opcionalmente un objeto y una voz nueva). GASTA: necesita una aprobación aprobada con saldo (usa clonacion_costo antes). Tarda unos minutos; devuelve un token para mostrarlo.',
  schema: ClonInput.extend({ aprobacionId: z.string().min(3) }),
  run: async (id, input) => {
    const p = await getStudioProject(id);
    const plan = await clonPlan(p, input);
    assertBudget(p, input.aprobacionId, plan.totalUSD);
    await assertWithinDailyLimit(plan.totalUSD, (await getSettings()).dailyLimitUSD);

    const uploaded: { publicId: string; type: 'image' | 'video' }[] = [];
    const upImg = async (file: string) => {
      const pic = await photoForUpload(file);
      const r = await cloudinaryStorageService.uploadImage(pic.buffer, pic.name, 'lulo-studio/portraits');
      uploaded.push({ publicId: r.publicId, type: 'image' });
      return r.publicUrl;
    };
    const cleanup = () => Promise.allSettled(uploaded.map((u) => cloudinaryStorageService.deleteAsset(u.publicId, u.type)));
    try {
      const faceUrl = plan.face ? await upImg(plan.face) : undefined;
      const objectUrl = input.objeto ? await upImg(await resolveFile(p, input.objeto)) : undefined;
      const extraUrls: string[] = [];
      for (const e of input.extras) extraUrls.push(await upImg(await resolveFile(p, e)));
      let videoUrl: string | undefined;
      if (plan.video) {
        const r = await cloudinaryStorageService.uploadVideo(await fs.readFile(plan.video), path.basename(plan.video), 'lulo-studio/deepswap');
        uploaded.push({ publicId: r.publicId, type: 'video' });
        videoUrl = r.publicUrl;
      }
      let audioUrl: string | undefined;
      if (plan.audio) {
        const r = await cloudinaryStorageService.uploadAudio(await fs.readFile(plan.audio), path.basename(plan.audio), 'lulo-studio/audio');
        uploaded.push({ publicId: r.publicId, type: 'video' });
        audioUrl = r.publicUrl;
      }

      const req: SeedanceTransformInput = {
        videoUrl,
        faceRefUrl: faceUrl,
        objectRefUrl: objectUrl,
        extraImageUrls: extraUrls,
        audioUrl,
        prompt: input.prompt,
        options: {
          model: input.modelo as SeedanceModelId,
          size: input.formato as SeedanceSize,
          resolution: input.resolucion as SeedanceResolution,
          duration: plan.duration,
          generateAudio: input.generarAudio,
          videoDurationSec: plan.videoSec,
          audioDurationSec: plan.audioSec,
          waitForCompletion: true,
          timeoutMs: 15 * 60_000,
          pollIntervalMs: 5_000,
        },
      };
      validateAndBuildSeedancePayload(req); // errores de reglas antes de gastar
      const result = await transformVideoSeedance(req);
      if (result.status !== 'completed' || !result.videoUrl) throw new StudioError(`Seedance no terminó: ${result.error ?? result.status}`, 502);

      const saved = await downloadToLibrary(result.videoUrl, 'video', 'mp4', result.taskId);
      const cost = Number((result.costUSD && result.costUSD > 0 ? result.costUSD : plan.totalUSD).toFixed(4));
      await recordUsage({
        tool: 'claude-studio',
        kind: 'video',
        provider: 'apimart',
        model: input.modelo,
        description: `Estudio Claude · clonación Seedance (${input.resolucion}, ${input.formato}, ${plan.duration}s) · ${p.titulo}`,
        units: plan.duration,
        unit: 'segundos',
        costUSD: cost,
        estimated: !(result.costUSD && result.costUSD > 0),
        filePath: saved.path,
        jobId: result.taskId,
      });
      await updateStudioProject(id, (x) => {
        const a = x.aprobaciones.find((y) => y.id === input.aprobacionId)!;
        a.usadoUSD = Number((a.usadoUSD + cost).toFixed(4));
        x.gastoUSD = Number((x.gastoUSD + cost).toFixed(4));
      });
      const rel = path.join('claude', `clonacion-${Date.now()}.mp4`);
      const dest = path.join(/*turbopackIgnore: true*/ p.carpeta, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(saved.path, dest);
      const mediaId = await registerMedia(id, dest, `Clonación · ${p.titulo}`);
      return { video: rel.replace(/\\/g, '/'), segundos: plan.duration, costoUSD: cost, token: token(mediaId) };
    } finally {
      void cleanup();
    }
  },
});

// ── App de feedback ─────────────────────────────────────────────────────────

const subirAFeedback = tool({
  name: 'subir_a_feedback',
  description:
    'Sube un video del proyecto a la app de feedback del equipo (Cloudflare) para que dejen notas por tiempo. $0. Úsalo cuando la persona lo pida (o lo haya pedido para la entrega). `archivo`: ruta relativa a tu carpeta o absoluta en la carpeta de proyectos, o `mediaId` de algo ya mostrado. Devuelve el enlace para revisar.',
  schema: z.object({
    archivo: z.string().min(1).max(500).optional(),
    mediaId: z.string().min(1).max(80).optional(),
    titulo: z.string().min(1).max(120).describe('Nombre del video en Feedback, p. ej. "Anuncio v2".'),
  }),
  run: async (id, { archivo, mediaId, titulo }) => {
    const p = await getStudioProject(id);
    let mid = mediaId;
    let ruta: string;
    if (mid) {
      const m = p.medios.find((x) => x.id === mid && x.tipo === 'video');
      if (!m) throw new StudioError('Ese mediaId no es un video del proyecto.', 404);
      ruta = m.ruta;
    } else {
      if (!archivo) throw new StudioError('Pasa `archivo` o `mediaId`.');
      ruta = await resolveFile(p, archivo);
      if (!fsSync.existsSync(ruta)) throw new StudioError(`No existe ${archivo}.`, 404);
      if (kindOf(ruta) !== 'video') throw new StudioError('Solo se suben videos a Feedback.');
      mid = await registerMedia(id, ruta, titulo);
    }
    const e = await uploadToFeedback({ tipo: 'studio', id, mediaId: mid }, { nombre: `${titulo}${path.extname(ruta) || '.mp4'}` });
    return { subido: true, key: e.key, enlace: reviewUrl(e.key), token: token(mid), nota: 'Comparte el enlace con la persona. Cuando el equipo deje notas, léelas con ver_feedback.' };
  },
});

const verFeedback = tool({
  name: 'ver_feedback',
  description: 'Estado y notas de los videos de ESTE proyecto subidos a la app de feedback (En revisión del equipo, Enviado a Claude, Claude trabajando, Claude respondió, Versión anterior). $0.',
  schema: z.object({}),
  run: async (id) => originFeedbackForClaude('studio', id),
});

const feedbackPendiente = tool({
  name: 'feedback_pendiente',
  description:
    'Videos de TODO el equipo (cualquier herramienta o PC) donde el equipo envió sus notas a Claude y aún no se extrajeron, con sus notas. `todos: true` = todos los videos con feedback y su estado. $0.',
  schema: z.object({ todos: z.boolean().default(false) }),
  run: async (_id, { todos }) => feedbackForClaude(todos),
});

const tomarFeedback = tool({
  name: 'tomar_feedback',
  description: 'Extrae las notas y el feedback que el equipo envió a Claude desde la app de feedback (estado «Enviado a Claude»): las descarga y deja esa versión en «Claude trabajando». Devuelve las notas para ejecutarlas. `key` sale de ver_feedback o feedback_pendiente. $0.',
  schema: z.object({ key: z.string().min(1).max(400) }),
  run: async (_id, { key }) => takeFeedbackFromAgent(key, 'Estudio Claude'),
});

const responderFeedback = tool({
  name: 'responder_feedback',
  description: 'Al terminar de aplicar el feedback, deja tu respuesta para el equipo: nota por nota qué cambiaste y qué no se pudo (y por qué). La verán en la app de feedback y el video pasa a «Claude respondió». $0.',
  schema: z.object({ key: z.string().min(1).max(400), resumen: z.string().min(10).max(4000) }),
  run: async (_id, { key, resumen }) => respondFromAgent(key, resumen),
});

const revisarHtmlVideo = tool({
  name: 'revisar_html_video',
  description: CODE_CHECK_DESCRIPTION,
  schema: CodeCheckSchema,
  run: async (id, input) => {
    const p = await getStudioProject(id);
    return checkCodeVideo(p.carpeta, input).catch((err) => {
      throw err instanceof CodeVideoError ? new StudioError(err.message, err.status) : err;
    });
  },
});

const renderizarHtmlVideo = tool({
  name: 'renderizar_html_video',
  description: CODE_VIDEO_BATCH_DESCRIPTION,
  schema: CodeVideoBatchSchema,
  run: async (id, input) => {
    const p = await getStudioProject(id);
    return renderCodeVideos(p.carpeta, input).catch((err) => {
      throw err instanceof CodeVideoError ? new StudioError(err.message, err.status) : err;
    });
  },
});

export const STUDIO_TOOLS: StudioTool[] = [
  subirAFeedback,
  verFeedback,
  feedbackPendiente,
  tomarFeedback,
  responderFeedback,
  servicios,
  verProyecto,
  pedirAprobacion,
  mostrar,
  verFotogramas,
  ugcStoryboard,
  ugcCambiarEscena,
  ugcCosto,
  ugcRenderizar,
  ugcMontar,
  editarVideo,
  editarMas,
  revisarHtmlVideo, renderizarHtmlVideo,
  avataresYVoces,
  avatarCosto,
  avatarVideo,
  vozCosto,
  vozGenerar,
  imagenCosto,
  imagenCrear,
  clonacionCosto,
  clonacionVideo,
];

export function studioToolsManifest() {
  return STUDIO_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema, { io: 'input' }) }));
}

export async function runStudioTool(studioId: string, name: string, raw: unknown): Promise<unknown> {
  const t = STUDIO_TOOLS.find((x) => x.name === name);
  if (!t) throw new StudioError(`Herramienta desconocida: "${name}".`, 404);
  const parsed = t.schema.safeParse(raw ?? {});
  if (!parsed.success) throw new StudioError(`Datos no válidos — ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
  try {
    return await t.run(studioId, parsed.data);
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError(errorMessage(err, 'No se pudo completar.'), 500);
  }
}
