import { v2 as cloudinary } from 'cloudinary';
import { PipelineError } from '@/types/pipeline.types';

export interface CloudinaryUploadResult {
  publicUrl: string;
  publicId: string;
  format?: string;
  bytes: number;
  resourceType: 'image' | 'video' | 'raw';
}

export interface CloudinaryCountResult {
  totalCount: number;
  breakdown: Record<string, number>;
  configured: boolean;
  oldestCreatedAt?: string;
  bytesTotal?: number;
}

export interface CloudinaryCleanResult {
  deletedCount: number;
  remainingCount: number;
  requestedLimit: number;
  details: {
    imagesDeleted: number;
    videosDeleted: number;
    rawDeleted: number;
  };
}

export class CloudinaryStorageService {
  private isConfigured: boolean = false;

  constructor() {
    const rawUrl = process.env.CLOUDINARY_URL?.trim();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (
      rawUrl &&
      rawUrl.startsWith('cloudinary://') &&
      !rawUrl.includes('<your_') &&
      !rawUrl.includes('TU_API_SECRET')
    ) {
      cloudinary.config({
        cloudinary_url: rawUrl,
        secure: true,
      });
      this.isConfigured = true;
    } else if (
      cloudName &&
      apiKey &&
      apiSecret &&
      !apiSecret.includes('TU_API_SECRET') &&
      !apiSecret.includes('<your_')
    ) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isConfigured = true;
    } else {
      console.warn(
        '[CloudinaryStorageService] Cloudinary pendiente de configurar con API Secret real.'
      );
    }
  }

  get configured(): boolean {
    return this.isConfigured;
  }

  /**
   * Sube una imagen (retrato del avatar) a Cloudinary y retorna su URL pública segura.
   */
  async uploadImage(
    buffer: Buffer,
    filename: string = `portrait_${Date.now()}.jpg`,
    folder: string = 'lulo-studio/portraits'
  ): Promise<CloudinaryUploadResult> {
    return this.uploadStream(buffer, 'image', folder, filename);
  }

  /**
   * Sube un archivo de audio (locución MP3/WAV) a Cloudinary.
   * NOTA: Cloudinary clasifica los archivos de audio bajo el recurso 'video' para permitir streaming directo.
   */
  async uploadAudio(
    buffer: Buffer,
    filename: string = `speech_${Date.now()}.mp3`,
    folder: string = 'lulo-studio/audio'
  ): Promise<CloudinaryUploadResult> {
    return this.uploadStream(buffer, 'video', folder, filename);
  }

  /**
   * Elimina un archivo de audio o video de Cloudinary para evitar acumulación de archivos huérfanos.
   */
  /** Borra un archivo temporal (imagen o audio/video) por su public_id. */
  async deleteAsset(publicId: string, resourceType: 'image' | 'video'): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      return res?.result === 'ok' || res?.result === 'not found';
    } catch {
      return false;
    }
  }

  async deleteAudio(publicId: string): Promise<boolean> {
    if (!this.isConfigured || !publicId || publicId.startsWith('sample_')) return true;
    try {
      const res = await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      return res?.result === 'ok';
    } catch (err) {
      console.warn(`[CloudinaryStorageService] Fallo al eliminar audio ${publicId}:`, err);
      return false;
    }
  }

  /**
   * Obtiene el conteo total de recursos almacenados en Cloudinary y su desglose por tipo.
   */
  async getTotalCount(): Promise<CloudinaryCountResult> {
    if (!this.isConfigured) {
      return { totalCount: 0, breakdown: {}, configured: false };
    }

    try {
      // Usamos Search API para obtener el total exacto y los recursos más antiguos
      const searchRes = await cloudinary.search
        .expression('')
        .sort_by('created_at', 'asc')
        .max_results(100)
        .execute();

      const breakdown: Record<string, number> = {
        image: 0,
        video: 0,
        raw: 0,
      };

      let bytesTotal = 0;
      if (Array.isArray(searchRes.resources)) {
        for (const r of searchRes.resources) {
          const type = r.resource_type || 'image';
          breakdown[type] = (breakdown[type] || 0) + 1;
          bytesTotal += r.bytes || 0;
        }
      }

      const totalCount = typeof searchRes.total_count === 'number'
        ? searchRes.total_count
        : (searchRes.resources?.length || 0);

      const oldestCreatedAt = searchRes.resources?.[0]?.created_at;

      return {
        totalCount,
        breakdown,
        configured: true,
        oldestCreatedAt,
        bytesTotal,
      };
    } catch (err: any) {
      console.warn('[CloudinaryStorageService] Fallo en search API, intentando fallback de usage:', err);
      try {
        const usage = await cloudinary.api.usage();
        const total = usage?.objects?.usage ?? 0;
        return {
          totalCount: total,
          breakdown: {},
          configured: true,
        };
      } catch (usageErr: any) {
        console.error('[CloudinaryStorageService] Error al obtener conteo:', usageErr);
        throw new Error(err.message || 'No se pudo consultar el almacenamiento de Cloudinary.');
      }
    }
  }

  /**
   * Identifica y elimina por lotes los N archivos más antiguos basándose en created_at.
   */
  async deleteOldestFiles(limit: number = 100): Promise<CloudinaryCleanResult> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary no está configurado en el servidor.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    // 1. Consultar los N recursos más antiguos ordenados ascendentemente por created_at
    const searchRes = await cloudinary.search
      .expression('')
      .sort_by('created_at', 'asc')
      .max_results(safeLimit)
      .execute();

    const resources = searchRes.resources || [];
    if (resources.length === 0) {
      return {
        deletedCount: 0,
        remainingCount: 0,
        requestedLimit: safeLimit,
        details: { imagesDeleted: 0, videosDeleted: 0, rawDeleted: 0 },
      };
    }

    // 2. Agrupar por resource_type (image, video, raw)
    const byType: Record<string, string[]> = {
      image: [],
      video: [],
      raw: [],
    };

    for (const r of resources) {
      const type = r.resource_type || 'image';
      if (!byType[type]) byType[type] = [];
      byType[type].push(r.public_id);
    }

    const details = {
      imagesDeleted: 0,
      videosDeleted: 0,
      rawDeleted: 0,
    };

    // 3. Ejecutar borrado por lotes para cada resource_type
    for (const [type, publicIds] of Object.entries(byType)) {
      if (publicIds.length === 0) continue;
      try {
        const delRes = await cloudinary.api.delete_resources(publicIds, {
          resource_type: type as any,
        });
        const count = Object.values(delRes.deleted || {}).filter(
          (status) => status === 'deleted'
        ).length;

        if (type === 'image') details.imagesDeleted += count;
        else if (type === 'video') details.videosDeleted += count;
        else details.rawDeleted += count;
      } catch (delErr) {
        console.error(`[CloudinaryStorageService] Error eliminando lote de ${type}:`, delErr);
      }
    }

    const deletedCount = details.imagesDeleted + details.videosDeleted + details.rawDeleted;

    // 4. Conocer conteo restante actualizado
    let remainingCount = 0;
    try {
      const updated = await this.getTotalCount();
      remainingCount = updated.totalCount;
    } catch {
      remainingCount = Math.max((searchRes.total_count || 0) - deletedCount, 0);
    }

    return {
      deletedCount,
      remainingCount,
      requestedLimit: safeLimit,
      details,
    };
  }

  /**
   * Subida mediante stream binario de Node.js a la API de Cloudinary.
   */
  private async uploadStream(
    buffer: Buffer,
    resourceType: 'image' | 'video' | 'auto',
    folder: string,
    filename: string
  ): Promise<CloudinaryUploadResult> {
    // Sin credenciales reales no se puede obtener una secure_url válida: fallar explícitamente
    if (!this.isConfigured) {
      throw new PipelineError(
        'Cloudinary no está configurado. Revisa CLOUDINARY_URL o CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET en .env.local.',
        'audio_upload',
        false
      );
    }

    const cleanPublicId = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

    return new Promise((resolve, reject) => {
      const uploadOptions: any = {
        folder,
        public_id: `${Date.now()}_${cleanPublicId}`,
        resource_type: resourceType,
        overwrite: true,
      };

      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('[Cloudinary Upload Error]:', error);
            return reject(
              new PipelineError(
                `Fallo al subir archivo a Cloudinary (${error.http_code || 500}): ${error.message}`,
                'audio_upload',
                true,
                error
              )
            );
          }

          if (!result || !result.secure_url) {
            return reject(
              new PipelineError(
                'Cloudinary no retornó una secure_url válida.',
                'audio_upload',
                false,
                result
              )
            );
          }

          resolve({
            publicUrl: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes || buffer.length,
            resourceType: (result.resource_type as any) || resourceType,
          });
        }
      );

      stream.end(buffer);
    });
  }
}

export const cloudinaryStorageService = new CloudinaryStorageService();
