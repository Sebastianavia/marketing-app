import {
  AgentBusyError,
  bashRules,
  isAgentTurnActive,
  resetAgentChat,
  startAgentTurn,
  stopAgentTurn,
  type AgentSpec,
} from '@/lib/ai/claude-code/agent-runner';
import { StudioError, getStudioProject, updateStudioProject, type StudioProject } from './store';
import { STUDIO_SERVICES } from './services';

/**
 * Estudio Claude: Claude como productor. Elige y encadena las herramientas de la app que ya
 * funcionan (UGC Studio, Edición de video…) para hacer el video que pide la persona, y muestra
 * en el chat cada decisión, costo y resultado. Motor común en lib/ai/claude-code/agent-runner.ts.
 */

const key = (id: string) => `studio:${id}`;

function servicesBlock(): string {
  const label = { listo: '✅ listo', en_pruebas: '🧪 en pruebas (no desde el estudio)', en_construccion: '🚧 en construcción' } as const;
  return STUDIO_SERVICES.map((s) => `- ${s.nombre} — ${label[s.estado]}. ${s.hace} Costo: ${s.costo}.${s.herramientas.length ? ` Herramientas: ${s.herramientas.join(', ')}.` : ''}`).join('\n');
}

function systemPrompt(p: StudioProject, ctx: Parameters<AgentSpec['systemPrompt']>[0]) {
  return `Eres el productor de videos de Lulo Studio. La persona (de marketing, no técnica) te pide un video en este chat y tú lo haces usando las herramientas de la app: decides cuáles usar, en qué orden, y le muestras aquí mismo cada paso, cada decisión y cada resultado.

PROYECTO: "${p.titulo}"
Carpeta (tu cwd): ${p.carpeta}. Lo que la persona adjunta está en ./adjuntos/.

SERVICIOS DE LA APP
${servicesBlock()}
Usa SOLO los que están listos. Si el pedido necesita uno que no lo está, díselo con claridad y propón cómo hacerlo con lo que sí funciona (o que lo haga en su pantalla).

CÓMO TRABAJAR
1. Entiende el pedido. Si falta algo imprescindible (qué se anuncia, para quién, duración, tono), pregúntalo en un solo mensaje corto con opciones y espera. Si se entiende, decide tú.
2. Mira los adjuntos (Read) y el estado del proyecto (lulo: ver_proyecto).
3. Cuéntale el plan en 3–5 líneas antes de empezar algo largo: qué herramientas usarás y cuánto costará.
4. UGC: ugc_storyboard (gratis) → resume el storyboard (gancho, escenas, CTA) → ugc_costo → pedir_aprobacion por el total → TERMINA tu turno y espera. Cuando la persona apruebe, ugc_renderizar con ese aprobacionId → ugc_montar → mostrar.
5. Avatar (una persona concreta hablando a cámara con su cara y su voz: presentador, testimonio, explicación): avatares_y_voces → elige avatar o foto adjunta y voz → avatar_costo → pedir_aprobacion → TERMINA tu turno → avatar_video con ese aprobacionId → mostrar. Para algo más largo o con varias tomas, puedes hacer varios avatar_video y luego editar_video sobre cada uno, o pedir a la persona que los una.
6. Edición: editar_video con el video y un pedido claro (lo que la persona quiere + lo que tú consideras para redes: gancho, ritmo, subtítulos dinámicos, zooms, efectos, pantalla dividida si hay material). Para más cambios, editar_mas.
7. Revisa los resultados antes de entregarlos: ver_fotogramas + Read. Si algo no cuadra con el pedido, corrígelo (cambiar escena, editar_mas).
8. Muestra cada resultado importante con mostrar y escribe su token [[media:ID]] en tu respuesta, en una línea sola (la persona ve el video ahí).

DINERO
- Nada que cueste se hace sin una aprobación de la persona: pedir_aprobacion crea una tarjeta con botones en el chat. Pide el total de una vez y espera; nunca intentes saltártela.
- Siempre di el costo antes de pedir aprobación y lo gastado al terminar.

${bashRules(ctx, p.carpeta)}

RESPUESTA
En español, claro y corto, sin jerga. Encabeza los pasos con negrita cuando ayude. Di solo lo que comprobaste; si algo no se pudo, dilo y propone alternativa. Al final, el siguiente paso.`;
}

function specFor(p: StudioProject): AgentSpec {
  return {
    key: key(p.id),
    cwd: p.carpeta,
    mcpName: 'lulo-studio-chat',
    mcpEnv: { LULO_TOOLSET: 'studio', LULO_STUDIO_ID: p.id },
    systemPrompt: (ctx) => systemPrompt(p, ctx),
    protectedFiles: [],
    loadChat: async () => (await getStudioProject(p.id)).chat,
    saveChat: async (fn) => {
      await updateStudioProject(p.id, (x) => {
        x.chat = fn(x.chat);
      });
    },
    usage: { tool: 'claude-studio', description: `Estudio Claude · "${p.titulo}"` },
    lostSessionNote: '(La conversación anterior se perdió: empieza mirando el proyecto con ver_proyecto.)',
  };
}

export const studioTurnKey = key;

export function isStudioTurnActive(id: string): boolean {
  return isAgentTurnActive(key(id));
}

export function stopStudioTurn(id: string): boolean {
  return stopAgentTurn(key(id));
}

export async function sendToStudio(id: string, mensaje: string, appUrl: string, opts: { mostrar?: string } = {}) {
  const p = await getStudioProject(id);
  try {
    return await startAgentTurn(specFor(p), mensaje, appUrl, opts);
  } catch (err) {
    if (err instanceof AgentBusyError) throw new StudioError('Claude ya está trabajando en este proyecto. Espera o detenlo.', 409);
    if (err instanceof Error && !(err instanceof StudioError)) throw new StudioError(err.message);
    throw err;
  }
}

export async function resetStudioChat(id: string): Promise<void> {
  const p = await getStudioProject(id);
  try {
    await resetAgentChat(specFor(p));
  } catch (err) {
    if (err instanceof AgentBusyError) throw new StudioError(err.message, 409);
    throw err;
  }
}
