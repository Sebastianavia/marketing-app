import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/data/data-dir';

/**
 * Las rutas /api/director/* solo aceptan peticiones de esta misma máquina.
 *
 * `next dev` escucha en toda la red local, así que se comprueban tres cosas:
 *  1. La IP de origen (x-forwarded-for, que Next rellena con la del socket) es de loopback.
 *  2. El Host es localhost / 127.0.0.1 / [::1] (evita DNS rebinding desde el navegador).
 *  3. La cabecera X-Lulo-Director-Token coincide con el archivo `director-token` de la
 *     carpeta de datos. Solo quien puede leer ese archivo (este usuario, en este PC) la conoce;
 *     las dos primeras se pueden falsificar enviando cabeceras, esta no.
 * El servidor MCP (frontend/mcp/lulo-mcp.mjs) lee o crea el mismo archivo.
 */

export const DIRECTOR_TOKEN_HEADER = 'x-lulo-director-token';
const TOKEN_FILE = 'director-token';

export class ForbiddenError extends Error {}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function readOrCreateToken(): Promise<string> {
  const dir = getDataDir();
  const file = path.join(/*turbopackIgnore: true*/ dir, TOKEN_FILE);
  try {
    const token = (await fs.readFile(file, 'utf-8')).trim();
    if (token) return token;
  } catch {
    // No existe todavía: se crea abajo.
  }
  await fs.mkdir(dir, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  try {
    // 'wx' falla si otro proceso (el MCP) lo creó a la vez: entonces se usa el suyo.
    await fs.writeFile(file, token, { encoding: 'utf-8', flag: 'wx' });
    return token;
  } catch {
    return (await fs.readFile(file, 'utf-8')).trim();
  }
}

function hostName(host: string): string {
  // "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]"
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}

/** Lanza ForbiddenError si la petición no viene de esta máquina con el token correcto. */
export async function assertLocalRequest(req: Request): Promise<void> {
  const forwarded = req.headers.get('x-forwarded-for');
  const ips = forwarded ? forwarded.split(',').map((ip) => ip.trim()) : [];
  if (ips.length === 0 || !ips.every((ip) => LOOPBACK_IPS.has(ip))) {
    throw new ForbiddenError('Solo se aceptan peticiones desde este mismo equipo.');
  }

  const host = req.headers.get('host')?.toLowerCase() ?? '';
  if (!LOCAL_HOSTS.has(hostName(host))) {
    throw new ForbiddenError('Solo se aceptan peticiones a localhost.');
  }

  const sent = req.headers.get(DIRECTOR_TOKEN_HEADER)?.trim() ?? '';
  const expected = await readOrCreateToken();
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new ForbiddenError('Falta el token del Director o no es válido.');
  }
}
