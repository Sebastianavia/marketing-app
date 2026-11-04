import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';
import { recordUsage } from '@/lib/usage/usage-store';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { ClaudeCodeError, acquireClaudeSlot, childEnv, execClaude, type ToolUseEvent } from '@/lib/ai/claude-code/bridge';
import { CLAUDE_SUBSCRIPTION_MODEL } from '@/config/llm-models';
import { EditError, getEdit, updateEdit } from './edit-store';
import { fontsDir } from './media';
import { findPython, modelsDir } from './python-env';
import type { ClaudeChatMessage, ClaudeChatStep, EditProject } from './types';

/**
 * Claude como editor de una edición (chat "Claude" en la pantalla de Edición).
 *
 * Se lanza Claude Code con la suscripción de la persona, con la carpeta de la edición como
 * carpeta de trabajo y:
 *  - Herramientas de Lulo por MCP (ver_edicion, cambiar_perfil, cambiar_guion, renderizar,
 *    publicar_borrador…), todas de $0 y atadas a ESTA edición.
 *  - Bash, Read/Write/Edit, Glob/Grep, WebSearch/WebFetch: puede usar FFmpeg, Python, descargar
 *    e instalar herramientas en <datos>/claude-herramientas y hacer lo que el motor no hace.
 *
 * Aislamiento (macOS y Linux, sandbox de Claude Code):
 *  - Bash solo escribe en la carpeta de la edición, la de herramientas y temporales.
 *  - Bash no lee el resto de la carpeta personal (claves, .env.local, token del Director…).
 *  - Red solo a dominios de descargas (PyPI, GitHub, Hugging Face, npm…); localhost bloqueado,
 *    así que no puede llamar a la API de la app ni aprobar gastos.
 *  - El entorno no lleva ninguna clave (lista blanca en bridge.ts).
 * En Windows nativo el sandbox no existe: Bash queda desactivado salvo que se active
 * LULO_CLAUDE_BASH_SIN_AISLAMIENTO=1 (bajo tu responsabilidad).
 */

export type SandboxMode = 'aislado' | 'sin_aislamiento' | 'sin_bash';

export function sandboxMode(): SandboxMode {
  if (process.platform === 'darwin' || process.platform === 'linux') return 'aislado';
  return process.env.LULO_CLAUDE_BASH_SIN_AISLAMIENTO === '1' ? 'sin_aislamiento' : 'sin_bash';
}

/** Dominios a los que Bash puede conectarse para descargar herramientas y recursos. */
const BASE_DOMAINS = [
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'huggingface.co',
  '*.huggingface.co',
  '*.hf.co',
  'download.pytorch.org',
  'registry.npmjs.org',
  '*.npmjs.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ffmpeg.org',
  '*.ffmpeg.org',
  'evermeet.cx',
  'www.gyan.dev',
  'johnvansickle.com',
];

function allowedDomains(): string[] {
  const extra = (process.env.LULO_CLAUDE_DOMINIOS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  return [...new Set([...BASE_DOMAINS, ...extra])];
}

// ---------------------------------------------------------------------------
// Turnos en curso (en memoria; el historial queda en la edición)
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'paso'; id: string; herramienta: string; detalle: string }
  | { tipo: 'resultado_paso'; id: string; error: boolean; resumen: string }
  | { tipo: 'fin'; mensaje: ClaudeChatMessage }
  | { tipo: 'error'; mensaje: string; codigo?: string };

interface Turn {
  id: string;
  editId: string;
  events: AgentEvent[];
  done: boolean;
  abort: AbortController;
  listeners: Set<() => void>;
}

const g = globalThis as unknown as { __luloEditorTurns?: Map<string, Turn> };
const turns = (g.__luloEditorTurns ??= new Map<string, Turn>());

function emit(turn: Turn, e: AgentEvent) {
  turn.events.push(e);
  for (const l of turn.listeners) l();
}

export function getTurn(editId: string): Turn | undefined {
  return turns.get(editId);
}

export function isTurnActive(editId: string): boolean {
  const t = turns.get(editId);
  return !!t && !t.done;
}

