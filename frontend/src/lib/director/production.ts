import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getAvatar, avatarPhotoPath } from '@/lib/avatars/avatar-store';
import { getSettings, getPersonName } from '@/lib/data/settings';
import { assertWithinDailyLimit } from '@/lib/usage/usage-store';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { getConfiguredVoiceId } from '@/services/elevenlabs/elevenlabs.service';
import { DEFAULT_ELEVEN_MODEL } from '@/config/elevenlabs-models';
import { DEFAULT_IMAGE_MODEL } from '@/config/image-models';
import { DEFAULT_BROLL_MODEL, brollRate, getBrollModel, pickBrollDuration } from '@/config/broll-models';
import { videoRate } from '@/config/cost-rates';
import { generateImages, ImageRequestSchema } from '@/lib/generation/image';
import { synthesizeSpeechWithTimestamps } from '@/lib/generation/voice';
import { createRenderJob } from '@/lib/jobs/create-job';
import { errorMessage } from '@/lib/errors';
import { AVATAR_MODEL, EstimateError, estimatePlan, type SceneInput } from './estimate';
import {
  ProductionError,
  archiveSceneFiles,
  createProductionFolder,
  currentFiles,
  findScene,
  newProductionId,
  requireProduction,
  pendingApproval,
  placeInProduction,
  productionSpent,
  roundUSD,
  saveNewProduction,
  sceneFileName,
  updateProduction,
  type Production,
  type ProductionFile,
  type ProductionScene,
  type SceneSpec,
} from './production-store';

/**
 * Reglas de gasto del Director, aplicadas en el SERVIDOR (no dependen del prompt del agente):
 * 1. Solo se ejecuta una escena aprobada por una persona desde la app (las herramientas no pueden aprobar).
 * 2. Se ejecuta exactamente la spec aprobada; cualquier cambio vuelve a pedir aprobación.
 * 3. El costo al ejecutar no puede pasar del aprobado en más de un 10 %.
 * 4. Presupuesto de la producción y límite diario de la app.
 * 5. Un fallo sin cobro permite UN reintento con la misma aprobación; si hubo cobro, hay que aprobar de nuevo.
 */

/** Margen sobre lo aprobado por diferencias de redondeo o duración real. */
export const APPROVAL_MARGIN = 0.1;
const DIRECTOR_TOOL = 'director';

// ── Costo de una escena ───────────────────────────────────────────────────────

function toEstimateInput(spec: SceneSpec): SceneInput {
  switch (spec.tipo) {
    case 'avatar':
      return { tipo: 'avatar', duracionSeg: spec.duracionSeg, texto: spec.texto, modeloVoz: spec.modeloVoz };
    case 'voz':
      return { tipo: 'voz', duracionSeg: spec.duracionSeg, texto: spec.texto, modelo: spec.modeloVoz || spec.modelo };
    case 'imagen':
      return { tipo: 'imagen', modelo: spec.modelo, resolucion: spec.resolucion, cantidad: spec.cantidad };
    case 'toma_de_apoyo':
      return { tipo: 'toma_de_apoyo', duracionSeg: spec.duracionSeg, modelo: spec.modelo, conAudio: spec.conAudio };
  }
}

export function estimateScene(spec: SceneSpec, n: number) {
  try {
    const e = estimatePlan([toEstimateInput(spec)]);
    const s = e.escenas[0];
    return { costoUSD: s.costoUSD, detalle: s.detalle, suposiciones: e.suposiciones.map((x) => x.replace(/^Escena 1/, `Escena ${n}`)) };
  } catch (err) {
    if (err instanceof EstimateError) throw new ProductionError(err.message.replace(/^Escena 1/, `Escena ${n}`));
    throw err;
  }
}

