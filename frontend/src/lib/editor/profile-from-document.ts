import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { blankProfileInput, type ProfileInput, FONT_SUGGESTIONS } from '@/config/editor-looks';
import { ProfileError } from './profile-store';
import { listFonts } from './fonts';
import { parseDocument } from './document-parser';

const hex = z.string();

const DocumentProfileSchema = z.object({
  nombre: z.string().describe('Nombre del perfil/estilo (1 a 4 palabras en español)'),
  descripcion: z.string().describe('Descripción breve del estilo visual y ritmo'),
  sobreTi: z.string().describe('Contexto del creador/negocio, público y tono extraído del documento'),
  instrucciones: z.string().describe('Reglas de edición que la IA debe seguir siempre, resumidas en puntos claros (máx 1400 caracteres)'),
  formato: z.enum(['9:16', '4:5', '1:1']).default('9:16'),
  red: z.enum(['instagram', 'tiktok', 'shorts']).default('instagram'),
  subtitulos: z.object({
    activo: z.boolean().default(true),
    estilo: z.enum(['karaoke', 'frase', 'palabra', 'pop', 'caja_activa']).describe('Estilo de subtítulos (karaoke, palabra, pop, etc.)'),
    fuente: z.string().describe('Tipo de letra exacto de los subtítulos mencionado o más cercano'),
    tamano: z.number().describe('Tamaño en píxeles (ej: 60 a 95 para 1080x1920)'),
    mayusculas: z.boolean().default(true),
    colorTexto: hex.describe('Color principal del texto en #RRGGBB'),
    colorResaltado: hex.describe('Color de palabra clave / énfasis en #RRGGBB'),
    colorBorde: hex.default('#000000'),
    grosorBorde: z.number().default(0),
    caja: z.boolean().default(false),
    colorCaja: hex.default('#000000'),
    opacidadCaja: z.number().default(100),
    posicion: z.enum(['arriba', 'centro', 'abajo', 'cara']).default('abajo'),
    palabrasPorLinea: z.number().default(3),
    sombraSuave: z.boolean().default(true),
  }),
  gancho: z.object({
    activo: z.boolean().default(true),
    fuente: z.string().default(''),
    tamano: z.number().default(80),
    colorTexto: hex.default('#FFFFFF'),
    colorFondo: hex.default('#F4581C'),
    duracionSeg: z.number().default(3),
    mayusculas: z.boolean().default(true),
  }),
  ritmo: z.object({
    pausaMaxSeg: z.number().default(0.4),
    margenSeg: z.number().default(0.05),
    quitarErrores: z.boolean().default(true),
    zoomEnCortes: z.boolean().default(true),
    zoomSuave: z.boolean().default(false),
    zoomPct: z.number().default(10),
    normalizarAudio: z.boolean().default(true),
  }),
  sonido: z.object({
    limpiarVoz: z.boolean().default(true),
    musica: z.enum(['ninguna', 'pad', 'pulso', 'archivo']).default('pad'),
    musicaArchivo: z.string().default(''),
    musicaBajoVozDb: z.number().default(18),
    duckingDb: z.number().default(6),
    efectos: z.boolean().default(true),
    efectosBajoVozDb: z.number().default(12),
  }),
  graficos: z.object({
    cantidad: z.enum(['ninguno', 'pocos', 'equilibrado', 'muchos']).default('equilibrado'),
    textoDetras: z.boolean().default(true),
    colorFondo: hex.default('#160A26'),
    colorBorde: hex.default('#A855F7'),
    colorTexto: hex.default('#FFFFFF'),
    colorAcento: hex.default('#F2C84B'),
    opacidad: z.number().default(85),
    fuenteImpacto: z.string().default('Impact'),
    ocultarSubtitulos: z.boolean().default(true),
  }),
  firma: z.object({
    activo: z.boolean().default(false),
    texto: z.string().default(''),
    fuente: z.string().default(''),
    tamano: z.number().default(34),
    color: hex.default('#FFFFFF'),
    opacidad: z.number().default(70),
    posicion: z.enum(['arriba', 'abajo']).default('arriba'),
  }),
  explicacion: z.string().describe('Resumen de lo que se extrajo del documento, qué valores se tomaron directamente y cuáles se dedujeron.'),
});

