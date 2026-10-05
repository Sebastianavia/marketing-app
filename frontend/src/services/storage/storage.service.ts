import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { StorageUploadParams, StorageUploadResult, PipelineError } from '@/types/pipeline.types';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export class StorageService {
  private s3Client: S3Client | null = null;
  private bucketName: string;
  private publicDomain: string;
  private isR2Configured: boolean = false;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint =
      process.env.R2_ENDPOINT ||
      process.env.S3_ENDPOINT ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    this.bucketName = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'lulo-studio-assets';
    this.publicDomain =
      process.env.R2_PUBLIC_DOMAIN ||
      process.env.S3_PUBLIC_DOMAIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'http://localhost:3000';

    if (accessKeyId && secretAccessKey && endpoint) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.isR2Configured = true;
    }
  }

  get isConfigured(): boolean {
    return this.isR2Configured;
  }

  /**
   * Sube el buffer de audio MP3 a Cloudflare R2 / S3 y retorna una URL pública/firmada
   * accesible para los servidores de OpenRouter y HeyGen.
   */
  async uploadAudio(params: StorageUploadParams): Promise<StorageUploadResult> {
    const { buffer, fileName, contentType = 'audio/mpeg', folder = 'audio-cache' } = params;
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${folder}/${Date.now()}_${cleanFileName}`;

    // MODO PRODUCCIÓN: Cloudflare R2 / AWS S3
    if (this.s3Client && this.isR2Configured) {
      try {
        const putCommand = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType,
        });

        await this.s3Client.send(putCommand);

        let publicUrl: string;

        // Si se configuró un dominio público (R2 Custom Domain o r2.dev)
        if (this.publicDomain && !this.publicDomain.includes('localhost')) {
          const domain = this.publicDomain.replace(/\/$/, '');
          publicUrl = `${domain}/${objectKey}`;
        } else {
          // Generar URL prefirmada de lectura válida por 2 horas (suficiente para que HeyGen la descargue)
          const getCommand = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey,
          });
          publicUrl = await getSignedUrl(this.s3Client, getCommand, { expiresIn: 7200 });
        }

        return {
          key: objectKey,
          publicUrl,
          bucket: this.bucketName,
          sizeBytes: buffer.length,
        };
      } catch (err: any) {
        throw new PipelineError(
          `Error subiendo activo de audio a Cloudflare R2 / S3: ${err.message}`,
          'audio_upload',
          true,
          err
        );
      }
    }

    // MODO DESARROLLO / LOCALHOST FALLBACK:
    // Guarda el archivo en public/uploads/audio/ para servirlo mediante Next.js local
    try {
      const publicDir = path.join(process.cwd(), 'public', 'uploads', folder);
      if (!fsSync.existsSync(publicDir)) {
        await fs.mkdir(publicDir, { recursive: true });
      }

      const localFilePath = path.join(publicDir, cleanFileName);
      await fs.writeFile(localFilePath, buffer);

      const localAppUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const localPublicUrl = `${localAppUrl}/uploads/${folder}/${cleanFileName}`;

      return {
        key: `local/${folder}/${cleanFileName}`,
        publicUrl: localPublicUrl,
        bucket: 'local-filesystem',
        sizeBytes: buffer.length,
      };
    } catch (localErr: any) {
      throw new PipelineError(
        `Error almacenando audio localmente: ${localErr.message}`,
        'audio_upload',
        false,
        localErr
      );
    }
  }

  /**
   * Limpia el activo temporal del bucket una vez finalizado el renderizado (SRE Best Practice)
   */
  async deleteAudio(key: string): Promise<boolean> {
    if (this.s3Client && this.isR2Configured && !key.startsWith('local/')) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          })
        );
        return true;
      } catch (err) {
        console.warn(`[StorageService] No se pudo eliminar el activo temporal ${key}:`, err);
        return false;
      }
    }
    return true;
  }
}
