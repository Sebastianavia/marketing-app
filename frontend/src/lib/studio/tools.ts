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
import { isInside } from '@/lib/fs/inside';

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

export const STUDIO_TOOLS: StudioTool[] = [
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