/** Comprueba que la spec tiene todo lo necesario para ejecutarse (antes de pedir aprobación). */
async function validateSpec(spec: SceneSpec, n: number, all: SceneSpec[]) {
  const fail = (m: string) => {
    throw new ProductionError(`Escena ${n}: ${m}`);
  };
  if (spec.avatarId) {
    try {
      const a = await getAvatar(spec.avatarId);
      if (!a.photos.length) fail(`el avatar "${a.name}" no tiene fotos.`);
    } catch (err) {
      if (err instanceof ProductionError) throw err;
      fail(`no existe el avatar "${spec.avatarId}" (ver_catalogo → avatares).`);
    }
  }
  if (spec.imagenDeEscena) {
    const idx = Number(spec.imagenDeEscena.replace(/^e/, '')) - 1;
    const ref = all[idx];
    if (!ref || ref.tipo !== 'imagen') fail(`"imagenDeEscena" debe ser el id de una escena de imagen de esta producción (p. ej. "e1").`);
    if (idx >= n - 1) fail('"imagenDeEscena" debe apuntar a una escena anterior.');
  }
  switch (spec.tipo) {
    case 'avatar':
      if (!spec.texto?.trim()) fail('un avatar necesita "texto" (lo que dice).');
      if (!spec.avatarId && !spec.imagenDeEscena) fail('indica "avatarId" o "imagenDeEscena" para la foto de quien habla.');
      break;
    case 'voz':
      if (!spec.texto?.trim()) fail('una locución necesita "texto".');
      break;
    case 'imagen':
      if (!spec.prompt || spec.prompt.trim().length < 3) fail('una imagen necesita "prompt".');
      if ((spec.cantidad ?? 1) > 4) fail('máximo 4 imágenes por escena.');
      break;
    case 'toma_de_apoyo': {
      if (!spec.prompt?.trim()) fail('una toma de apoyo necesita "prompt".');
      const model = getBrollModel(spec.modelo || DEFAULT_BROLL_MODEL);
      const max = model.durations[model.durations.length - 1];
      if ((spec.duracionSeg ?? 0) > max) fail(`${model.name} genera hasta ${max} s por clip; divide la toma en varias escenas.`);
      break;
    }
  }
}

// ── Aprobaciones ──────────────────────────────────────────────────────────────

/** Total ya gastado + lo aprobado que aún no se ha gastado + lo que se pide. */
function committedUSD(p: Production, extraSceneIds: string[] = []) {
  let total = productionSpent(p);
  for (const s of p.escenas) {
    if (s.estado === 'aprobada' || s.estado === 'generando' || extraSceneIds.includes(s.id)) total += s.estimadoUSD;
  }
  return roundUSD(total);
}

