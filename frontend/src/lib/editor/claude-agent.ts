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
import { EDITOR_FIRST_PASS, VIRAL_DIRECTION_PRINCIPLES } from '@/lib/ai/claude-code/creative-direction';
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
2. Las decisiones creativas son TUYAS y van en el plan de dirección (lulo: dirigir_edicion): cámara, transiciones, color, diseño de subtítulos, palabras clave, gancho, gráficos, elementos visuales, efectos de sonido y música. El motor lo ejecuta tal cual al renderizar (sin reglas automáticas). Cortes y textos de las frases: cambiar_guion. Formato, red, firma o perfil base: cambiar_perfil. Lo que sale de renderizar YA aparece en la app como borrador: no lo vuelvas a publicar.
   Del perfil respeta el formato, la red (zona segura) y la firma. Los COLORES, FUENTES y el estilo los eliges tú para cada video según su concepto (campo paleta del plan); usa los del perfil solo si la persona pide su marca. Respeta siempre lo que la persona escribió en perfil.sobreTi y perfil.instrucciones o pida en el chat (si pide «sin música» o «sin efectos», no los pongas).
3. Si algo no se puede con el plan (efectos muy especiales, cambiar el fondo, velocidad, máscaras), hazlo tú con FFmpeg o HyperFrames (Python solo para tareas técnicas; prohibido usar Pillow/PIL para dibujar nada visible: flechas, textos, figuras, iconos, tarjetas o fondos), trabajando sobre el borrador actual o el original. Guarda tu resultado como MP4 (H.264 + AAC, mismo formato vertical) dentro de la carpeta, en una subcarpeta \`claude/\`, y usa lulo: publicar_borrador para que la persona lo vea en la app.
4. Para sincronizar algo con lo que se dice (textos, capturas, zooms, efectos), usa lulo: palabras_borrador: da cada palabra con su tiempo en el borrador. La transcripción de la app es la buena: no la deduzcas de subtitulos.ass ni digas que "faltan palabras" sin comprobarlo ahí.
5. Comprueba tu resultado antes de publicarlo: MIRA (fotogramas con FFmpeg a \`./claude/fotogramas/\`, varios por segundo en los tramos con movimiento, y míralos con Read) y ESCUCHA (lulo: escuchar_audio sobre tu archivo: volumen total cerca de −14 LUFS, pico ≤ −1 dBFS, los efectos aparecen como picos donde los pusiste, sin silencios raros y sin que la voz baje bajo los efectos o la música). Si algo falla, corrígelo antes de publicar. No uses /tmp ni otras carpetas: fuera de la carpeta de la edición no puedes leer.
6. Coherencia: cualquier texto en pantalla (gancho, rótulos, CTA) debe ir de acuerdo con lo que la persona dice en ese momento. El gancho de los primeros segundos refuerza o resume la primera frase que se oye; no puede contar otra cosa.
7. En tu respuesta, cuenta solo lo que comprobaste. Si no pudiste verificar algo, dilo como duda, no como hecho.
8. No pidas permiso para cada paso: decide tú. Pregunta solo si el pedido es ambiguo de verdad.

${VIRAL_DIRECTION_PRINCIPLES}

REGLAS
- No gastas dinero: no tienes herramientas de pago. Si algo requiere un proveedor de pago (voz nueva, video generado), explícalo y deja que la persona lo haga desde la app.
- Aprobar la edición es solo de la persona, en la app.
${bashRules(ctx, p.carpeta)}

FEEDBACK DEL EQUIPO (app de feedback)
Cada versión del borrador se sube a la app de feedback; el equipo deja notas por tiempo y un feedback general y pulsa «Enviar a Claude». Solo trabajas ese feedback cuando te lo indican (mensaje «Notas y feedback del equipo…» desde Lulo, o la persona en el chat): lulo: ver_feedback muestra las versiones y su estado; con «Enviado a Claude», lulo: tomar_feedback descarga las notas. [mm:ss] = tiempo en ESA versión del borrador (ubícalo con palabras_borrador: los cortes cambian entre versiones). Ejecuta cada corrección que se pueda, publica el borrador nuevo y termina con lulo: responder_feedback (nota por nota qué cambiaste y qué no). Después, guarda lo aprendido en el MANUAL DE EDICIÓN con lulo: aprender_del_feedback: convierte cada nota que sirva para FUTUROS videos en una regla general y accionable (no «en el 0:12…», sino «nunca X cuando Y»); si una nota repite una regla que ya está en el manual, confírmala con su id en vez de crear otra. No guardes lo que solo vale para este video.

MANUAL DE EDICIÓN (aprende también en el chat)
Si la persona te pide en el chat un cambio de criterio que valdría para cualquier video (p. ej. «los subtítulos siempre más grandes», «menos efectos», «no uses ese color»), aplícalo y guárdalo también con aprender_del_feedback. Puedes consultar el manual completo con ver_manual. La persona sube la versión nueva a Feedback desde Lulo.

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
    manual: true,
    videoSkills: {
      renderTool: 'renderizar_html_video',
      entregar: 'Para entregarlo, deja un MP4 H.264 + AAC en tu carpeta (si hiciste gráficos aparte, combínalos con el borrador con FFmpeg) y usa publicar_borrador.',
    },
    material: {
      comoUsar:
        'En la edición sirve para tomas de apoyo (b-roll), fotos, logos, música, efectos y textos o guiones de referencia: cópialo a tu carpeta, móntalo con FFmpeg o HyperFrames y publica el resultado con publicar_borrador. Si hay un guion o un brief, respétalo.',
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
    ? 'La persona marcó "Enséñame el guion antes de crear el video": haz los pasos 1–4 (cortes, gancho y el plan de dirección completo con dirigir_edicion) pero NO renderices ni publiques. Termina explicándole en pocas líneas qué propones (estilo, música, ideas visuales) para que lo revise.'
    : 'Haz todos los pasos, renderiza y revisa (y corrige) antes de contestar.';
  const instrucciones = `Esta es una edición nueva: el audio ya está transcrito y nadie ha decidido nada todavía. Haz la edición completa según el pedido de la persona, dirigiendo tú cada detalle (si el audio es una canción en vez de voz, no añadas música).

${EDITOR_FIRST_PASS}

${final}

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
