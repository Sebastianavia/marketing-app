import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { makeTempDir } from '@/lib/video/ffmpeg';
import {
  FONT_SUGGESTIONS,
  ProfileInputSchema,
  blankProfileInput,
  type ProfileInput,
} from '@/config/editor-looks';
import { ffmpeg } from './media';
import { ProfileError } from './profile-store';

/**
 * "Crear perfil desde referencias": la IA mira capturas de reels que te gustan y propone
 * un perfil (colores en HEX, fuente, estilo y posición de subtítulos, gancho, ritmo).
 * Solo propone: el perfil se abre en el formulario y la persona decide si lo guarda.
 */

const MAX_IMAGES = 6;
const MAX_BYTES = 15 * 1024 * 1024;
const HEX = /^#[0-9a-fA-F]{6}$/;

const LookSchema = z.object({
  nombre: z.string().describe('Nombre corto para el perfil, 1 a 3 palabras, en español'),
  descripcion: z.string().describe('Una frase que describa el look'),
  explicacion: z.string().describe('Dos frases en español: qué viste en las referencias y cómo lo trasladaste'),
  colorTexto: z.string().describe('Color del texto de los subtítulos, #RRGGBB'),
  colorResaltado: z.string().describe('Color de la palabra clave resaltada, #RRGGBB'),
  colorBorde: z.string().describe('Color del borde/contorno del texto, #RRGGBB'),
  usaCaja: z.boolean().describe('true si los subtítulos van sobre una caja de color sólido'),
  colorCaja: z.string().describe('Color de la caja detrás del texto, #RRGGBB'),
  colorGanchoTexto: z.string().describe('Color del texto del gancho (titular de los primeros segundos), #RRGGBB'),
  colorGanchoFondo: z.string().describe('Color de fondo del gancho, #RRGGBB'),
  estilo: z.enum(['karaoke', 'palabra', 'frase']).describe('karaoke: frase corta con la palabra que suena pintada; palabra: una palabra a la vez; frase: frase fija'),
  mayusculas: z.boolean(),
  posicion: z.enum(['arriba', 'centro', 'abajo']),
  palabrasPorLinea: z.number().describe('Palabras en pantalla a la vez, 1 a 6'),
  fuente: z.enum(FONT_SUGGESTIONS as [string, ...string[]]).describe('La fuente de esta lista que más se parece'),
  tamano: z.number().describe('Tamaño del subtítulo en px sobre un video de 1080 de ancho (50 a 120)'),
  grosorBorde: z.number().describe('Grosor del contorno en px (0 a 8)'),
  zoomEnCortes: z.boolean().describe('true si el estilo es dinámico, con acercamientos en los cortes'),
  musica: z.enum(['ninguna', 'pad', 'pulso']).describe('pad: suave/calmado; pulso: enérgico; ninguna: sin música'),
});

const hexOr = (v: string, fallback: string) => (HEX.test(v.trim()) ? v.trim().toUpperCase() : fallback);
const clamp = (v: number, min: number, max: number, fallback: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);

export async function profileFromReferences(images: Array<{ name: string; bytes: Buffer }>): Promise<{ perfil: ProfileInput; explicacion: string }> {
  const list = images.filter((i) => i.bytes.length > 0).slice(0, MAX_IMAGES);
  if (!list.length) throw new ProfileError('Sube al menos una captura (PNG, JPG o WEBP).');
  if (list.some((i) => i.bytes.length > MAX_BYTES)) throw new ProfileError('Cada captura debe pesar menos de 15 MB.');

  // Reducir a 768 px con FFmpeg (rápido y sin librerías extra)
  const dir = await makeTempDir('lulo-refs-');
  const files: Array<{ data: Uint8Array; mediaType: string; filename: string }> = [];
  try {
    for (const [i, img] of list.entries()) {
      const ext = (path.extname(img.name).toLowerCase() || '.png').replace(/[^.a-z]/g, '');
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new ProfileError(`"${img.name}" no es una imagen PNG, JPG o WEBP.`);
      const src = path.join(/*turbopackIgnore: true*/ dir, `ref-${i}${ext}`);
      const out = path.join(/*turbopackIgnore: true*/ dir, `ref-${i}.jpg`);
      await fs.writeFile(src, img.bytes);
      try {
        await ffmpeg({ args: ['-y', '-hide_banner', '-i', src, '-vf', "scale='min(768,iw)':-2", '-q:v', '4', out], timeoutMs: 60_000 });
      } catch {
        throw new ProfileError(`No se pudo leer la imagen "${img.name}".`);
      }
      files.push({ data: new Uint8Array(await fs.readFile(out)), mediaType: 'image/jpeg', filename: `referencia-${i + 1}.jpg` });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  const { object } = await orchestrateObject({
    tool: 'video-editor',
    description: 'Edición · perfil desde referencias',
    system:
      'Eres director de arte de videos cortos verticales. Miras capturas de reels y extraes su estilo de edición con valores exactos (colores HEX tomados de la imagen, tamaños en px). Si algo no se ve en las capturas, elige lo que mejor encaje con lo que sí se ve.',
    prompt: `Estas son ${files.length} captura(s) de reels que le gustan a la persona. Propón un perfil de edición que se parezca: subtítulos (colores, fuente, contorno o caja, posición, palabras a la vez, mayúsculas), color de la palabra clave, el gancho de los primeros segundos y si el ritmo es dinámico. Responde en el formato pedido.`,
    files,
    schema: LookSchema,
    temperature: 0.2,
  });

  const base = blankProfileInput();
  const s = base.subtitulos;
  const draft: ProfileInput = {
    ...base,
    nombre: object.nombre.trim().slice(0, 60) || 'Mi estilo',
    descripcion: object.descripcion.trim().slice(0, 200),
    subtitulos: {
      ...s,
      estilo: object.estilo,
      fuente: FONT_SUGGESTIONS.includes(object.fuente) ? object.fuente : s.fuente,
      tamano: clamp(object.tamano, 40, 140, s.tamano),
      mayusculas: object.mayusculas,
      colorTexto: hexOr(object.colorTexto, s.colorTexto),
      colorResaltado: hexOr(object.colorResaltado, s.colorResaltado),
      colorBorde: hexOr(object.colorBorde, s.colorBorde),
      grosorBorde: clamp(object.grosorBorde, 0, 12, s.grosorBorde),
      caja: object.usaCaja,
      colorCaja: hexOr(object.colorCaja, s.colorCaja),
      posicion: object.posicion,
      palabrasPorLinea: object.estilo === 'palabra' ? 1 : clamp(object.palabrasPorLinea, 1, 8, s.palabrasPorLinea),
    },
    gancho: {
      ...base.gancho,
      colorTexto: hexOr(object.colorGanchoTexto, base.gancho.colorTexto),
      colorFondo: hexOr(object.colorGanchoFondo, base.gancho.colorFondo),
    },
    ritmo: { ...base.ritmo, zoomEnCortes: object.zoomEnCortes },
    sonido: { ...base.sonido, musica: object.musica },
  };
  const valid = ProfileInputSchema.safeParse(draft);
  if (!valid.success) throw new ProfileError('La IA propuso un perfil que no se pudo usar. Prueba con otras capturas.');
  return { perfil: valid.data, explicacion: object.explicacion.trim() };
}