export function stopTurn(editId: string): boolean {
  const t = turns.get(editId);
  if (!t || t.done) return false;
  t.abort.abort();
  return true;
}

/** Lee los eventos desde `from` y espera los siguientes hasta que el turno termine. */
export async function* followTurn(editId: string, from = 0): AsyncGenerator<AgentEvent> {
  const t = turns.get(editId);
  if (!t) return;
  let i = from;
  for (;;) {
    while (i < t.events.length) yield t.events[i++];
    if (t.done) return;
    await new Promise<void>((resolve) => {
      const l = () => {
        t.listeners.delete(l);
        resolve();
      };
      t.listeners.add(l);
    });
  }
}

// ---------------------------------------------------------------------------
// Configuración de cada sesión
// ---------------------------------------------------------------------------

async function toolsDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ getDataDir(), 'claude-herramientas');
  await Promise.all(
    ['bin', 'py', 'cache', 'descargas'].map((s) => fsp.mkdir(path.join(/*turbopackIgnore: true*/ d, s), { recursive: true })),
  );
  return d;
}

function describeStep(e: ToolUseEvent): ClaudeChatStep {
  const i = e.input;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const base = (v: unknown) => path.basename(str(v));
  let detalle = '';
  switch (e.name) {
    case 'Bash':
      detalle = str(i.description) || str(i.command).slice(0, 160);
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
      detalle = base(i.file_path);
      break;
    case 'Glob':
    case 'Grep':
      detalle = str(i.pattern);
      break;
    case 'WebFetch':
      detalle = str(i.url);
      break;
    case 'WebSearch':
      detalle = str(i.query);
      break;
    default:
      detalle = '';
  }
  const herramienta = e.name.startsWith('mcp__lulo-editor__') ? e.name.replace('mcp__lulo-editor__', 'lulo: ') : e.name;
  return { herramienta, detalle };
}

function systemPrompt(
  p: EditProject,
  ctx: {
    tools: string;
    ffmpeg: string;
    python: string | null;
    fuentes: string;
    modelos: string;
    mode: SandboxMode;
  },
) {
  const bash =
    ctx.mode === 'sin_bash'
      ? '- En este PC (Windows) Bash está desactivado: trabaja solo con las herramientas de Lulo y los archivos de la carpeta. Si algo exige ejecutar programas, explícale a la persona que debe activarlo.'
      : `- Puedes usar Bash: FFmpeg completo en \`${ctx.ffmpeg}\`${ctx.python ? `, Python en \`${ctx.python}\`` : ''}. Para instalar algo usa SOLO la carpeta de herramientas \`${ctx.tools}\` (p. ej. \`pip install --target "${path.join(ctx.tools, 'py')}" paquete\`, binarios en \`${path.join(ctx.tools, 'bin')}\`, descargas en \`${path.join(ctx.tools, 'descargas')}\`). Ya está en PATH y PYTHONPATH.
- La red solo deja descargar de: ${allowedDomains().join(', ')}. Si necesitas otro sitio, dilo a la persona (puede añadirlo en LULO_CLAUDE_DOMINIOS).${ctx.mode === 'aislado' ? '\n- Bash corre aislado: solo escribe en la carpeta de la edición, la de herramientas y temporales; no puede leer el resto de la carpeta personal ni conectarse a localhost.' : ''}`;
  return `Eres el editor de video de Lulo Studio y trabajas para una persona de marketing que NO es técnica. Edita su video exactamente como lo pide.

EDICIÓN: "${p.titulo}"
Carpeta de trabajo (tu cwd): ${p.carpeta}
Video original: ${p.original.archivo} (${p.original.duracion.toFixed(1)} s, ${p.original.ancho}x${p.original.alto}). NUNCA lo modifiques ni lo borres.
Fuentes instaladas para subtítulos: ${ctx.fuentes}
Modelos descargados (recorte de persona, etc.): ${ctx.modelos}

CÓMO TRABAJAR
1. Empieza con lulo: ver_edicion para conocer el perfil, las frases y el borrador actual.
2. Si el pedido se puede hacer con el motor de la app (subtítulos, colores, fuente, posición, gancho, cortes, zoom, música, gráficos, formato), usa cambiar_perfil / cambiar_guion y luego renderizar. Es lo más fiable.
3. Si el motor no lo hace (efectos especiales, b-roll, transiciones, cambiar fondo, velocidad, superponer imágenes, color grading, lo que sea), hazlo tú con FFmpeg, Python u otra herramienta que instales, trabajando sobre el borrador actual o el original. Guarda tu resultado como MP4 (H.264 + AAC, mismo formato vertical) dentro de la carpeta, en una subcarpeta \`claude/\`, y usa lulo: publicar_borrador para que la persona lo vea en la app.
4. Comprueba tu resultado antes de publicarlo (duración, que tenga audio, que se vea bien): extrae fotogramas con FFmpeg a \`./claude/fotogramas/\` y míralos con Read. No uses /tmp ni otras carpetas: fuera de la carpeta de la edición no puedes leer.
5. No pidas permiso para cada paso: decide tú. Pregunta solo si el pedido es ambiguo de verdad.

REGLAS
- No gastas dinero: no tienes herramientas de pago. Si algo requiere un proveedor de pago (voz nueva, video generado), explícalo y deja que la persona lo haga desde la app.
- Aprobar la edición es solo de la persona, en la app.
${bash}

RESPUESTA
Contesta en español, corto y claro (sin jerga técnica): qué hiciste, qué versión quedó en la app y qué podría ajustarse. Si algo no se pudo, dilo con honestidad y propone una alternativa.`;
}

