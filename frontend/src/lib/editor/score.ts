import { normalizeProfile } from './profile-store';
import { snapToFrames } from './render';
import { keptIntervals, totalDuration } from './timeline';
import { placeGraphics } from './graphics';
import { analyzeRhythm, directedProfile, directionInFinal, resolveDirection } from './direction';
import { beatAlignment, detectBeats, generatedBeats } from './beats';
import { musicDir } from './audio';
import type { EditProject } from './types';

/**
 * Nota de retención (Fase 7, idea 48): 0–100 antes de publicar, a partir del plan de Claude y del
 * control de calidad del borrador. No predice vistas: mide si el video cumple lo que sabemos que
 * retiene (gancho, ritmo, variedad, sonido, cierre, legibilidad). Cada parte dice qué le falta, y
 * las 3 mejoras que más puntos suben van primero.
 */

export interface ScorePart {
  id: 'gancho' | 'ritmo' | 'variedad' | 'sonido' | 'cierre' | 'legibilidad';
  nombre: string;
  puntos: number;
  maximo: number;
  faltas: Array<{ texto: string; pierde: number }>;
}
export interface EditScore {
  total: number;
  partes: ScorePart[];
  mejoras: string[];
  version?: number;
  calculada: string;
}

const NAMES: Record<ScorePart['id'], string> = { gancho: 'Gancho (0–2 s)', ritmo: 'Ritmo y re-ganchos', variedad: 'Variedad y equilibrio', sonido: 'Sonido', cierre: 'Cierre y duración', legibilidad: 'Legibilidad y calidad' };

