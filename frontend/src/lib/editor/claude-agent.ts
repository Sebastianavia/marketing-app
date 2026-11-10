import {
  AgentBusyError,
  bashRules,
  defaultAppUrl,
  isAgentTurnActive,
  resetAgentChat,
  startAgentTurn,
  stopAgentTurn,
  type AgentSpec,
} from '@/lib/ai/claude-code/agent-runner';
import { EditError, getEdit, updateEdit } from './edit-store';
import type { EditProject } from './types';

/**
 * Claude como editor de una edición (chat "Claude · editor" en la pantalla de Edición).
 * El motor (turnos, aislamiento, historial) está en lib/ai/claude-code/agent-runner.ts;
 * aquí solo va lo propio del editor: instrucciones, herramientas (MCP lulo-editor) y dónde se guarda el chat.
 */

export { sandboxMode, defaultAppUrl } from '@/lib/ai/claude-code/agent-runner';

const key = (editId: string) => `edit:${editId}`;

function systemPrompt(p: EditProject, ctx: Parameters<AgentSpec['systemPrompt']>[0]) {
  return `Eres el editor de video de Lulo Studio y trabajas para una persona de marketing que NO es técnica. Edita su video exactamente como lo pide.

EDICIÓN: "${p.titulo}"
Carpeta de trabajo (tu cwd): ${p.carpeta}
Video original: ${p.original.archivo} (${p.original.duracion.toFixed(1)} s, ${p.original.ancho}x${p.original.alto}). NUNCA lo modifiques ni lo borres.
Fuentes instaladas para subtítulos: ${ctx.fuentes}
Modelos descargados (recorte de persona, etc.): ${ctx.modelos}

CÓMO TRABAJAR
1. Empieza con lulo: ver_edicion para conocer el perfil, las frases y el borrador actual.
2. Si el pedido se puede hacer con el motor de la app (subtítulos, colores, fuente, posición, gancho, cortes, zoom, música, gráficos, formato), usa cambiar_perfil / cambiar_guion y luego renderizar. Es lo más fiable. Lo que sale de renderizar YA aparece en la app como borrador: no lo vuelvas a publicar.
3. Si el motor no lo hace (efectos especiales, b-roll, transiciones, cambiar fondo, velocidad, superponer imágenes, color grading, lo que sea), hazlo tú con FFmpeg, Python u otra herramienta que instales, trabajando sobre el borrador actual o el original. Guarda tu resultado como MP4 (H.264 + AAC, mismo formato vertical) dentro de la carpeta, en una subcarpeta \`claude/\`, y usa lulo: publicar_borrador para que la persona lo vea en la app.
   Respeta el perfil también en lo que hagas tú: si perfil.sonido.efectos es false (o efectosGancho / efectosCortes / efectosGraficos están en false), NO añadas efectos de sonido (whoosh, golpes, pops, dings) en esos momentos, ni al salir textos, subtítulos o gráficos. Usa sus fuentes, colores y firma.
4. Para sincronizar algo con lo que se dice (textos, capturas, zooms, efectos), usa lulo: palabras_borrador: da cada palabra con su tiempo en el borrador. La transcripción de la app es la buena: no la deduzcas de subtitulos.ass ni digas que "faltan palabras" sin comprobarlo ahí.
5. Comprueba tu resultado antes de publicarlo: MIRA (fotogramas con FFmpeg a \`./claude/fotogramas/\`, varios por segundo en los tramos con movimiento, y míralos con Read) y ESCUCHA (lulo: escuchar_audio sobre tu archivo: volumen total cerca de −14 LUFS, pico ≤ −1 dBFS, los efectos aparecen como picos donde los pusiste, sin silencios raros y sin que la voz baje bajo los efectos o la música). Si algo falla, corrígelo antes de publicar. No uses /tmp ni otras carpetas: fuera de la carpeta de la edición no puedes leer.
6. Coherencia: cualquier texto en pantalla (gancho, rótulos, CTA) debe ir de acuerdo con lo que la persona dice en ese momento. El gancho de los primeros segundos refuerza o resume la primera frase que se oye; no puede contar otra cosa.
7. En tu respuesta, cuenta solo lo que comprobaste. Si no pudiste verificar algo, dilo como duda, no como hecho.
8. No pidas permiso para cada paso: decide tú. Pregunta solo si el pedido es ambiguo de verdad.

REGLAS
- No gastas dinero: no tienes herramientas de pago. Si algo requiere un proveedor de pago (voz nueva, video generado), explícalo y deja que la persona lo haga desde la app.
- Aprobar la edición es solo de la persona, en la app.
${bashRules(ctx, p.carpeta)}

FEEDBACK DEL EQUIPO (app de feedback)
Cada versión del borrador se sube a la app de feedback; el equipo deja notas por tiempo y un feedback general y pulsa «Enviar a Claude». Solo trabajas ese feedback cuando te lo indican (mensaje «Notas y feedback del equipo…» desde Lulo, o la persona en el chat): lulo: ver_feedback muestra las versiones y su estado; con «Enviado a Claude», lulo: tomar_feedback descarga las notas. [mm:ss] = tiempo en ESA versión del borrador (ubícalo con palabras_borrador: los cortes cambian entre versiones). Ejecuta cada corrección que se pueda, publica el borrador nuevo y termina con lulo: responder_feedback (nota por nota qué cambiaste y qué no). La persona sube la versión nueva a Feedback desde Lulo.

RESPUESTA
Contesta en español, corto y claro (sin jerga técnica): qué hiciste, qué versión quedó en la app y qué podría ajustarse. Si algo no se pudo, dilo con honestidad y propone una alternativa.`;
}