function agentSettings(p: EditProject, dirs: { tools: string; fuentes: string; modelos: string }, mode: SandboxMode) {
  const original = path.join(/*turbopackIgnore: true*/ p.carpeta, p.original.archivo);
  const settings: Record<string, unknown> = {
    permissions: {
      deny: [`Edit(./${p.original.archivo})`, `Write(./${p.original.archivo})`],
    },
  };
  if (mode === 'aislado') {
    settings.sandbox = {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: [p.carpeta, dirs.tools],
        denyWrite: [original],
        denyRead: ['~/'],
        allowRead: [p.carpeta, dirs.tools, dirs.fuentes, dirs.modelos],
      },
      network: { allowedDomains: allowedDomains(), allowLocalBinding: false },
    };
  }
  return settings;
}

function allowedTools(dirs: { tools: string; fuentes: string; modelos: string }, mode: SandboxMode): string[] {
  const abs = (d: string) => `//${d.replace(/^\/+/, '')}/**`;
  const list = [
    'Read(./**)',
    'Write(./**)',
    'Edit(./**)',
    `Read(${abs(dirs.tools)})`,
    `Write(${abs(dirs.tools)})`,
    `Edit(${abs(dirs.tools)})`,
    `Read(${abs(dirs.fuentes)})`,
    `Read(${abs(dirs.modelos)})`,
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    'mcp__lulo-editor__*',
  ];
  if (mode !== 'sin_bash') list.push('Bash');
  return list;
}

// ---------------------------------------------------------------------------
// Enviar un mensaje
// ---------------------------------------------------------------------------

export async function sendToClaude(editId: string, mensaje: string, appUrl: string): Promise<{ turnoId: string }> {
  const texto = mensaje.trim();
  if (!texto) throw new EditError('Escribe qué quieres que haga Claude.');
  if (isTurnActive(editId)) throw new EditError('Claude ya está trabajando en esta edición. Espera o detenlo.', 409);
  const p = await getEdit(editId);

  const userMsg: ClaudeChatMessage = {
    id: randomUUID(),
    rol: 'usuario',
    texto,
    fecha: new Date().toISOString(),
  };
  // La sesión solo se guarda cuando Claude Code la crea de verdad (al terminar el turno)
  const sessionId = p.claude?.sessionId ?? randomUUID();
  const resume = Boolean(p.claude?.sessionId);
  await updateEdit(editId, (x) => {
    x.claude = {
      sessionId: x.claude?.sessionId,
      mensajes: [...(x.claude?.mensajes ?? []), userMsg].slice(-60),
    };
  });

  const turn: Turn = {
    id: randomUUID(),
    editId,
    events: [],
    done: false,
    abort: new AbortController(),
    listeners: new Set(),
  };
  turns.set(editId, turn);
  // runTurn nunca lanza: todo error termina el turno con un evento 'error'
  void runTurn(turn, p, texto, { sessionId, resume, appUrl }).catch((err) => console.error('[claude-editor]', err));
  return { turnoId: turn.id };
}