export async function scoreEdit(p: EditProject): Promise<EditScore | null> {
  if (!p.direccion) return null;
  const perfil = directedProfile(normalizeProfile(p.perfil), p.direccion);
  const intervals = snapToFrames(keptIntervals(p.frases, perfil.ritmo, p.original.duracion));
  const total = totalDuration(intervals);
  const plan = directionInFinal(p.direccion, intervals, total);
  const graphics = placeGraphics(p, intervals, total).map((g) => g.start);
  const sub = perfil.subtitulos;
  const ritmo = analyzeRhythm(plan, graphics, total, sub.activo ? sub.tamano : undefined);
  const parts: ScorePart[] = [];
  const part = (id: ScorePart['id'], maximo: number, checks: Array<[boolean, number, string]>) => {
    const faltas = checks.filter(([ok]) => !ok).map(([, pierde, texto]) => ({ texto, pierde }));
    const puntos = Math.max(0, maximo - faltas.reduce((s, f) => s + f.pierde, 0));
    parts.push({ id, nombre: NAMES[id], puntos, maximo, faltas });
  };
  const inFirst = (t: number | undefined, a = 0, b = 2) => t !== undefined && t >= a && t <= b;
  const cams = plan.camara ?? [];
  const els = plan.elementos ?? [];
  const sonidos = plan.sonidos ?? [];

  // Gancho (25)
  const hookText = (p.gancho?.trim() && perfil.gancho.activo) || els.some((e) => inFirst(e.desde, 0, 1.5)) || (plan.palabrasClave ?? []).some((k) => inFirst(k.t, 0, 2));
  part('gancho', 25, [
    [cams.some((c) => c.desde < 1.5 && (c.tipo !== 'plano' || c.zoom > 1.05)), 6, 'Sin movimiento ni primer plano en el primer segundo: empieza con punch, acercamiento o un plano cerrado.'],
    [!!hookText, 7, 'Nada escrito ni visual en los primeros 1,5 s que tense la promesa: pon texto gancho grande o una pieza del kit.'],
    [sonidos.some((s) => s.t <= 0.6), 4, 'Sin sonido de entrada en el primer medio segundo (impacto, riser que remata, swish).'],
    [!!plan.arranque || cams.some((c) => c.tipo === 'punch' && c.desde < 2), 4, 'Sin arranque en frío ni punch inicial: el inicio puede sentirse plano.'],
    [!!plan.musica && plan.musica.modo !== 'ninguna', 4, 'Sin música que arranque con energía.'],
  ]);

  // Ritmo (25)
  const missingRehooks = ritmo.avisos.filter((a) => a.startsWith('Sin re-gancho')).length;
  part('ritmo', 25, [
    [ritmo.tramoMasLargoSinCambio.segundos <= 3.5, Math.min(10, Math.round((ritmo.tramoMasLargoSinCambio.segundos - 3.5) * 1.5)), `Tramo de ${ritmo.tramoMasLargoSinCambio.segundos} s sin cambios (${ritmo.tramoMasLargoSinCambio.desde}–${ritmo.tramoMasLargoSinCambio.hasta} s): aquí se va la gente.`],
    [ritmo.segundosPorCambio <= 3, Math.min(8, Math.round((ritmo.segundosPorCambio - 3) * 2)), `Un cambio visual cada ${ritmo.segundosPorCambio} s (ideal 1,5–3 s).`],
    [missingRehooks === 0, missingRehooks * 3, `${missingRehooks} punto(s) de abandono (≈3 s, ≈8 s, mitad) sin re-gancho.`],
  ]);

  // Variedad y equilibrio (15)
  const balance = ritmo.avisos.filter((a) => /Demasiad|persona sola|Tres «|Repites|son «|Casi todas|movimientos de cámara son|dura .* máximo/.test(a));
  part('variedad', 15, [[balance.length === 0, Math.min(15, balance.length * 4), balance.slice(0, 2).join(' ') || 'Equilibrio de formatos.']]);

  // Sonido (15)
  let beatOk = true;
  let beatTxt = '';
  const m = resolveDirection(p, p.direccion, intervals, total, await musicDir()).musica;
  if (m && m.modo !== 'ninguna') {
    const grid = m.modo === 'generada' && m.estilo ? generatedBeats(m.estilo, total, m.secciones) : m.abs ? await detectBeats(m.abs, m.inicioArchivo, total).catch(() => null) : null;
    if (grid && (grid.fuente === 'generada' || (grid.confianza ?? 0) >= 0.35)) {
      const cuts = [...cams.map((c) => c.desde).filter((t) => t > 0.2), ...(plan.transiciones ?? []).map((t) => t.t), ...els.map((e) => e.desde)];
      const al = beatAlignment(cuts, grid.beats, 0.08);
      if (cuts.length >= 4 && al.fraccion < 0.5) {
        beatOk = false;
        beatTxt = `Solo ${al.alineados}/${al.total} cortes caen en el beat de la música.`;
      }
    }
  }
  part('sonido', 15, [
    [ritmo.efectosPorSegundo >= 0.3 && ritmo.efectosPorSegundo <= 1.4, 6, `Efectos de sonido: ${ritmo.efectosPorSegundo}/s (ideal 0,3–1,4).`],
    [!!m && m.modo !== 'ninguna', 4, 'Sin música.'],
    [beatOk, 5, beatTxt],
  ]);

  // Cierre y duración (10)
  const dur = p.borrador?.duracion ?? total;
  const bucle = p.borrador?.calidad?.find((c) => c.texto.startsWith('Bucle'));
  part('cierre', 10, [
    [!!plan.bucle || els.some((e) => e.desde >= total - 4) || sonidos.some((s) => s.t >= total - 2), 5, 'El final no tiene nada que empuje a repetir o comentar (bucle, pregunta en pantalla, CTA con su sonido).'],
    [!plan.bucle || !bucle || bucle.ok !== false, 2, 'El bucle no encaja a la vista (el último y el primer plano no se parecen).'],
    [dur >= 12 && dur <= 75, 3, `Dura ${Math.round(dur)} s: para retener, 15–60 s suele rendir mejor (haz una variante corta si el tema lo permite).`],
  ]);

  // Legibilidad y calidad (10)
  const fallos = (p.borrador?.calidad ?? []).filter((c) => c.ok === false);
  part('legibilidad', 10, [
    [!sub.activo || sub.tamano >= 64, 4, `Subtítulos de ${sub.tamano} px: en vertical, 72–100 px.`],
    [fallos.length === 0, Math.min(6, fallos.length * 2), `${fallos.length} aviso(s) del control de calidad: ${fallos.map((f) => f.texto).slice(0, 2).join(' / ')}`],
  ]);

  const totalPts = Math.round(parts.reduce((s, x) => s + x.puntos, 0));
  const mejoras = parts
    .flatMap((x) => x.faltas)
    .filter((f) => f.pierde > 0 && f.texto)
    .sort((a, b) => b.pierde - a.pierde)
    .slice(0, 3)
    .map((f) => `${f.texto} (+${f.pierde})`);
  return { total: totalPts, partes: parts, mejoras, version: p.borrador?.version, calculada: new Date().toISOString() };
}
