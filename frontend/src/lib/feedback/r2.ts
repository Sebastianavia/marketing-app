import fs from 'fs';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type _Object } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

/**
 * Bucket de Cloudflare R2 que lee la app de feedback (https://video-feedback-b07.pages.dev, código en
 * otro repo: ver docs/feedback.md). Regla única del bucket: `<Proyecto>/<video>.mp4`.
 * Junto a cada video, la app de feedback guarda `<video>.feedback.json` / `.feedback.txt`, y Lulo
 * guarda `<video>.lulo.json` (qué hizo Claude con ese feedback). Las claves solo viven en el servidor.
 */

export const FEEDBACK_SUFFIX = '.feedback.json';
export const LULO_SUFFIX = '.lulo.json';
export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i;

export class FeedbackError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

function env() {
  return {
    endpoint: process.env.FEEDBACK_R2_ENDPOINT?.trim(),
    accessKeyId: process.env.FEEDBACK_R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.FEEDBACK_R2_SECRET_ACCESS_KEY?.trim(),
    bucket: process.env.FEEDBACK_R2_BUCKET?.trim() || 'video-feedback',
  };
}

export function feedbackConfigured(): boolean {
  const e = env();
  return Boolean(e.endpoint && e.accessKeyId && e.secretAccessKey);
}

export function feedbackAppUrl(): string {
  return (process.env.FEEDBACK_APP_URL?.trim() || 'https://video-feedback-b07.pages.dev').replace(/\/+$/, '');
}

/** Cada segmento de la clave codificado, como pide la app de feedback. */
export const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** Enlace que abre el reproductor de la app de feedback en ese video. */
export const reviewUrl = (key: string) => `${feedbackAppUrl()}/#/v/${encodeKey(key)}`;

const g = globalThis as unknown as { __luloFeedbackR2?: { client: S3Client; sig: string } };

function client(): { s3: S3Client; bucket: string } {
  const e = env();
  if (!e.endpoint || !e.accessKeyId || !e.secretAccessKey) {
    throw new FeedbackError('Falta configurar la app de feedback: FEEDBACK_R2_ENDPOINT, FEEDBACK_R2_ACCESS_KEY_ID y FEEDBACK_R2_SECRET_ACCESS_KEY en .env.local.', 503);
  }
  if (e.endpoint.endsWith('$') || !e.endpoint.includes('.')) {
    throw new FeedbackError(
      'FEEDBACK_R2_ENDPOINT en .env.local está cortado (termina en "$"). Debe ser la URL completa https://<32-caracteres>.r2.cloudflarestorage.com.',
      503
    );
  }
  if (e.secretAccessKey.endsWith('$')) {
    throw new FeedbackError(
      'FEEDBACK_R2_SECRET_ACCESS_KEY en .env.local parece estar cortada (termina en "$"). Pega la clave completa y reinicia npm run dev.',
      503
    );
  }
  const sig = `${e.endpoint}|${e.accessKeyId}`;
  if (!g.__luloFeedbackR2 || g.__luloFeedbackR2.sig !== sig) {
    g.__luloFeedbackR2 = {
      sig,
      client: new S3Client({
        region: 'auto',
        endpoint: e.endpoint,
        credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey },
        maxAttempts: 4,
      }),
    };
  }
  return { s3: g.__luloFeedbackR2.client, bucket: e.bucket };
}

/** Sube un video (multipart automático para archivos grandes). */
/** S3 solo admite ASCII en los metadatos: se codifican (la app de feedback los decodifica). */
const asciiMeta = (meta: Record<string, string>) => Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, encodeURIComponent(v).slice(0, 500)]));

const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg' };

export async function putVideo(key: string, file: string, meta: Record<string, string>, onProgress?: (pct: number) => void) {
  const { s3, bucket } = client();
  const size = fs.statSync(file).size;
  const up = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(file),
      ContentType: VIDEO_MIME[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'video/mp4',
      ContentLength: size,
      Metadata: asciiMeta(meta),
    },
    partSize: 10 * 1024 * 1024,
    queueSize: 3,
  });
  if (onProgress) up.on('httpUploadProgress', (p) => p.loaded && onProgress(Math.round((p.loaded / size) * 100)));
  await up.done();
  return size;
}

/** ¿Existe ese objeto en el bucket? */
export async function objectExists(key: string): Promise<boolean> {
  const { s3, bucket } = client();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function putJson(key: string, data: unknown, meta: Record<string, string> = {}) {
  const { s3, bucket } = client();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(data), ContentType: 'application/json; charset=utf-8', Metadata: asciiMeta(meta) }));
}

export async function getJson<T>(key: string): Promise<T | null> {
  const { s3, bucket } = client();
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await r.Body?.transformToString('utf-8');
    return text ? (JSON.parse(text) as T) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

/** Todos los objetos del bucket (paginado). */
export async function listAll(): Promise<_Object[]> {
  const { s3, bucket } = client();
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
    out.push(...(r.Contents ?? []));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** JSON con su ETag (para escribir después solo si nadie lo cambió entretanto). */
export async function getJsonTagged<T>(key: string): Promise<{ data: T | null; etag: string | null }> {
  const { s3, bucket } = client();
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await r.Body?.transformToString('utf-8');
    return { data: text ? (JSON.parse(text) as T) : null, etag: r.ETag ?? null };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return { data: null, etag: null };
    throw err;
  }
}

/**
 * Escritura condicional: con etag, solo si el objeto sigue igual (If-Match); sin etag, solo si no
 * existe (If-None-Match). Devuelve false si otra persona lo cambió (412): hay que leer y reintentar.
 */
export async function putJsonIfUnchanged(key: string, data: unknown, etag: string | null): Promise<boolean> {
  const { s3, bucket } = client();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json; charset=utf-8',
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
      })
    );
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.$metadata?.httpStatusCode === 412 || e.name === 'PreconditionFailed') return false;
    throw err;
  }
}

/** Sube un archivo cualquiera (audio de la biblioteca, etc.). */
export async function putFile(key: string, file: string, contentType: string, meta: Record<string, string> = {}) {
  const { s3, bucket } = client();
  const size = fs.statSync(file).size;
  const up = new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: fs.createReadStream(file), ContentType: contentType, ContentLength: size, Metadata: asciiMeta(meta) },
    partSize: 10 * 1024 * 1024,
    queueSize: 3,
  });
  await up.done();
  return size;
}

/** Descarga un objeto a un archivo local (escribe en .part y renombra al terminar). */
export async function getFile(key: string, dest: string): Promise<void> {
  const { s3, bucket } = client();
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await r.Body?.transformToByteArray();
  if (!bytes) throw new FeedbackError(`No se pudo descargar ${key}.`, 502);
  const tmp = `${dest}.part`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, dest);
}