/** Marca escenas como pendientes y las añade a la solicitud de aprobación abierta (o crea una). */
function requestApproval(p: Production, sceneIds: string[], motivo: string) {
  const projected = committedUSD(p, sceneIds);
  if (projected > p.presupuestoUSD + 1e-4) {
    throw new ProductionError(
      `Con esto la producción llegaría a $${projected.toFixed(3)} y el presupuesto es $${p.presupuestoUSD.toFixed(2)}. ` +
        'Usa modelos más baratos o menos segundos (estimar_costo muestra alternativas).',
      409,
    );
  }
  for (const id of sceneIds) {
    const s = findScene(p, id);
    s.estado = 'pendiente';
    s.aprobadaUSD = null;
    s.aprobacionId = null;
  }
  const open = pendingApproval(p);
  const now = new Date().toISOString();
  if (open) {
    open.escenas = [...new Set([...open.escenas, ...sceneIds])].sort();
    open.montoUSD = roundUSD(open.escenas.reduce((t, id) => t + findScene(p, id).estimadoUSD, 0));
    open.motivo = open.motivo === motivo ? motivo : `${open.motivo} · ${motivo}`;
    open.pedida = now;
    return open;
  }
  const approval = {
    id: `apr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    escenas: [...sceneIds].sort(),
    montoUSD: roundUSD(sceneIds.reduce((t, id) => t + findScene(p, id).estimadoUSD, 0)),
    motivo,
    estado: 'pendiente' as const,
    pedida: now,
  };
  p.aprobaciones.push(approval);
  return approval;
}

export interface NewProductionInput {
  nombre: string;
  formato: '9:16' | '16:9' | '1:1';
  presupuestoUSD: number;
  escenas: SceneSpec[];
}

export async function createProduction(input: NewProductionInput) {
  const suposiciones: string[] = [];
  const escenas: ProductionScene[] = [];
  for (const [i, spec] of input.escenas.entries()) {
    await validateSpec(spec, i + 1, input.escenas);
    const e = estimateScene(spec, i + 1);
    suposiciones.push(...e.suposiciones);
    escenas.push({
      id: `e${i + 1}`,
      orden: i + 1,
      spec,
      estimadoUSD: e.costoUSD,
      detalle: e.detalle,
      estado: 'pendiente',
      aprobadaUSD: null,
      aprobacionId: null,
      version: 1,
      gastoUSD: 0,
      reintentoUsado: false,
      falloConCobro: false,
      archivos: [],
    });
  }
  const now = new Date().toISOString();
  const p: Production = {
    id: newProductionId(),
    nombre: input.nombre.trim(),
    carpeta: '',
    formato: input.formato,
    presupuestoUSD: input.presupuestoUSD,
    estado: 'esperando_aprobacion',
    escenas,
    aprobaciones: [],
    creada: now,
    actualizada: now,
  };
  const approval = requestApproval(p, escenas.map((s) => s.id), 'Plan inicial');
  p.carpeta = await createProductionFolder(p.nombre);
  await saveNewProduction(p);
  return { production: p, approval, suposiciones };
}

/** Cambia la spec de una escena (o la rehace): archiva sus archivos y vuelve a pedir aprobación. */
export async function changeScene(productionId: string, sceneId: string, changes: Partial<SceneSpec>, redo: boolean) {
  return updateProduction(productionId, async (p) => {
    const scene = findScene(p, sceneId);
    if (scene.estado === 'generando') throw new ProductionError(`La escena ${scene.orden} se está generando; espera a que termine.`, 409);
    const keys = Object.keys(changes).filter((k) => (changes as Record<string, unknown>)[k] !== undefined);
    if (!keys.length && !redo) throw new ProductionError('No hay cambios. Para repetir la escena tal cual usa rehacer: true.');
    if ('tipo' in changes && changes.tipo !== scene.spec.tipo) {
      throw new ProductionError('No se puede cambiar el tipo de una escena; crea otra producción o una escena nueva.');
    }
    const spec: SceneSpec = { ...scene.spec, ...changes, tipo: scene.spec.tipo };
    await validateSpec(spec, scene.orden, p.escenas.map((s) => (s.id === scene.id ? spec : s.spec)));
    const e = estimateScene(spec, scene.orden);

    if (currentFiles(scene).length) {
      await archiveSceneFiles(p, scene);
      scene.version += 1;
    }
    scene.spec = spec;
    scene.estimadoUSD = e.costoUSD;
    scene.detalle = e.detalle;
    scene.error = undefined;
    scene.jobId = undefined;
    scene.duracionRealSeg = undefined;
    scene.reintentoUsado = false;
    scene.falloConCobro = false;
    const approval = requestApproval(p, [scene.id], redo && !keys.length ? `Rehacer escena ${scene.orden}` : `Cambio en escena ${scene.orden}`);
    return { approval, suposiciones: e.suposiciones };
  });
}

/**
 * Aprobación desde la app. Se exige que el monto y las escenas coincidan con lo que vio la persona:
 * si el agente cambió algo mientras tanto, se rechaza y hay que volver a revisar.
 */
export async function approveProduction(productionId: string, approvalId: string, montoUSD: number, escenas: string[]) {
  const persona = await getPersonName();
  return updateProduction(productionId, (p) => {
    const a = pendingApproval(p);
    if (!a || a.id !== approvalId) throw new ProductionError('Esta solicitud ya no está pendiente; vuelve a abrirla.', 409);
    const same = a.escenas.length === escenas.length && [...escenas].sort().every((id, i) => id === a.escenas[i]);
    if (!same || Math.abs(a.montoUSD - montoUSD) > 1e-4) {
      throw new ProductionError('La solicitud cambió mientras la revisabas; revísala de nuevo.', 409);
    }
    for (const id of a.escenas) {
      const s = findScene(p, id);
      if (s.estado !== 'pendiente') continue;
      s.estado = 'aprobada';
      s.aprobadaUSD = s.estimadoUSD;
      s.aprobacionId = a.id;
    }
    a.estado = 'aprobada';
    a.resuelta = new Date().toISOString();
    a.origen = 'app';
    a.persona = persona;
    return a;
  });
}

export async function rejectProduction(productionId: string, approvalId: string) {
  const persona = await getPersonName();
  return updateProduction(productionId, (p) => {
    const a = pendingApproval(p);
    if (!a || a.id !== approvalId) throw new ProductionError('Esta solicitud ya no está pendiente.', 409);
    for (const id of a.escenas) {
      const s = findScene(p, id);
      if (s.estado === 'pendiente') s.estado = 'rechazada';
    }
    a.estado = 'rechazada';
    a.resuelta = new Date().toISOString();
    a.origen = 'app';
    a.persona = persona;
    return a;
  });
}

// ── Antes de gastar ───────────────────────────────────────────────────────────

const NEEDS_APPROVAL = 'Ábrela en Lulo Studio (aviso «El Director pide…» en la barra superior) para aprobarla.';

function blockedMessage(s: ProductionScene): string {
  switch (s.estado) {
    case 'pendiente':
      return `La escena ${s.orden} espera aprobación de una persona. ${NEEDS_APPROVAL}`;
    case 'generando':
      return `La escena ${s.orden} ya se está generando; consulta ver_produccion.`;
    case 'lista':
      return `La escena ${s.orden} ya está lista. Para rehacerla usa cambiar_escena con rehacer: true (pedirá aprobación).`;
    case 'rechazada':
      return `La escena ${s.orden} fue rechazada. Cámbiala con cambiar_escena para pedir aprobación otra vez.`;
    case 'fallida':
      return s.falloConCobro
        ? `La escena ${s.orden} falló después de cobrar. Usa cambiar_escena con rehacer: true para pedir una aprobación nueva.`
        : `La escena ${s.orden} ya usó su reintento. Usa cambiar_escena con rehacer: true para pedir una aprobación nueva.`;
    default:
      return `La escena ${s.orden} no se puede ejecutar.`;
  }
}

/** Bajo el candado: comprueba todas las reglas y marca la escena como "generando". */
async function beginScene(productionId: string, sceneId: string, tipo: SceneSpec['tipo']) {
  const settings = await getSettings();
  const { production, result } = await updateProduction(productionId, async (p) => {
    const s = findScene(p, sceneId);
    if (s.spec.tipo !== tipo) throw new ProductionError(`La escena ${s.orden} es de tipo "${s.spec.tipo}", no "${tipo}".`);
    const retry = s.estado === 'fallida' && !s.falloConCobro && !s.reintentoUsado && s.aprobadaUSD !== null;
    if (s.estado !== 'aprobada' && !retry) throw new ProductionError(blockedMessage(s), 403);
    if (s.aprobadaUSD === null) throw new ProductionError(blockedMessage({ ...s, estado: 'pendiente' }), 403);

    const now = estimateScene(s.spec, s.orden);
    if (now.costoUSD > s.aprobadaUSD * (1 + APPROVAL_MARGIN) + 1e-4) {
      throw new ProductionError(
        `La escena ${s.orden} costaría $${now.costoUSD.toFixed(3)} y se aprobaron $${s.aprobadaUSD.toFixed(3)} (cambiaron las tarifas). Pide aprobación de nuevo con cambiar_escena.`,
        409,
      );
    }
    const spent = productionSpent(p);
    if (spent + now.costoUSD > p.presupuestoUSD * (1 + APPROVAL_MARGIN) + 1e-4) {
      throw new ProductionError(
        `La producción ya gastó $${spent.toFixed(3)}; esta escena ($${now.costoUSD.toFixed(3)}) superaría el presupuesto de $${p.presupuestoUSD.toFixed(2)}.`,
        409,
      );
    }
    await assertWithinDailyLimit(now.costoUSD, settings.dailyLimitUSD);

    if (retry) s.reintentoUsado = true;
    s.estado = 'generando';
    s.error = undefined;
    return s;
  });
  return { production, scene: result };
}

/** Bajo el candado: aplica el resultado a la escena (archivos, gasto, estado). */
async function finishScene(
  productionId: string,
  sceneId: string,
  apply: (p: Production, s: ProductionScene) => void | Promise<void>,
) {
  return updateProduction(productionId, async (p) => {
    const s = findScene(p, sceneId);
    await apply(p, s);
    return s;
  });
}

/**
 * Marca la escena como fallida. `spentBefore` = gasto de la escena al empezar: si subió, el fallo llegó
 * a cobrar y reintentar exige una aprobación nueva. Con `null` no se considera cobro (p. ej. la voz del
 * avatar, que se reutiliza al reintentar).
 */
async function failScene(productionId: string, sceneId: string, message: string, spentBefore: number | null) {
  await finishScene(productionId, sceneId, (_p, s) => {
    s.estado = 'fallida';
    s.error = message;
    if (spentBefore !== null && s.gastoUSD > spentBefore + 1e-9) s.falloConCobro = true;
  });
}

function fileRecord(s: ProductionScene, data: Omit<ProductionFile, 'id' | 'version' | 'creado'>): ProductionFile {
  return { id: crypto.randomUUID(), version: s.version, creado: new Date().toISOString(), ...data };
}

// ── Fotos de entrada ──────────────────────────────────────────────────────────

/** Ruta local de la foto/fotograma de la escena: imagen de otra escena (lista) o portada del avatar. */
async function sceneFrame(p: Production, spec: SceneSpec): Promise<string | null> {
  if (spec.imagenDeEscena) {
    const ref = findScene(p, spec.imagenDeEscena);
    const img = currentFiles(ref, 'imagen')[0];
    if (ref.estado !== 'lista' || !img) {
      throw new ProductionError(`Primero genera la escena ${ref.orden} (su imagen se usa aquí).`, 409);
    }
    return img.ruta;
  }
  if (spec.avatarId) {
    const a = await getAvatar(spec.avatarId);
    const file = a.cover || a.photos[0]?.file;
    if (!file) throw new ProductionError(`El avatar "${a.name}" no tiene fotos.`);
    return avatarPhotoPath(a.id, file);
  }
  return null;
}

// ── Ejecución por tipo ────────────────────────────────────────────────────────

const SCENE_ERRORS = (err: unknown, fallback: string) => {
  if (err instanceof ProductionError) return err.message;
  return errorMessage(err, fallback);
};

export async function runImageScene(productionId: string, sceneId: string) {
  const { production: p, scene: s } = await beginScene(productionId, sceneId, 'imagen');
  const spentBefore = s.gastoUSD;
  try {
    const body = ImageRequestSchema.parse({
      model: s.spec.modelo || DEFAULT_IMAGE_MODEL,
      prompt: s.spec.prompt,
      aspectRatio: p.formato,
      resolution: s.spec.resolucion || '1K',
      count: s.spec.cantidad ?? 1,
      avatarId: s.spec.avatarId,
    });
    const result = await generateImages(body, { tool: DIRECTOR_TOOL, saveProject: false, productionId });
    const { production } = await finishScene(productionId, sceneId, async (prod, scene) => {
      for (const [i, img] of result.images.entries()) {
        const ext = path.extname(img.path).slice(1) || 'png';
        const ruta = await placeInProduction(prod, img.path, sceneFileName(scene, 'imagen', ext, result.images.length > 1 ? i + 1 : undefined));
        scene.archivos.push(fileRecord(scene, { rol: 'imagen', herramienta: 'crear_imagen', modelo: body.model, prompt: body.prompt, costoEstimadoUSD: scene.estimadoUSD / result.images.length, costoUSD: img.costUSD, ruta }));
        scene.gastoUSD = roundUSD(scene.gastoUSD + img.costUSD);
      }
      scene.estado = 'lista';
      if (result.errors.length) scene.error = result.errors.join(' · ');
    });
    return { production, imagenes: result.images.length, avisos: result.errors };
  } catch (err) {
    await failScene(productionId, sceneId, SCENE_ERRORS(err, 'No se pudo generar la imagen.'), spentBefore);
    throw err;
  }
}

/** Genera la voz de la escena (o reutiliza la ya hecha en esta versión) y la deja en la carpeta. */
async function ensureVoice(productionId: string, sceneId: string) {
  const s = findScene(await requireProduction(productionId), sceneId);
  const existing = currentFiles(s, 'voz')[0];
  if (existing && s.duracionRealSeg) return { ruta: existing.ruta, durationSec: s.duracionRealSeg, costUSD: 0, reused: true };

  const modelId = s.spec.modeloVoz || (s.spec.tipo === 'voz' ? s.spec.modelo : undefined) || DEFAULT_ELEVEN_MODEL;
  const voice = await synthesizeSpeechWithTimestamps({
    text: s.spec.texto || '',
    voiceId: s.spec.vozId || getConfiguredVoiceId() || '',
    modelId,
    tool: DIRECTOR_TOOL,
    productionId,
  });
  const durationSec = voice.durationSec ?? Math.max(1, voice.characters / 15);
  let ruta = '';
  await finishScene(productionId, sceneId, async (prod, scene) => {
    const tmp = path.join(/*turbopackIgnore: true*/ prod.carpeta, `.tmp-${crypto.randomUUID()}.mp3`);
    await fs.writeFile(tmp, voice.buffer);
    const name = sceneFileName(scene, 'voz', 'mp3');
    ruta = path.join(/*turbopackIgnore: true*/ prod.carpeta, name);
    if (fsSync.existsSync(ruta)) throw new ProductionError(`Ya existe ${name}; no se sobrescribe.`, 409);
    await fs.rename(tmp, ruta);
    scene.archivos.push(fileRecord(scene, { rol: 'voz', herramienta: 'crear_voz', modelo: voice.modelId, prompt: voice.textSent, costoEstimadoUSD: voice.costUSD, costoUSD: voice.costUSD, ruta }));
    if (voice.alignment) {
      const tiempos = path.join(/*turbopackIgnore: true*/ prod.carpeta, sceneFileName(scene, 'tiempos', 'json'));
      await fs.writeFile(tiempos, JSON.stringify({ texto: voice.textSent, ...voice.alignment }, null, 2), 'utf-8');
      scene.archivos.push(fileRecord(scene, { rol: 'tiempos', herramienta: 'crear_voz', modelo: voice.modelId, costoEstimadoUSD: 0, costoUSD: 0, ruta: tiempos }));
    }
    scene.gastoUSD = roundUSD(scene.gastoUSD + voice.costUSD);
    scene.duracionRealSeg = Math.round(durationSec * 100) / 100;
  });
  return { ruta, durationSec, costUSD: voice.costUSD, reused: false };
}

export async function runVoiceScene(productionId: string, sceneId: string) {
  const { scene: s } = await beginScene(productionId, sceneId, 'voz');
  const spentBefore = s.gastoUSD;
  try {
    const voice = await ensureVoice(productionId, sceneId);
    const { production } = await finishScene(productionId, sceneId, (_p, scene) => {
      scene.estado = 'lista';
    });
    return { production, duracionSeg: voice.durationSec, costoUSD: voice.costUSD };
  } catch (err) {
    await failScene(productionId, sceneId, SCENE_ERRORS(err, 'No se pudo generar la voz.'), spentBefore);
    throw err;
  }
}

async function uploadTemp(productionId: string, sceneId: string, file: string, kind: 'image' | 'audio') {
  const buf = await fs.readFile(file);
  const name = path.basename(file);
  const up =
    kind === 'image'
      ? await cloudinaryStorageService.uploadImage(buf, name, 'lulo-studio/director')
      : await cloudinaryStorageService.uploadAudio(buf, name, 'lulo-studio/director');
  await finishScene(productionId, sceneId, (_p, s) => {
    s.temporales = [...(s.temporales ?? []), { publicId: up.publicId, resourceType: kind === 'image' ? 'image' : 'video' }];
  });
  return up.publicUrl;
}

export async function runAvatarScene(productionId: string, sceneId: string) {
  // Las dependencias (foto de otra escena) se comprueban antes de marcarla como "generando"
  const before = await requireProduction(productionId);
  const frame = await sceneFrame(before, findScene(before, sceneId).spec);
  if (!frame) throw new ProductionError('La escena no tiene foto (avatarId o imagenDeEscena).');
  const { production: p, scene: s } = await beginScene(productionId, sceneId, 'avatar');
  try {
    const voice = await ensureVoice(productionId, sceneId);
    const videoUSD = roundUSD(voice.durationSec * videoRate(AVATAR_MODEL));
    const scene = findScene(await requireProduction(productionId), sceneId);
    // La voz real puede durar más que lo previsto: el video se cobra por segundo
    if (scene.aprobadaUSD !== null && scene.gastoUSD + videoUSD > scene.aprobadaUSD * (1 + APPROVAL_MARGIN) + 1e-4) {
      const total = roundUSD(scene.gastoUSD + videoUSD);
      await updateProduction(productionId, (prod) => {
        const sc = findScene(prod, sceneId);
        sc.estimadoUSD = total;
        sc.detalle = `${sc.detalle} · la voz real dura ${voice.durationSec.toFixed(1)} s`;
        requestApproval(prod, [sceneId], `La voz de la escena ${sc.orden} dura ${voice.durationSec.toFixed(1)} s (más de lo previsto)`);
      });
      return {
        production: await requireProduction(productionId),
        jobId: null,
        aviso: `La voz dura ${voice.durationSec.toFixed(1)} s y el video costaría $${videoUSD.toFixed(3)}, más de lo aprobado. La voz ya está guardada; se pidió aprobar el nuevo monto en la app.`,
      };
    }

    const imageUrl = await uploadTemp(productionId, sceneId, frame, 'image');
    const audioUrl = await uploadTemp(productionId, sceneId, voice.ruta, 'audio');
    const job = await createRenderJob({
      tool: DIRECTOR_TOOL,
      title: `${p.nombre} · escena ${s.orden} (avatar)`,
      model: AVATAR_MODEL,
      kind: 'avatar',
      input: {
        imageUrl,
        audioUrl,
        aspectRatio: p.formato === '1:1' ? '9:16' : p.formato,
        motionPrompt: s.spec.movimiento?.trim() || undefined,
        expressiveness: s.spec.expresividad,
      },
      estimatedCostUSD: videoUSD,
      productionId,
      productionSceneId: sceneId,
    });
    const { production } = await finishScene(productionId, sceneId, (_p, sc) => {
      sc.jobId = job.id;
    });
    return { production, jobId: job.id, aviso: voice.reused ? 'Se reutilizó la voz ya generada.' : undefined };
  } catch (err) {
    // La voz pudo cobrarse, pero el video no: el reintento reutiliza la voz y no vuelve a pagarla
    await failScene(productionId, sceneId, SCENE_ERRORS(err, 'No se pudo lanzar el video del avatar.'), null);
    throw err;
  }
}

export async function runBrollScene(productionId: string, sceneId: string) {
  const before = await requireProduction(productionId);
  const frame = await sceneFrame(before, findScene(before, sceneId).spec);
  const { production: p, scene: s } = await beginScene(productionId, sceneId, 'toma_de_apoyo');
  try {
    const model = getBrollModel(s.spec.modelo || DEFAULT_BROLL_MODEL);
    const withAudio = !!s.spec.conAudio;
    const duration = pickBrollDuration(model, Math.ceil(s.spec.duracionSeg ?? 6));
    const imageUrl = frame ? await uploadTemp(productionId, sceneId, frame, 'image') : '';
    const job = await createRenderJob({
      tool: DIRECTOR_TOOL,
      title: `${p.nombre} · escena ${s.orden} (apoyo)`,
      model: model.id,
      kind: 'broll',
      input: {
        imageUrl,
        aspectRatio: p.formato,
        prompt: s.spec.prompt,
        durationSec: duration,
        resolution: model.resolution,
        ...(withAudio ? { generateAudio: true } : {}),
      },
      estimatedCostUSD: roundUSD(duration * brollRate(model, withAudio)),
      productionId,
      productionSceneId: sceneId,
    });
    const { production } = await finishScene(productionId, sceneId, (_p, sc) => {
      sc.jobId = job.id;
    });
    return { production, jobId: job.id };
  } catch (err) {
    await failScene(productionId, sceneId, SCENE_ERRORS(err, 'No se pudo lanzar la toma de apoyo.'), s.gastoUSD);
    throw err;
  }
}
