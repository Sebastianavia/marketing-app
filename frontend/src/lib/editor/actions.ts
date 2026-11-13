import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { z } from 'zod';
import { getStorageBasePath } from '@/lib/storage/project-storage';
import { autoSaveProject } from '@/lib/storage/auto-project';
import { isOrchestratorMode } from '@/config/llm-models';
import { getProfile, normalizeProfile } from './profile-store';
import { planGraphics } from './graphics';
import { keptIntervals, totalDuration } from './timeline';
import { probeVideo } from './media';
import { keptScript } from './analyze';
import { kickEditRunner } from './edit-runner';
import { NETWORKS, NETWORK_LABEL, OutputError, exportForNetwork } from './outputs';
import {
  EditError,
  createWorkFolder,
  editFile,
  getEdit,
  logActivity,
  newEditId,
  saveNewEdit,
  updateEdit,
} from './edit-store';
import { ACTIVE_STATUSES, type EditProject } from './types';

/** Acciones de la pantalla de Edición (crear, revisar, renderizar, aprobar…). */

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const MAX_SECONDS = 30 * 60;

export interface NewEditMeta {
  titulo: string;
  pedido: string;
  perfilId: string;
  revisarAntes: boolean;
  /** Nombre del archivo subido (para la extensión). */
  archivo?: string;
  /** Ruta de un video que ya está en la carpeta de proyectos. */
  rutaLocal?: string;
}

export const NewEditMetaSchema = z.object({
  titulo: z.string().trim().max(80).default(''),
  pedido: z.string().trim().max(2000).default(''),
  perfilId: z.string().min(6),
  revisarAntes: z.boolean().default(true),
  archivo: z.string().max(260).optional(),
  rutaLocal: z.string().max(1024).optional(),
  /** Carpeta de material para Claude (lib/material); la guarda la ruta al crear. */
  carpetaMaterial: z.string().max(1000).optional(),
});

function titleFrom(meta: NewEditMeta): string {
  if (meta.titulo.trim()) return meta.titulo.trim();
  const src = meta.archivo || meta.rutaLocal || 'Mi video';
  return path.parse(path.basename(src)).name.replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Mi video';
}

function extOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    throw new EditError(`Formato no admitido (${ext || 'sin extensión'}). Usa ${VIDEO_EXTENSIONS.join(', ')}.`);
  }
  return ext;
}

