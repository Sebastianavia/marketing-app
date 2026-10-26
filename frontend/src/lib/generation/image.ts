import { z } from 'zod';
import { saveGenerated, localMediaUrl } from '@/lib/storage/generated-library';
import { recordUsage, assertWithinDailyLimit } from '@/lib/usage/usage-store';
import { getSettings } from '@/lib/data/settings';
import { getImageModel, IMAGE_MODELS, REALISM_SUFFIX } from '@/config/image-models';
import { autoSaveProject } from '@/lib/storage/auto-project';
import { avatarReferenceDataUrls } from '@/lib/avatars/avatar-store';
import { GenerationError, assertOpenRouterKey } from './errors';

/**
 * Generación de imágenes con la Image API de OpenRouter (POST /api/v1/images), compartida por
 * la ruta /api/images/generate (Creación de imágenes) y el Director.
 * Las referencias van como data URLs base64 (admitidas por la API). Cada imagen se guarda en la
 * biblioteca y se registra en Costos con el costo real (usage.cost).
 */

export const ImageRequestSchema = z.object({
  model: z.string().refine((m) => IMAGE_MODELS.some((x) => x.id === m), 'Modelo no válido.'),
  prompt: z.string().trim().min(3, 'Escribe qué imagen quieres.').max(4000),
  references: z.array(z.string().max(14_000_000, 'Cada imagen debe pesar menos de 10 MB.')).max(14).default([]),
  aspectRatio: z.string().max(10).default('1:1'),
  resolution: z.string().max(5).default('1K'),
  count: z.number().int().min(1).max(4).default(1),
  realism: z.boolean().default(true),
  /** Avatar guardado: sus fotos van primero como referencias de identidad. */
  avatarId: z.string().max(120).optional(),
});

export type ImageRequest = z.infer<typeof ImageRequestSchema>;

export interface GeneratedImage {
  url: string;
  path: string;
  costUSD: number;
}

export interface ImageResult {
  images: GeneratedImage[];
  errors: string[];
  sent: { avatar: string | null; avatarPhotos: number; extraRefs: number };
}

export interface ImageOptions {
  /** Herramienta que aparece en Costos. */
  tool?: string;
  /** Crear la carpeta de Proyectos → Creación de imágenes (la ruta sí; el Director guarda en su producción). */
  saveProject?: boolean;
  productionId?: string;
}

/** Costo de catálogo por imagen para el modelo y la resolución pedidos. */
export function imageUnitPrice(modelId: string, resolution: string) {
  const spec = getImageModel(modelId);
  const res = spec.resolutions.includes(resolution) ? resolution : spec.resolutions[0];
  return { spec, resolution: res, unit: spec.pricePerImage[res] ?? Object.values(spec.pricePerImage)[0] };
}

