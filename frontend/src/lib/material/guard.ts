import { DIRECTOR_TOKEN_HEADER, ForbiddenError } from '@/lib/director/local-guard';

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Lecturas que solo puede hacer la ventana de la app (explorar carpetas del PC, ver miniaturas):
 * desde este equipo, a localhost, sin el token del agente y con `Sec-Fetch-Site: same-origin`
 * (el navegador la pone en fetch e <img>; en un GET no siempre manda Origin, por eso no se exige
 * como en assertAppUiRequest). Las escrituras usan assertAppUiRequest.
 */
export function assertAppUiRead(req: Request): void {
  if (req.headers.has(DIRECTOR_TOKEN_HEADER)) throw new ForbiddenError('Solo desde la ventana de Lulo Studio.');
  const forwarded = req.headers.get('x-forwarded-for');
  const ips = forwarded ? forwarded.split(',').map((ip) => ip.trim()) : [];
  if (ips.length === 0 || !ips.every((ip) => LOOPBACK_IPS.has(ip))) throw new ForbiddenError('Solo se aceptan peticiones desde este mismo equipo.');
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!LOCAL_HOSTS.has(name)) throw new ForbiddenError('Solo se aceptan peticiones a localhost.');
  if (req.headers.get('sec-fetch-site') !== 'same-origin') throw new ForbiddenError('Solo desde la ventana de Lulo Studio.');
}