/** ¿La ruta está dentro de la carpeta de proyectos? (no se leen archivos de cualquier parte del disco) */
async function insideProjects(file: string): Promise<boolean> {
  const base = await fs.realpath(await getStorageBasePath()).catch(() => '');
  const real = await fs.realpath(file).catch(() => '');
  if (!base || !real) return false;
  const rel = path.relative(base, real);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Crea la edición. El video llega como flujo (subida) o como ruta dentro de Proyectos.
 * Queda en cola para analizar: el runner la toma enseguida.
 */
export async function createEdit(meta: NewEditMeta, body: ReadableStream<Uint8Array> | null): Promise<EditProject> {
  const perfil = await getProfile(meta.perfilId);
  const titulo = titleFrom(meta);
  const source = meta.rutaLocal ? path.normalize(meta.rutaLocal) : null;
  const ext = extOf(source ?? meta.archivo ?? '');

  if (source) {
    if (!fsSync.existsSync(source) || !fsSync.statSync(source).isFile()) throw new EditError('Ese video ya no está en el disco.', 404);
    if (!(await insideProjects(source))) throw new EditError('Solo se pueden usar videos de tu carpeta de proyectos.', 403);
  } else if (!body) {
    throw new EditError('No llegó ningún video.');
  }

  const carpeta = await createWorkFolder(titulo);
  const archivo = `original${ext}`;
  const dest = path.join(/*turbopackIgnore: true*/ carpeta, archivo);
  try {
    if (source) {
      try {
        await fs.link(source, dest); // mismo disco: sin duplicar espacio
      } catch {
        await fs.copyFile(source, dest);
      }
    } else {
      await pipeline(Readable.fromWeb(body as unknown as import('stream/web').ReadableStream), fsSync.createWriteStream(dest));
    }

    const info = await probeVideo(dest);
    if (!info.tieneVideo) throw new EditError('El archivo no parece un video válido (no tiene imagen).');
    if (info.duracion < 1) throw new EditError('El video es demasiado corto o está dañado.');
    if (info.duracion > MAX_SECONDS) throw new EditError('El video dura más de 30 minutos. Córtalo en partes más cortas.');
    if (!info.tieneAudio) throw new EditError('El video no tiene audio: la edición se basa en lo que dices.');

    const now = new Date().toISOString();
    const p: EditProject = {
      id: newEditId(),
      titulo,
      carpeta,
      creado: now,
      actualizado: now,
      pedido: meta.pedido,
      perfilId: perfil.id,
      perfil,
      original: { archivo, duracion: info.duracion, ancho: info.ancho, alto: info.alto, tieneAudio: info.tieneAudio },
      estado: 'en_cola',
      tarea: 'analizar',
      revisarAntes: meta.revisarAntes,
      frases: [],
      gancho: '',
      resaltar: [],
      actividad: [{ t: now, msg: `Video recibido (${Math.round(info.duracion)} s, ${info.ancho}×${info.alto}). En cola.` }],
      costoUSD: 0,
    };
    await saveNewEdit(p);
    kickEditRunner();
    return p;
  } catch (err) {
    // Si el video no sirve, no se deja la carpeta a medias
    await fs.rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

// ── Acciones sobre una edición ────────────────────────────────────────────────

const RevisionSchema = z.object({
  frases: z
    .array(
      z.object({
        id: z.string(),
        cortar: z.boolean(),
        textoEditado: z.string().max(600).optional(),
      })
    )
    .optional(),
  gancho: z.string().max(120).optional(),
  graficos: z
    .array(
      z.object({
        id: z.string().max(40),
        titulo: z.string().max(60),
        texto: z.string().max(120),
        items: z.array(z.string().max(60)).max(3),
        activo: z.boolean(),
        tipo: z.enum(['tarjeta', 'numero', 'lista', 'detras']),
      })
    )
    .max(20)
    .optional(),
  resaltar: z.array(z.string().max(40)).max(20).optional(),
  perfilId: z.string().optional(),
});

export const ActionSchema = z.discriminatedUnion('accion', [
  RevisionSchema.extend({ accion: z.literal('guardar_revision') }),
  RevisionSchema.extend({ accion: z.literal('renderizar') }),
  z.object({ accion: z.literal('reanalizar'), indicacion: z.string().max(600).optional(), modoIA: z.string().optional() }),
  z.object({ accion: z.literal('reintentar'), modoIA: z.string().optional(), sinIA: z.boolean().optional() }),
  z.object({ accion: z.literal('volver_a_revisar') }),
  z.object({ accion: z.literal('aprobar') }),
  z.object({ accion: z.literal('proponer_graficos') }),
  z.object({ accion: z.literal('renombrar'), titulo: z.string().trim().min(1).max(80) }),
  z.object({ accion: z.literal('quitar_direccion') }),
  z.object({ accion: z.literal('exportar'), red: z.enum(NETWORKS) }),
  z.object({ accion: z.literal('borrar_variante'), variante: z.string().max(40) }),
]);

export type EditAction = z.infer<typeof ActionSchema>;

function assertIdle(p: EditProject) {
  if (ACTIVE_STATUSES.includes(p.estado) || p.tarea) {
    throw new EditError('Esta edición se está procesando. Espera a que termine.', 409);
  }
}

async function applyRevision(p: EditProject, r: z.infer<typeof RevisionSchema>) {
  if (r.frases) {
    const byId = new Map(r.frases.map((f) => [f.id, f]));
    p.frases = p.frases.map((f) => {
      const change = byId.get(f.id);
      if (!change) return f;
      const original = f.palabras.map((w) => w.t).join(' ');
      const edited = change.textoEditado?.replace(/\s+/g, ' ').trim();
      return { ...f, cortar: change.cortar, textoEditado: edited && edited !== original ? edited : undefined };
    });
  }
  if (r.gancho !== undefined) p.gancho = r.gancho.replace(/\s+/g, ' ').trim();
  if (r.graficos && p.graficos) {
    const byId = new Map(r.graficos.map((g) => [g.id, g]));
    // Solo se editan los que existen; los que no vienen en la lista se quitan
    p.graficos = p.graficos
      .filter((g) => byId.has(g.id))
      .map((g) => {
        const c = byId.get(g.id)!;
        return {
          ...g,
          tipo: c.tipo,
          titulo: c.titulo.replace(/\s+/g, ' ').trim(),
          texto: c.texto.replace(/\s+/g, ' ').trim(),
          items: c.items.map((i) => i.trim()).filter(Boolean),
          activo: c.activo,
        };
      });
  }
  if (r.resaltar) p.resaltar = [...new Set(r.resaltar.map((w) => w.trim()).filter(Boolean))].slice(0, 20);
  if (r.perfilId && r.perfilId !== p.perfilId) {
    const perfil = await getProfile(r.perfilId);
    p.perfilId = perfil.id;
    p.perfil = perfil;
    logActivity(p, `Perfil cambiado a "${perfil.nombre}".`);
  } else if (r.perfilId) {
    // Mismo perfil: se refresca por si se editó en la biblioteca
    p.perfil = await getProfile(r.perfilId).catch(() => p.perfil);
  }
}

export async function runAction(id: string, raw: unknown): Promise<EditProject> {
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) throw new EditError('Acción no válida.');
  const a = parsed.data;

  if (a.accion === 'aprobar') return approve(id);
  if (a.accion === 'proponer_graficos') return proposeGraphicsNow(id);

  const { edit } = await updateEdit(id, async (p) => {
    switch (a.accion) {
      case 'renombrar':
        p.titulo = a.titulo;
        return;
      case 'exportar': {
        const cur = await getEdit(id);
        if (!cur.borrador) throw new EditError('Primero hace falta un borrador.');
        if (ACTIVE_STATUSES.includes(cur.estado) || cur.tarea) throw new EditError('La edición se está procesando: espera a que termine.', 409);
        try {
          const e = await exportForNetwork(cur, a.red);
          return (
            await updateEdit(id, (q) => {
              q.exportaciones = [...(q.exportaciones ?? []).filter((x) => x.red !== a.red), e];
              logActivity(q, `Exportado para ${NETWORK_LABEL[a.red]}.`);
            })
          ).edit;
        } catch (err) {
          if (err instanceof OutputError) throw new EditError(err.message, err.status);
          throw err;
        }
      }
      case 'borrar_variante':
        return (
          await updateEdit(id, (q) => {
            const v = (q.variantes ?? []).find((x) => x.id === a.variante);
            q.variantes = (q.variantes ?? []).filter((x) => x.id !== a.variante);
            if (v) for (const f of [v.archivo, v.portada].filter(Boolean) as string[]) void fs.rm(editFile(q, f), { force: true }).catch(() => undefined);
          })
        ).edit;
      case 'quitar_direccion':
        assertIdle(p);
        p.direccion = undefined;
        logActivity(p, 'Se quitó el plan de dirección de Claude: el próximo render usa el estilo del perfil.');
        return;
      case 'guardar_revision':
        if (!p.frases.length) throw new EditError('Todavía no hay guion para revisar.', 409);
        assertIdle(p);
        await applyRevision(p, a);
        return;
      case 'renderizar':
        if (!p.frases.length) throw new EditError('Todavía no hay guion.', 409);
        assertIdle(p);
        await applyRevision(p, a);
        if (!p.frases.some((f) => !f.cortar)) throw new EditError('Marcaste todas las frases para cortar: no quedaría video.');
        p.estado = 'en_cola';
        p.tarea = 'renderizar';
        p.error = undefined;
        logActivity(p, 'Video en cola.');
        return;
      case 'reanalizar':
        assertIdle(p);
        if (a.modoIA && !isOrchestratorMode(a.modoIA)) throw new EditError('Modo de IA no válido.');
        p.indicacion = a.indicacion?.trim() || undefined;
        p.modoIA = a.modoIA || p.modoIA;
        p.sinIA = false;
        p.estado = 'en_cola';
        p.tarea = 'analizar';
        p.error = undefined;
        logActivity(p, p.indicacion ? `Cambio pedido a la IA: "${p.indicacion}"` : 'Volver a analizar con la IA.');
        return;
      case 'reintentar': {
        if (p.estado !== 'error' || !p.error) throw new EditError('No hay nada que reintentar.', 409);
        if (a.modoIA && !isOrchestratorMode(a.modoIA)) throw new EditError('Modo de IA no válido.');
        const task = p.error.tarea;
        if (a.modoIA) p.modoIA = a.modoIA;
        if (a.sinIA) p.sinIA = true;
        p.estado = 'en_cola';
        p.tarea = task;
        p.error = undefined;
        logActivity(p, a.sinIA ? 'Reintento sin IA (solo pausas).' : 'Reintentando…');
        return;
      }
      case 'volver_a_revisar':
        assertIdle(p);
        if (!p.frases.length) throw new EditError('Todavía no hay guion.', 409);
        p.estado = 'por_revisar';
        return;
    }
  });
  kickEditRunner();
  return edit;
}

/** Pide (de nuevo) el plan de gráficos a la IA. La IA se llama fuera del candado. */
async function proposeGraphicsNow(id: string): Promise<EditProject> {
  const current = await getEdit(id);
  assertIdle(current);
  if (!current.frases.length) throw new EditError('Todavía no hay guion.', 409);
  const perfil = normalizeProfile(current.perfil);
  const draft = { ...current, perfil: perfil.graficos.cantidad === 'ninguno' ? { ...perfil, graficos: { ...perfil.graficos, cantidad: 'equilibrado' as const } } : perfil };
  const secs = totalDuration(keptIntervals(draft.frases, draft.perfil.ritmo, draft.original.duracion));
  const plan = await planGraphics(draft, secs);
  const { edit } = await updateEdit(id, (p) => {
    p.graficos = plan.graficos;
    logActivity(p, `Nuevo plan de gráficos: ${plan.graficos.length}. ${plan.resumen}`);
  });
  return edit;
}

async function approve(id: string): Promise<EditProject> {
  const current = await getEdit(id);
  // Ya aprobado este mismo borrador: no se duplica la tarjeta en Proyectos
  if (current.estado === 'aprobado' && current.aprobado) return current;
  if (current.estado !== 'borrador' && current.estado !== 'aprobado') throw new EditError('Primero hay que tener un borrador.', 409);
  if (!current.borrador) throw new EditError('No hay borrador para aprobar.', 409);
  const file = editFile(current, current.borrador.archivo);
  if (!fsSync.existsSync(file)) throw new EditError('El borrador ya no está en la carpeta.', 404);

  const project = await autoSaveProject(
    'Ediciones',
    current.titulo,
    {
      title: current.titulo,
      script: keptScript(current),
      prompt: current.pedido,
      ratio: current.perfil.formato,
      videoDurationReal: current.borrador.duracion,
      finalCostUSD: current.costoUSD,
      modelUsed: `Edición · ${current.perfil.nombre}`,
      tags: ['edicion'],
    },
    { videoPath: file, imagePath: current.borrador.portada ? editFile(current, current.borrador.portada) : undefined }
  );
  if (!project?.videoPath) throw new EditError('No se pudo guardar en Proyectos. Revisa la carpeta de proyectos en Ajustes.', 500);

  const { edit } = await updateEdit(id, (p) => {
    p.estado = 'aprobado';
    p.aprobado = { videoPath: project.videoPath!, fecha: new Date().toISOString() };
    logActivity(p, 'Aprobado y guardado en Proyectos → Ediciones.');
  });
  return edit;
}