export async function generateImages(body: ImageRequest, opts: ImageOptions = {}): Promise<ImageResult> {
  const tool = opts.tool ?? 'image-studio';
  const key = assertOpenRouterKey();
  const { spec, resolution, unit } = imageUnitPrice(body.model, body.resolution);
  if (body.references.length > spec.maxRefs) {
    throw new GenerationError(`${spec.name} acepta hasta ${spec.maxRefs} imágenes de referencia.`);
  }

  const settings = await getSettings();
  await assertWithinDailyLimit(unit * body.count, settings.dailyLimitUSD);

  // Avatar: sus fotos ocupan los primeros huecos (portada primero) y el resto queda para las referencias extra.
  let references = body.references;
  let identity = '';
  let avatarLabel = '';
  if (body.avatarId) {
    const free = spec.maxRefs - body.references.length;
    if (free < 1) {
      throw new GenerationError(`Con un avatar quedan ${spec.maxRefs - 1} huecos para referencias extra; quita alguna.`);
    }
    const { avatar, urls } = await avatarReferenceDataUrls(body.avatarId, free);
    if (!urls.length) throw new GenerationError(`El avatar "${avatar.name}" no tiene fotos todavía.`);
    references = [...urls, ...body.references];
    avatarLabel = ` · avatar ${avatar.name}`;
    const n = urls.length;
    identity =
      `${n === 1 ? 'La imagen de referencia 1 es una foto' : `Las imágenes de referencia 1 a ${n} son fotos`} de la misma persona, a quien llamamos ${avatar.name}` +
      `${avatar.description ? ` (${avatar.description})` : ''}. ` +
      'La persona de la imagen generada debe ser exactamente ella: mismo rostro y rasgos, tono de piel, color y forma del cabello, edad y complexión. ' +
      'No la cambies, no la embellezcas ni la conviertas en otra persona; no copies el fondo ni la ropa de esas fotos salvo que se pida.' +
      (body.references.length
        ? ` Las imágenes ${n + 1} a ${n + body.references.length} son referencias adicionales (producto, ropa, lugar o estilo).`
        : '') +
      '\n\nEscena: ';
  }

  const scene = `${identity}${body.prompt}`;
  const prompt = body.realism ? `${scene}\n\n${REALISM_SUFFIX}` : scene;
  const out: GeneratedImage[] = [];
  const errors: string[] = [];

  for (let i = 0; i < body.count; i++) {
    const res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Lulo Studio Desktop - Imágenes',
      },
      body: JSON.stringify({
        model: spec.id,
        prompt,
        resolution,
        aspect_ratio: body.aspectRatio,
        ...(references.length
          ? { input_references: references.map((url) => ({ type: 'image_url', image_url: { url } })) }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `OpenRouter respondió ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new GenerationError(
          `La clave de OpenRouter no es válida o expiró (${msg}). Cámbiala en OPENROUTER_API_KEY y reinicia la app.`,
          401
        );
      }
      errors.push(
        /exceeded your current quota|resource has been exhausted|rate.?limit/i.test(String(msg))
          ? `${spec.name} está saturado en este momento (el proveedor se quedó sin cupo; no se te cobró). Prueba en unos minutos o usa otro modelo.`
          : msg
      );
      await recordUsage({
        tool, kind: 'image', provider: 'openrouter', model: spec.id,
        description: `Imagen falló: ${String(msg).slice(0, 80)}`, units: 0, unit: 'imágenes', costUSD: 0, estimated: false, status: 'failed',
        productionId: opts.productionId,
      });
      continue;
    }
    const item = Array.isArray(data?.data) ? data.data[0] : null;
    if (!item?.b64_json) {
      errors.push('El proveedor no devolvió la imagen.');
      continue;
    }
    const ext = String(item.media_type || 'image/png').includes('jpeg') ? 'jpg' : 'png';
    const path = await saveGenerated('image', Buffer.from(item.b64_json, 'base64'), ext, crypto.randomUUID());
    const realCost = typeof data?.usage?.cost === 'number' ? data.usage.cost : null;
    const costUSD = realCost ?? unit;
    await recordUsage({
      tool,
      kind: 'image',
      provider: 'openrouter',
      model: spec.id,
      description: `Imagen ${resolution} ${body.aspectRatio}${avatarLabel}${body.references.length ? ` · ${body.references.length} ref.` : ''} · "${body.prompt.slice(0, 60)}${body.prompt.length > 60 ? '…' : ''}"`,
      units: 1,
      unit: 'imagen',
      costUSD,
      estimated: realCost === null,
      filePath: path,
      productionId: opts.productionId,
    });
    out.push({ url: localMediaUrl(path), path, costUSD });
  }

  // Proyectos → Creación de imágenes: una carpeta por tanda, con las imágenes y el prompt dentro
  if (out.length && opts.saveProject !== false) {
    await autoSaveProject(
      'Imagenes',
      body.prompt.split(/[.,\n]/)[0].slice(0, 40) || 'Imagen',
      {
        title: body.prompt.slice(0, 80),
        prompt: body.prompt,
        ratio: body.aspectRatio,
        avatarName: avatarLabel ? avatarLabel.replace(' · avatar ', '') : undefined,
        modelUsed: spec.id,
        finalCostUSD: Math.round(out.reduce((t, x) => t + x.costUSD, 0) * 10000) / 10000,
        audioMode: 'local',
      },
      { imagePaths: out.map((x) => x.path) }
    );
  }

  if (!out.length) {
    throw new GenerationError(errors[0] || 'No se pudo generar la imagen.', 502);
  }
  return {
    images: out,
    errors,
    sent: {
      avatar: avatarLabel ? avatarLabel.replace(' · avatar ', '') : null,
      avatarPhotos: references.length - body.references.length,
      extraRefs: body.references.length,
    },
  };
}
