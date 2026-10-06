import { v2 as cloudinary } from 'cloudinary';
import { PipelineError } from '@/types/pipeline.types';

export interface CloudinaryUploadResult {
  publicUrl: string;
  publicId: string;
  format?: string;
  bytes: number;
  resourceType: 'image' | 'video' | 'raw';
}

export class CloudinaryStorageService {
  private isConfigured: boolean = false;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName.trim(),
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim(),
        secure: true,
      });
      this.isConfigured = true;
    } else {
      console.warn(
        '[CloudinaryStorageService] Variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET no configuradas.'
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
   * Subida mediante stream binario de Node.js a la API de Cloudinary.
   */
  private async uploadStream(
    buffer: Buffer,
    resourceType: 'image' | 'video' | 'auto',
    folder: string,
    filename: string
  ): Promise<CloudinaryUploadResult> {
    // Si no está configurado, generar fallback seguro para desarrollo local
    if (!this.isConfigured) {
      console.warn(
        `[CloudinaryStorageService] CLOUDINARY no configurado. Simulando URL pública para ${filename}.`
      );
      return {
        publicUrl: `https://res.cloudinary.com/demo/${resourceType}/upload/sample_${Date.now()}.${filename.split('.').pop() || 'mp3'}`,
        publicId: `sample_${Date.now()}`,
        bytes: buffer.length,
        resourceType: resourceType === 'auto' ? 'image' : resourceType,
      };
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
