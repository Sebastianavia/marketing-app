import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { ProfileInputSchema, blankProfileInput, type ProfileInput } from '@/config/editor-looks';
import { ProfileError } from './profile-store';
import { listFonts } from './fonts';
import type { Brand } from './kit/brands';

/**
 * «Crear estilo desde el estándar»: la IA lee el estándar de edición de una marca y rellena un
 * estilo (perfil) que ya lo cumple, con valores exactos. Así, aunque una edición se haga en modo
 * automático (sin Claude dirigiendo), sale con el estilo del cliente; con Claude, es su punto de
 * partida (el estándar sigue mandando).
 */

const hex = z.string();
const StandardLookSchema = z.object({
  nombre: z.string(),
  descripcion: z.string(),
  instrucciones: z.string().describe('Las reglas del estándar que más pesan, resumidas en frases cortas (máx. 1400 caracteres).'),
  formato: z.enum(['9:16', '4:5', '1:1']),
  red: z.enum(['instagram', 'tiktok', 'shorts']),
  subtitulos: z.object({
    estilo: z.enum(['karaoke', 'frase', 'palabra', 'pop', 'caja_activa']),
    fuente: z.string(),
    tamano: z.number(),
    mayusculas: z.boolean(),
    colorTexto: hex,
    colorResaltado: hex,
    colorBorde: hex,
    grosorBorde: z.number(),
    caja: z.boolean(),
    colorCaja: hex,
    posicion: z.enum(['arriba', 'centro', 'abajo', 'cara']),
    palabrasPorLinea: z.number(),
    sombraSuave: z.boolean(),
  }),
  gancho: z.object({ activo: z.boolean(), fuente: z.string(), tamano: z.number(), colorTexto: hex, colorFondo: hex, duracionSeg: z.number(), mayusculas: z.boolean() }),
  ritmo: z.object({ pausaMaxSeg: z.number(), margenSeg: z.number(), zoomEnCortes: z.boolean() }),
  sonido: z.object({ musicaBajoVozDb: z.number(), duckingDb: z.number(), efectosBajoVozDb: z.number() }),
  graficos: z.object({ colorFondo: hex, colorBorde: hex, colorTexto: hex, colorAcento: hex, fuenteImpacto: z.string() }),
  explicacion: z.string().describe('Qué tomaste del estándar y qué no se puede expresar en un estilo (lo seguirá Claude).'),
});

const clamp = (n: number, a: number, b: number, d: number) => (Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d);
const hexOr = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v?.trim() ?? '') ? v.trim().toUpperCase() : d);
const fontOk = (f: string, d: string) => (/^[\p{L}\p{N} ._-]{2,60}$/u.test(f?.trim() ?? '') ? f.trim() : d);

export async function profileFromStandard(b: Brand): Promise<{ perfil: ProfileInput; explicacion: string }> {
  if (!b.estandar?.trim()) throw new ProfileError('Esta marca no tiene estándar de edición: pégalo primero en la marca.');
  const instaladas = (await listFonts()).map((f) => f.nombre);
  const { object } = await orchestrateObject({
    tool: 'video-editor',
    description: `Edición · estilo desde el estándar · ${b.nombre}`,
    system:
      'Eres editor jefe de videos cortos verticales. Conviertes el estándar de edición de un cliente en un estilo (perfil) del editor de Lulo Studio con valores EXACTOS. Tamaños en px para un video de 1080×1920 (si el estándar da un % del alto, multiplícalo por 1920). Colores en HEX tal cual vienen. Si el estándar pide subtítulos «debajo del mentón» o anclados a la cara, usa posicion «cara». «Sin caja y sin borde, con sombra suave» = caja false, grosorBorde 0, sombraSuave true. Segundos máximos entre frases → ritmo.pausaMaxSeg (y margenSeg pequeño, 0,03–0,08). Volumen de la música «N dB por debajo» → musicaBajoVozDb; ducking → duckingDb; efectos «N dB por debajo» → efectosBajoVozDb.',
    prompt: `Marca: ${b.nombre}. Colores guardados en la marca: primario ${b.colores.primario}, acento ${b.colores.acento}, texto ${b.colores.texto}. Tipografía de la marca: ${b.fuente}.
Fuentes instaladas en este PC (usa EXACTAMENTE uno de estos nombres si el estándar pide una de ellas o su alternativa): ${instaladas.join(', ') || '(ninguna)'}. También valen: Inter, Montserrat, Oswald, Archivo Black.

ESTÁNDAR DE EDICIÓN:
${b.estandar.trim()}

Devuelve el estilo en el formato pedido. Nombre: «${b.nombre}» (o «${b.nombre} · estándar»).`,
    schema: StandardLookSchema,
    temperature: 0.1,
  });

  const base = blankProfileInput();
  const s = base.subtitulos;
  const o = object;
  const draft: ProfileInput = {
    ...base,
    nombre: (o.nombre || b.nombre).trim().slice(0, 60),
    descripcion: o.descripcion.trim().slice(0, 200),
    instrucciones: o.instrucciones.trim().slice(0, 1500),
    formato: o.formato,
    red: o.red,
    subtitulos: {
      ...s,
      activo: true,
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
      zoomEnCortes: o.ritmo.zoomEnCortes,
    },
    sonido: {
      ...base.sonido,
      musicaBajoVozDb: clamp(o.sonido.musicaBajoVozDb, 6, 30, base.sonido.musicaBajoVozDb),
      duckingDb: clamp(o.sonido.duckingDb, 0, 15, base.sonido.duckingDb),
      efectosBajoVozDb: clamp(o.sonido.efectosBajoVozDb, 6, 35, base.sonido.efectosBajoVozDb),
    },
    graficos: {
      ...base.graficos,
      colorFondo: hexOr(o.graficos.colorFondo, base.graficos.colorFondo),
      colorBorde: hexOr(o.graficos.colorBorde, base.graficos.colorBorde),
      colorTexto: hexOr(o.graficos.colorTexto, base.graficos.colorTexto),
      colorAcento: hexOr(o.graficos.colorAcento, base.graficos.colorAcento),
      fuenteImpacto: fontOk(o.graficos.fuenteImpacto, base.graficos.fuenteImpacto),
    },
  };
  const valid = ProfileInputSchema.safeParse(draft);
  if (!valid.success) throw new ProfileError(`La IA propuso un estilo que no se pudo usar (${valid.error.issues[0]?.message ?? 'datos no válidos'}). Inténtalo otra vez.`);
  return { perfil: valid.data, explicacion: o.explicacion.trim() };
}