async function runTurn(turn: Turn, p: EditProject, texto: string, o: { sessionId: string; resume: boolean; appUrl: string }) {
  let release: () => void = () => {};
  const started = Date.now();
  const steps = new Map<string, ClaudeChatStep>();
  let streamed = '';
  let session = { id: o.sessionId, resume: o.resume };
  try {
    release = await acquireClaudeSlot();
    const mode = sandboxMode();
    const dirs = {
      tools: await toolsDir(),
      fuentes: await fontsDir(),
      modelos: await modelsDir(),
    };
    const ffmpegBin = resolveFfmpegPath();
    const py = await findPython().catch(() => null);
    const pyCmd = py ? [py.cmd, ...py.args].join(' ') : null;

    const workDir = path.join(/*turbopackIgnore: true*/ p.carpeta, 'claude');
    await fsp.mkdir(workDir, { recursive: true });
    const systemFile = path.join(/*turbopackIgnore: true*/ workDir, '.sistema.txt');
    await fsp.writeFile(systemFile, systemPrompt(p, { ...dirs, ffmpeg: ffmpegBin, python: pyCmd, mode }), 'utf8');

    const mcpConfig = {
      mcpServers: {
        'lulo-editor': {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(/*turbopackIgnore: true*/ process.cwd(), 'mcp', 'lulo-mcp.mjs')],
          env: {
            LULO_APP_URL: o.appUrl,
            LULO_TOOLSET: 'editor',
            LULO_EDIT_ID: p.id,
            LULO_DATA_DIR: getDataDir(),
          },
        },
      },
    };

    const model = process.env.CLAUDE_CODE_MODEL?.trim() || CLAUDE_SUBSCRIPTION_MODEL;
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      model,
      '--system-prompt-file',
      systemFile,
      '--mcp-config',
      JSON.stringify(mcpConfig),
      '--strict-mcp-config',
      '--settings',
      JSON.stringify(agentSettings(p, dirs, mode)),
      '--setting-sources',
      'local',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      ...allowedTools(dirs, mode),
      '--tools',
      [...(mode === 'sin_bash' ? [] : ['Bash']), 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].join(','),
    ];
    const sessionArgs = () => (session.resume ? ['--resume', session.id] : ['--session-id', session.id]);

    const ffmpegDir = path.isAbsolute(ffmpegBin) ? path.dirname(ffmpegBin) : '';
    const env = childEnv({
      PATH: [path.join(dirs.tools, 'bin'), ffmpegDir, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
      PYTHONPATH: path.join(dirs.tools, 'py'),
      PIP_CACHE_DIR: path.join(dirs.tools, 'cache', 'pip'),
      HF_HOME: path.join(dirs.tools, 'cache', 'huggingface'),
      XDG_CACHE_HOME: path.join(dirs.tools, 'cache'),
      TORCH_HOME: path.join(dirs.tools, 'cache', 'torch'),
      LULO_HERRAMIENTAS: dirs.tools,
    });

    const exec = (stdin: string) =>
      execClaude({
        args: [...args, ...sessionArgs()],
        cwd: p.carpeta,
        stdin,
        env,
        signal: turn.abort.signal,
        timeoutMs: 40 * 60_000,
        defaultModel: model,
        onText: (delta) => {
          streamed += delta;
          emit(turn, { tipo: 'texto', delta });
        },
        onToolUse: (e) => {
          const step = describeStep(e);
          steps.set(e.id, step);
          // Separa el texto de antes y después de cada paso
          if (streamed && !streamed.endsWith('\n\n')) {
            streamed += '\n\n';
            emit(turn, { tipo: 'texto', delta: '\n\n' });
          }
          emit(turn, {
            tipo: 'paso',
            id: e.id,
            herramienta: step.herramienta,
            detalle: step.detalle,
          });
        },
        onToolResult: (e) => {
          const step = steps.get(e.id);
          if (step && e.isError) step.error = e.text.slice(0, 300);
          emit(turn, {
            tipo: 'resultado_paso',
            id: e.id,
            error: e.isError,
            resumen: e.text.slice(0, 300),
          });
        },
      });

    let r;
    try {
      r = await exec(texto);
    } catch (err) {
      // La conversación anterior ya no existe (se borró o venía de otro PC): se empieza una nueva
      if (!session.resume || !/No conversation found/i.test(errorMessage(err, ''))) throw err;
      session = { id: randomUUID(), resume: false };
      r = await exec(`(La conversación anterior se perdió: empieza mirando la edición con ver_edicion.)\n\n${texto}`);
    }

    const tokens = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens + r.usage.outputTokens;
    await recordUsage({
      tool: 'video-editor',
      kind: 'script',
      provider: 'claude-code',
      model: r.model,
      description: `Claude editor · "${p.titulo}" · suscripción (≈ $${r.equivalentCostUSD.toFixed(4)} por API)`,
      units: tokens || 1,
      unit: tokens ? 'tokens' : 'texto',
      costUSD: 0,
      estimated: false,
    }).catch(() => undefined);

    const msg: ClaudeChatMessage = {
      id: randomUUID(),
      rol: 'claude',
      texto: (streamed.trim() || r.text).trim(),
      fecha: new Date().toISOString(),
      pasos: [...steps.values()],
      denegados: r.denied.map(
        (d) =>
          `${d.tool}${d.input && typeof d.input === 'object' && 'file_path' in d.input ? `: ${String((d.input as { file_path?: string }).file_path)}` : ''}`,
      ),
      duracionSeg: Math.round((Date.now() - started) / 1000),
    };
    await updateEdit(p.id, (x) => {
      x.claude = {
        sessionId: r.sessionId ?? session.id,
        mensajes: [...(x.claude?.mensajes ?? []), msg].slice(-60),
      };
    });
    emit(turn, { tipo: 'fin', mensaje: msg });
  } catch (err) {
    const cancelled = turn.abort.signal.aborted;
    const mensaje = cancelled ? 'Detuviste a Claude.' : errorMessage(err, 'Claude no pudo terminar.');
    const codigo = err instanceof ClaudeCodeError ? err.reason : undefined;
    const msg: ClaudeChatMessage = {
      id: randomUUID(),
      rol: 'claude',
      texto: [streamed.trim(), `⚠️ ${mensaje}`].filter(Boolean).join('\n\n'),
      fecha: new Date().toISOString(),
      pasos: [...steps.values()],
      error: true,
      duracionSeg: Math.round((Date.now() - started) / 1000),
    };
    await updateEdit(p.id, (x) => {
      // Si la sesión nunca llegó a crearse, la próxima vez se empieza una nueva
      const keep = session.resume || steps.size > 0 || streamed.length > 0;
      x.claude = {
        sessionId: keep ? session.id : x.claude?.sessionId,
        mensajes: [...(x.claude?.mensajes ?? []), msg].slice(-60),
      };
    }).catch(() => undefined);
    emit(turn, { tipo: 'error', mensaje, codigo });
  } finally {
    release();
    turn.done = true;
    for (const l of turn.listeners) l();
    // El turno terminado se queda un rato para quien se reconecte
    setTimeout(() => {
      if (turns.get(turn.editId) === turn) turns.delete(turn.editId);
    }, 10 * 60_000);
  }
}

/** Empieza una conversación nueva (Claude olvida lo hablado; el historial visible se borra). */
export async function resetClaudeChat(editId: string): Promise<void> {
  if (isTurnActive(editId)) throw new EditError('Claude está trabajando. Detenlo primero.', 409);
  await updateEdit(editId, (x) => {
    x.claude = { mensajes: [] };
  });
}
