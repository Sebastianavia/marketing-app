import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { listFonts } from './fonts';
import { KIT_FONTS, type BrandInput } from './kit/brands';
import { parseDocument } from './document-parser';

const hex = z.string().describe('Color HEX en formato #RRGGBB');

const DocumentBrandSchema = z.object({
  nombre: z.string().describe('Nombre oficial de la marca o empresa (máx 60 caracteres)'),
  colores: z.object({
    primario: hex.describe('Color primario o dominante de la marca (#RRGGBB)'),
    acento: hex.describe('Color secundario o de acento llamativo (#RRGGBB)'),
    texto: hex.default('#FFFFFF').describe('Color de texto sobre el fondo (#RRGGBB)'),
  }),
  fuente: z.string().describe('Tipografía corporativa o recomendada de la marca (ej: Archivo Black, Montserrat, Inter, Roboto, etc.)'),
  lema: z.string().optional().describe('Lema, eslogan o tagline de la marca (máx 80 caracteres)'),
  usuario: z.string().optional().describe('Usuario en redes sociales si aparece, ej: @marca (máx 40 caracteres)'),
  cta: z.string().optional().describe('Llamada a la acción habitual (CTA) para cierres de video, ej: "Síguenos para más" (máx 60 caracteres)'),
  nota: z.string().optional().describe('Nota o directriz clave de la marca (máx 300 caracteres)'),
  estandar: z.string().optional().describe('Estándar de edición o reglas específicas para videos y contenido audiovisual si están detalladas en el documento'),
  explicacion: z.string().describe('Explicación concisa de los elementos encontrados en el documento'),
});

const hexOr = (v: string | undefined, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v?.trim() ?? '') ? v!.trim().toUpperCase() : d);
const fontOk = (f: string | undefined, d: string) => (/^[\p{L}\p{N} ._-]{2,60}$/u.test(f?.trim() ?? '') ? f!.trim() : d);

export interface ExtractedBrandData {
  marca: BrandInput;
  explicacion: string;
}

/**
 * Lee un documento (PDF, manual de marca, brief) y extrae todos los datos de la marca.
 */
export async function brandFromDocument(file: { name: string; bytes: Buffer }): Promise<ExtractedBrandData> {
  const parsed = await parseDocument(file);
  const instaladas = (await listFonts().catch(() => [])).map((f) => f.nombre);
  const fuentesValidas = [...new Set([...instaladas, ...KIT_FONTS, 'Archivo Black', 'Montserrat', 'Inter', 'Oswald', 'Poppins', 'Sora', 'Anton', 'Roboto'])];

  const isSmallPdf = parsed.extension === '.pdf' && parsed.rawBytes.length <= 10 * 1024 * 1024;
  const files = isSmallPdf
    ? [{ data: new Uint8Array(parsed.rawBytes), mediaType: 'application/pdf', filename: parsed.filename }]
    : undefined;

  const { object } = await orchestrateObject({
    tool: 'video-editor',
    description: `Edición · marca desde documento · ${parsed.filename}`,
    system: `Eres director de branding y diseño gráfico.
Analizas manuales de identidad visual, brand books, guías de estilo y briefs de clientes para extraer la configuración exacta de marca para producción audiovisual:
1. Nombre de la marca.
2. Paleta de colores en formato hexadecimal #RRGGBB (primario de fondo o dominante, color de acento/contraste y color para textos legibles).
3. Tipografía principal: identifica la fuente corporativa oficial o la más cercana de la lista disponible: ${fuentesValidas.slice(0, 30).join(', ')}.
4. Lema o eslogan, usuario en redes sociales (@usuario) y llamada a la acción (CTA) de cierre si aparecen.
5. Reglas o estándares de edición de video si el documento contiene un manual de estilo audiovisual.`,
    prompt: `A continuación tienes el texto del documento "${parsed.filename}" (${parsed.pageCount ?? 1} páginas):

${parsed.text.slice(0, 35000)}

Extrae los datos de la marca en el formato estructurado. Si algún campo como lema o usuario no aparece, déjalo vacío.`,
    files,
    schema: DocumentBrandSchema,
    temperature: 0.1,
  });

  const o = object;
  const marca: BrandInput = {
    nombre: (o.nombre || parsed.filename.replace(/\.[^/.]+$/, '')).trim().slice(0, 60),
    colores: {
      primario: hexOr(o.colores?.primario, '#0B0B0B'),
      acento: hexOr(o.colores?.acento, '#C6FF3D'),
      texto: hexOr(o.colores?.texto, '#FFFFFF'),
    },
    fuente: fontOk(o.fuente, 'Archivo Black'),
    lema: o.lema?.trim().slice(0, 80) || undefined,
    usuario: o.usuario?.trim().slice(0, 40) || undefined,
    cta: o.cta?.trim().slice(0, 60) || undefined,
    nota: o.nota?.trim().slice(0, 300) || undefined,
    estandar: o.estandar?.trim().slice(0, 40000) || undefined,
  };

  return { marca, explicacion: o.explicacion };
}