const clamp = (n: number, a: number, b: number, d: number) => (Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d);
const hexOr = (v: string | undefined, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v?.trim() ?? '') ? v!.trim().toUpperCase() : d);
const fontOk = (f: string | undefined, d: string) => (/^[\p{L}\p{N} ._-]{2,60}$/u.test(f?.trim() ?? '') ? f!.trim() : d);

/**
 * Lee un documento (PDF, texto, markdown) y genera un perfil completo de edición.
 */
export async function profileFromDocument(file: { name: string; bytes: Buffer }): Promise<{ perfil: ProfileInput; explicacion: string }> {
  const parsed = await parseDocument(file);
  const instaladas = (await listFonts().catch(() => [])).map((f) => f.nombre);
  const fuentesValidas = [...new Set([...instaladas, ...FONT_SUGGESTIONS, 'Archivo Black', 'Montserrat', 'Inter', 'Oswald', 'Poppins', 'Sora', 'Anton', 'Roboto'])];

  // Si es PDF y tiene menos de 10 MB, podemos adjuntar también los bytes al orquestador multimodal
  const isSmallPdf = parsed.extension === '.pdf' && parsed.rawBytes.length <= 10 * 1024 * 1024;
  const files = isSmallPdf
    ? [{ data: new Uint8Array(parsed.rawBytes), mediaType: 'application/pdf', filename: parsed.filename }]
    : undefined;

  const { object } = await orchestrateObject({
    tool: 'video-editor',
    description: `Edición · perfil desde documento · ${parsed.filename}`,
    system: `Eres director de arte y editor jefe de videos cortos verticales (Reels, TikTok, Shorts).
Tu labor es analizar un documento de marca, guía de estilo, estándar de edición o brief (${parsed.filename}) y traducirlo a un perfil de edición técnico EXACTO.
Presta especial atención a:
1. TIPOGRAFÍA Y TAMAÑO DE LETRA: Si el documento menciona fuentes (como Montserrat, Archivo Black, Inter, Roboto, etc.) y tamaños de texto/subtítulos (ej: 60px, 75px, 90px), úsalos. Si da un porcentaje de pantalla, tradúcelo para un lienzo vertical de 1080x1920.
2. COLORES: Extrae códigos HEX exactos para subtítulos, palabra clave resaltada, gancho y cajas.
3. ESTILO DE SUBTÍTULOS: karaoke, palabra por palabra, frase fija, pop viral, o caja activa. Posición (abajo, centro, o bajo el mentón "cara").
4. REGLAS DE EDICIÓN: Ritmo de corte de pausas, jump cuts con zoom, efectos de sonido y música.
5. CONTEXTO: Sobre quién es el creador o la empresa y qué mensaje transmite.

Fuentes recomendadas o instaladas en el sistema: ${fuentesValidas.slice(0, 30).join(', ')}.`,
    prompt: `A continuación tienes el contenido del documento "${parsed.filename}" (${parsed.pageCount ?? 1} páginas):

${parsed.text.slice(0, 35000)}

Extrae y formula el perfil de edición completo según el esquema. Si algún parámetro técnico no está especificado explícitamente en el texto, deduce el valor más coherente según el tono y estilo visual de la marca descrita.`,
    files,
    schema: DocumentProfileSchema,
    temperature: 0.1,
  });

  const base = blankProfileInput();
  const s = base.subtitulos;
  const o = object;

  const draft: ProfileInput = {
    ...base,
    nombre: (o.nombre || parsed.filename.replace(/\.[^/.]+$/, '')).trim().slice(0, 60),
    descripcion: o.descripcion.trim().slice(0, 200),
    sobreTi: o.sobreTi.trim().slice(0, 1500),
    instrucciones: o.instrucciones.trim().slice(0, 1500),
    formato: o.formato,
    red: o.red,
    subtitulos: {
      ...s,
      activo: o.subtitulos.activo,
      estilo: o.subtitulos.estilo,
      fuente: fontOk(o.subtitulos.fuente, s.fuente),
      tamano: Math.round(clamp(o.subtitulos.tamano, 30, 160, s.tamano)),
      mayusculas: o.subtitulos.mayusculas,
      colorTexto: hexOr(o.subtitulos.colorTexto, s.colorTexto),
      colorResaltado: hexOr(o.subtitulos.colorResaltado, s.colorResaltado),
      colorBorde: hexOr(o.subtitulos.colorBorde, s.colorBorde),
      grosorBorde: clamp(o.subtitulos.grosorBorde, 0, 12, s.grosorBorde),
      caja: o.subtitulos.caja,
      colorCaja: hexOr(o.subtitulos.colorCaja, s.colorCaja),
      opacidadCaja: Math.round(clamp(o.subtitulos.opacidadCaja, 30, 100, s.opacidadCaja)),
      posicion: o.subtitulos.posicion,
      palabrasPorLinea: Math.round(clamp(o.subtitulos.palabrasPorLinea, 1, 8, s.palabrasPorLinea)),
      sombraSuave: o.subtitulos.sombraSuave,
    },
    gancho: {
      ...base.gancho,
      activo: o.gancho.activo,
      fuente: fontOk(o.gancho.fuente, ''),
      tamano: Math.round(clamp(o.gancho.tamano, 30, 140, base.gancho.tamano)),
      colorTexto: hexOr(o.gancho.colorTexto, base.gancho.colorTexto),
      colorFondo: hexOr(o.gancho.colorFondo, base.gancho.colorFondo),
      duracionSeg: clamp(o.gancho.duracionSeg, 1, 10, base.gancho.duracionSeg),
      mayusculas: o.gancho.mayusculas,
    },
    ritmo: {
      ...base.ritmo,
      pausaMaxSeg: clamp(o.ritmo.pausaMaxSeg, 0.15, 2, base.ritmo.pausaMaxSeg),
      margenSeg: clamp(o.ritmo.margenSeg, 0, 0.4, base.ritmo.margenSeg),
      quitarErrores: o.ritmo.quitarErrores,
      zoomEnCortes: o.ritmo.zoomEnCortes,
      zoomSuave: o.ritmo.zoomSuave,
      zoomPct: Math.round(clamp(o.ritmo.zoomPct, 5, 25, base.ritmo.zoomPct)),
      normalizarAudio: o.ritmo.normalizarAudio,
    },
    sonido: {
      ...base.sonido,
      limpiarVoz: o.sonido.limpiarVoz,
      musica: o.sonido.musica,
      musicaArchivo: o.sonido.musicaArchivo?.slice(0, 200) || '',
      musicaBajoVozDb: clamp(o.sonido.musicaBajoVozDb, 6, 30, base.sonido.musicaBajoVozDb),
      duckingDb: clamp(o.sonido.duckingDb, 0, 15, base.sonido.duckingDb),
      efectos: o.sonido.efectos,
      efectosBajoVozDb: clamp(o.sonido.efectosBajoVozDb, 6, 35, base.sonido.efectosBajoVozDb),
    },
    graficos: {
      ...base.graficos,
      cantidad: o.graficos.cantidad,
      textoDetras: o.graficos.textoDetras,
      colorFondo: hexOr(o.graficos.colorFondo, base.graficos.colorFondo),
      colorBorde: hexOr(o.graficos.colorBorde, base.graficos.colorBorde),
      colorTexto: hexOr(o.graficos.colorTexto, base.graficos.colorTexto),
      colorAcento: hexOr(o.graficos.colorAcento, base.graficos.colorAcento),
      opacidad: Math.round(clamp(o.graficos.opacidad, 30, 100, base.graficos.opacidad)),
      fuenteImpacto: fontOk(o.graficos.fuenteImpacto, base.graficos.fuenteImpacto),
      ocultarSubtitulos: o.graficos.ocultarSubtitulos,
    },
    firma: {
      ...base.firma,
      activo: o.firma.activo,
      texto: o.firma.texto?.slice(0, 60) || '',
      fuente: fontOk(o.firma.fuente, ''),
      tamano: Math.round(clamp(o.firma.tamano, 16, 80, base.firma.tamano)),
      color: hexOr(o.firma.color, base.firma.color),
      posicion: o.firma.posicion,
    },
  };

  return { perfil: draft, explicacion: o.explicacion };
}