function specFor(p: EditProject): AgentSpec {
  return {
    key: key(p.id),
    cwd: p.carpeta,
    mcpName: 'lulo-editor',
    mcpEnv: { LULO_TOOLSET: 'editor', LULO_EDIT_ID: p.id },
    systemPrompt: (ctx) => systemPrompt(p, ctx),
    protectedFiles: [p.original.archivo],
    loadChat: async () => (await getEdit(p.id)).claude,
    saveChat: async (fn) => {
      await updateEdit(p.id, (x) => {
        x.claude = fn(x.claude);
      });
    },
    usage: { tool: 'video-editor', description: `Claude editor · "${p.titulo}"` },
    lostSessionNote: '(La conversación anterior se perdió: empieza mirando la edición con ver_edicion.)',
    videoSkills: {
      renderTool: 'renderizar_html_video',
      entregar: 'Para entregarlo, deja un MP4 H.264 + AAC en tu carpeta (si hiciste gráficos aparte, combínalos con el borrador con FFmpeg) y usa publicar_borrador.',
    },
  };
}

export function isTurnActive(editId: string): boolean {
  return isAgentTurnActive(key(editId));
}

export function stopTurn(editId: string): boolean {
  return stopAgentTurn(key(editId));
}

export function turnKey(editId: string): string {
  return key(editId);
}

export async function sendToClaude(editId: string, mensaje: string, appUrl: string, opts: { mostrar?: string } = {}) {
  const p = await getEdit(editId);
  try {
    return await startAgentTurn(specFor(p), mensaje, appUrl, opts);
  } catch (err) {
    if (err instanceof AgentBusyError) throw new EditError('Claude ya está trabajando en esta edición. Espera o detenlo.', 409);
    if (err instanceof Error && !(err instanceof EditError)) throw new EditError(err.message);
    throw err;
  }
}

/**
 * Primer pase con Claude (modo "Claude · mi suscripción"): tras transcribir, Claude hace la
 * edición completa a partir del pedido. Con "Enséñame el guion antes" deja todo listo sin renderizar.
 */
export async function startClaudeFirstPass(editId: string): Promise<void> {
  const p = await getEdit(editId);
  const pedido = p.pedido?.trim() || 'Haz un reel con este video: quita pausas y errores y déjalo listo para redes.';
  const final = p.revisarAntes
    ? 'La persona marcó "Enséñame el guion antes de crear el video": deja el guion, el estilo y los gráficos listos con cambiar_guion / cambiar_perfil / planear_graficos, pero NO renderices ni publiques. Termina explicándole en pocas líneas qué propones para que lo revise.'
    : 'Renderiza para dejar el borrador listo en la app y revisa fotogramas del borrador antes de contestar (si el pedido lo necesita, mejóralo con tus herramientas y publica tu versión).';
  const instrucciones = `Esta es una edición nueva: el audio ya está transcrito y nadie ha decidido nada todavía. Haz la edición completa según el pedido de la persona. ANTES de decidir nada, extrae fotogramas del original con FFmpeg (p. ej. una hoja de 8 imágenes en ./claude/fotogramas/) y míralos con Read: qué se ve, si hay una persona o un producto, y si el audio es voz o una canción (con canción no añadas música). Luego decide qué frases cortar (falsos comienzos, repeticiones, muletillas, errores, lo que sobra), el gancho, las palabras a resaltar y los gráficos (planear_graficos si el perfil los usa), y ajusta el estilo si el pedido lo pide. ${final}

Pedido de la persona: «${pedido}»`;
  await sendToClaude(editId, instrucciones, defaultAppUrl(), { mostrar: pedido });
}

export async function resetClaudeChat(editId: string): Promise<void> {
  const p = await getEdit(editId);
  try {
    await resetAgentChat(specFor(p));
  } catch (err) {
    if (err instanceof AgentBusyError) throw new EditError(err.message, 409);
    throw err;
  }
}
