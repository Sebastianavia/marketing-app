import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAppUiRequest, ForbiddenError } from '@/lib/director/local-guard';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  url: z.string().trim().url('Escribe una URL válida que empiece por https:// o http://'),
  confidencial: z.boolean().default(false),
});

const SellingPointsSchema = z.object({
  titulo: z.string().describe('Nombre limpio del producto o servicio (máx. 70 caracteres)'),
  descripcion: z.string().describe('Descripción clara de 1 o 2 frases en español sobre qué es y para quién sirve'),
  sellingPoints: z
    .array(z.string().describe('Argumento de venta concreto y persuasivo en español (5 a 15 palabras)'))
    .min(2)
    .max(5),
});

function isSafePublicUrl(rawUrl: string): URL {
  const u = new URL(rawUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Solo se admiten enlaces http:// o https://.');
  }
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^169\.254\./.test(h)
  ) {
    throw new Error('No se permiten direcciones locales o privadas.');
  }
  return u;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string, pattern: RegExp): string {
  const m = pattern.exec(html);
  return m?.[1] ? decodeHtmlEntities(m[1]) : '';
}

function parseProductHtml(html: string, baseUrl: URL) {
  const ogTitle =
    extractMeta(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const titleTag = extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i);
  const ogDesc =
    extractMeta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  const imgCandidates: string[] = [];
  const addImg = (raw?: string) => {
    if (!raw || typeof raw !== 'string') return;
    try {
      const resolved = new URL(decodeHtmlEntities(raw.trim()), baseUrl).toString();
      if (/^https?:\/\//i.test(resolved) && !/\.svg(\?|$)/i.test(resolved) && !imgCandidates.includes(resolved)) {
        imgCandidates.push(resolved);
      }
    } catch {
      // url inválida
    }
  };

  // og:image y twitter:image
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
    addImg(m[1]);
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) {
    addImg(m[1]);
  }

  // JSON-LD (Product schema)
  let ldText = '';
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed?.['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const imgs = Array.isArray(item.image) ? item.image : item.image ? [item.image] : [];
        for (const im of imgs) {
          if (typeof im === 'string') addImg(im);
          else if (im && typeof im.url === 'string') addImg(im.url);
        }
        if (item.name || item.description) {
          ldText += `${item.name ?? ''}. ${item.description ?? ''}\n`;
        }
      }
    } catch {
      // json-ld malformado
    }
  }

  const bodyText = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).slice(0, 5000);

  return {
    rawTitle: ogTitle || titleTag || baseUrl.hostname,
    rawDesc: ogDesc,
    ldText: ldText.slice(0, 2000),
    bodyText,
    imageUrls: imgCandidates.slice(0, 4),
  };
}

async function fetchProductImages(urls: string[]) {
  const out: Array<{ name: string; mime: string; dataUrl: string }> = [];
  for (let i = 0; i < urls.length && out.length < 3; i++) {
    try {
      const u = isSafePublicUrl(urls[i]);
      const r = await fetch(u.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LuloStudioBot/1.0)' },
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) continue;
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(jpeg|jpg|png|webp)$/.test(ct)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.byteLength < 1500 || buf.byteLength > 8 * 1024 * 1024) continue;
      const mime = ct === 'image/jpg' ? 'image/jpeg' : ct;
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      out.push({
        name: `producto-${out.length + 1}.${ext}`,
        mime,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
      });
    } catch {
      // si una imagen falla o bloquea hotlink, seguimos con las demás
    }
  }
  return out;
}

/**
 * Paso 2 y 3 del flujo de Buzzy (ugc-ads / tvc-ads):
 * Recibe una URL de producto, extrae título, descripción, fotos del producto y Selling Points con IA ($0).
 */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'URL no válida.' }, { status: 400 });
    }
    const targetUrl = isSafePublicUrl(parsed.data.url);
    const res = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `No se pudo leer la página (${res.status}). Pega la descripción manualmente.` }, { status: 422 });
    }
    const html = await res.text();
    const info = parseProductHtml(html, targetUrl);
    const imagesPromise = fetchProductImages(info.imageUrls);

    let extracted = {
      titulo: info.rawTitle.slice(0, 70),
      descripcion: info.rawDesc.slice(0, 240) || info.bodyText.slice(0, 240),
      sellingPoints: [] as string[],
    };

    try {
      const { object } = await orchestrateObject({
        tool: 'text-to-video',
        description: 'Director · Extraer producto y selling points desde URL',
        system:
          'Eres estratega de marketing directo y anuncios UGC/TVC. Extraes de la página de un producto su nombre limpio, descripción corta y entre 3 y 5 argumentos de venta (selling points) concretos, sin inventar datos que no estén en el texto.',
        prompt: `URL: ${targetUrl.toString()}
TÍTULO DETECTADO: ${info.rawTitle}
META DESCRIPCIÓN: ${info.rawDesc}
DATOS ESTRUCTURADOS: ${info.ldText}
TEXTO DE LA PÁGINA:
${info.bodyText}`,
        schema: SellingPointsSchema,
        temperature: 0.3,
        confidential: parsed.data.confidencial,
      });
      extracted = object;
    } catch {
      extracted.sellingPoints = [
        info.rawDesc.slice(0, 90) || 'Beneficio principal del producto',
        'Diseño pensado para uso diario y resultados rápidos',
        'Fácil de integrar en tu rutina',
      ];
    }

    const images = await imagesPromise;
    return NextResponse.json({
      url: targetUrl.toString(),
      titulo: extracted.titulo,
      descripcion: extracted.descripcion,
      sellingPoints: extracted.sellingPoints,
      images,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: errorMessage(err, 'No se pudo analizar el enlace del producto.') }, { status: 400 });
  }
}

