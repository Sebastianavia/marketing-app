import fsp from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from '@/lib/data/data-dir';
import { getStorageBasePath } from '@/lib/storage/project-storage';
import { errorMessage } from '@/lib/errors';
import { recordUsage } from '@/lib/usage/usage-store';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { fontsDir } from '@/lib/editor/media';
import { findPython, modelsDir } from '@/lib/editor/python-env';
import { CLAUDE_SUBSCRIPTION_MODEL } from '@/config/llm-models';
import { ensureVideoSkillsPlugin, videoSkillsPrompt } from './video-skills';
import { materialPrompt, usableMaterialFolder } from '@/lib/material/material';
import { ClaudeCodeError, acquireClaudeSlot, childEnv, execClaude, type ToolUseEvent } from './bridge';
import type { AgentEvent, ClaudeChatMessage, ClaudeChatState, ClaudeChatStep, SandboxMode } from './agent-types';

/**
 * Motor común de "Claude como agente" dentro de la app (editor de video, Director…).
 *
 * Lanza Claude Code con la suscripción de la persona, con una carpeta del proyecto como cwd y:
 *  - Herramientas de Lulo por MCP (frontend/mcp/lulo-mcp.mjs con un LULO_TOOLSET), atadas al proyecto.
 *  - Bash, Read/Write/Edit, Glob/Grep, WebSearch/WebFetch para lo que las herramientas no cubren.
 *
 * Aislamiento (macOS y Linux, sandbox de Claude Code):
 *  - Bash solo escribe en la carpeta del proyecto, la de herramientas y temporales.
 *  - Bash no lee el resto de la carpeta personal (claves, .env.local, token del Director…).
 *  - Red solo a dominios de descargas; localhost bloqueado (no puede llamar a la API ni aprobar).
 *  - Los archivos protegidos del proyecto no se pueden escribir.
 *  - El entorno no lleva ninguna clave (lista blanca en bridge.ts).
 * En Windows nativo el sandbox no existe: por decisión del dueño (2026-11-04) Bash corre con todos
 * los permisos del usuario; LULO_CLAUDE_BASH_SIN_AISLAMIENTO=0 lo apaga. Sin sandbox un comando
 * sí podría leer .env.local o llamar a localhost.
 */

export type { AgentEvent, SandboxMode } from './agent-types';

export function sandboxMode(): SandboxMode {
  if (process.platform === 'darwin' || process.platform === 'linux') return 'aislado';
  return process.env.LULO_CLAUDE_BASH_SIN_AISLAMIENTO === '0' ? 'sin_bash' : 'sin_aislamiento';
}

/**
 * Red de Bash en el sandbox: toda internet ('*'), a petición del dueño (2026-11-10). Localhost sigue
 * bloqueado por el sandbox (probado: example.com 200, localhost:3000 sin conexión), así Claude no
 * puede llamar a la app para aprobarse gastos. LULO_CLAUDE_DOMINIOS (lista con comas) la restringe.
 */
export function allowedDomains(): string[] {
  const only = (process.env.LULO_CLAUDE_DOMINIOS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  return only.length ? only : ['*'];
}

/** Secretos que ningún Claude de la app lee (ni con Read ni con Bash en el sandbox). */
function secretPaths(): string[] {
  const h = os.homedir();
  const j = (...x: string[]) => path.join(/*turbopackIgnore: true*/ h, ...x);
  const list = [
    j('.ssh'), j('.aws'), j('.gnupg'), j('.config', 'gh'), j('.netrc'), j('.docker'), j('.kube'), j('.npmrc'), j('.pypirc'),
    j('.claude', '.credentials.json'),
    path.join(/*turbopackIgnore: true*/ getDataDir(), 'director-token'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '.env.local'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '..', '.env'),
  ];
  if (process.platform === 'darwin') {
    list.push(
      j('Library', 'Keychains'),
      j('Library', 'Cookies'),
      j('Library', 'Application Support', 'Google'),
      j('Library', 'Application Support', 'BraveSoftware'),
      j('Library', 'Application Support', 'Firefox'),
      j('Library', 'Application Support', 'Microsoft Edge')
    );
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? j('AppData', 'Local');
    const roaming = process.env.APPDATA ?? j('AppData', 'Roaming');
    list.push(path.join(local, 'Google'), path.join(local, 'BraveSoftware'), path.join(local, 'Microsoft', 'Edge'), path.join(roaming, 'Mozilla'), path.join(roaming, 'Microsoft', 'Credentials'), path.join(local, 'Microsoft', 'Credentials'));
  } else {
    list.push(j('.config', 'google-chrome'), j('.mozilla'));
  }
  return list;
}

/** URL de la app para el servidor MCP cuando no hay una petición de la que sacarla (runners). */
export function defaultAppUrl(): string {
  return `http://localhost:${process.env.PORT || '3000'}`;
}

/** Lo que el prompt de sistema puede contar a Claude sobre este PC. */
export interface AgentContext {
  mode: SandboxMode;
  tools: string;
  ffmpeg: string;
  python: string | null;
  fuentes: string;
  modelos: string;
  domains: string[];
  /** Carpetas donde puede crear y cambiar archivos. */
  escribir: string[];
}

/** Bloque común del prompt: qué puede ejecutar Claude y dónde. */
export function bashRules(ctx: AgentContext, carpeta: string): string {
  if (ctx.mode === 'sin_bash') {
    return '- Bash está desactivado en este PC: trabaja con las herramientas de Lulo y los archivos de la carpeta. Si algo exige ejecutar programas, explícale a la persona que debe activarlo.';
  }
  const red = ctx.domains.includes('*')
    ? 'Tienes acceso a toda internet (fuentes, imágenes libres, música sin copyright, paquetes, lo que necesites).'
    : `La red solo deja descargar de: ${ctx.domains.join(', ')}.`;
  return `- Puedes usar Bash con libertad: FFmpeg completo en \`${ctx.ffmpeg}\`${ctx.python ? `, Python en \`${ctx.python}\`` : ''}. Para instalar programas usa la carpeta de herramientas \`${ctx.tools}\` (p. ej. \`pip install --target "${path.join(ctx.tools, 'py')}" paquete\`, binarios en \`${path.join(ctx.tools, 'bin')}\`, descargas en \`${path.join(ctx.tools, 'descargas')}\`); ya está en PATH y PYTHONPATH.
- Tu carpeta de trabajo es ${carpeta} (subcarpeta \`claude/\` para tus archivos). Puedes LEER cualquier carpeta del equipo (salvo credenciales y claves) y ESCRIBIR en: ${ctx.escribir.join(' · ')}. No borres ni sobrescribas originales de la persona: crea archivos nuevos.
- ${red} Lo único bloqueado es la propia app (localhost) y los secretos.`;
}

export interface AgentSpec {
  /** Clave del turno: un solo turno a la vez por proyecto ('edit:<id>', 'director:<id>'). */
  key: string;
  /** Carpeta del proyecto: cwd de Claude. */
  cwd: string;
  /** Nombre del servidor MCP (las herramientas aparecen como mcp__<nombre>__*). */
  mcpName: string;
  /** Variables para lulo-mcp.mjs (LULO_TOOLSET y el id del proyecto). */
  mcpEnv: Record<string, string>;
  systemPrompt: (ctx: AgentContext) => string;
  /** Nombres de archivo dentro de cwd que Claude no puede escribir (originales, estado de la app). */
  protectedFiles: string[];
  loadChat: () => Promise<ClaudeChatState | undefined>;
  saveChat: (fn: (current: ClaudeChatState | undefined) => ClaudeChatState) => Promise<void>;
  usage: { tool: string; description: string };
  /** Se antepone al mensaje si la sesión anterior se perdió. */
  lostSessionNote: string;
  /**
   * Skills de video (plugin lulo-video, ver video-skills.ts). `renderTool`: herramienta MCP que
   * renderiza HyperFrames (null = este agente no renderiza); `entregar`: cómo se entrega el video.
   */
  videoSkills?: { renderTool: string | null; entregar: string };
  /**
   * Carpeta de material (lib/material): si la persona eligió una para este proyecto (guardada con
   * la clave `key`), Claude la puede leer. `comoUsar`: cómo se usan sus archivos en esta herramienta.
   */
  material?: { comoUsar: string };
}

type AgentDirs = {
  tools: string;
  fuentes: string;
  modelos: string;
  skills: string | null;
  material: string | null;
  /** Carpeta de proyectos de Lulo (Claude puede escribir en toda ella). */
  proyectos: string | null;
};

/** Carpetas donde Claude escribe (la suya primero); las demás también van como --add-dir. */
function writableDirs(spec: AgentSpec, dirs: AgentDirs): string[] {
  return [...new Set([spec.cwd, dirs.tools, dirs.proyectos, dirs.material].filter((d): d is string => !!d))];
}

/** Cachés y temporales de npm, pip, HyperFrames, Chrome… (escritura en el sandbox). */
function cacheDirs(): string[] {
  const h = os.homedir();
  const list = [path.join(/*turbopackIgnore: true*/ h, '.cache'), path.join(/*turbopackIgnore: true*/ h, '.npm'), os.tmpdir()];
  if (process.platform === 'darwin') list.push(path.join(/*turbopackIgnore: true*/ h, 'Library', 'Caches'));
  return list;
}

// ---------------------------------------------------------------------------
// Turnos en curso (en memoria; el historial queda en el proyecto)
// ---------------------------------------------------------------------------

interface Turn {
  id: string;
  key: string;
  events: AgentEvent[];
  done: boolean;
  abort: AbortController;
  listeners: Set<() => void>;
}

const g = globalThis as unknown as { __luloAgentTurns?: Map<string, Turn> };
const turns = (g.__luloAgentTurns ??= new Map<string, Turn>());

function emit(turn: Turn, e: AgentEvent) {
  turn.events.push(e);
  for (const l of turn.listeners) l();
}

export function isAgentTurnActive(key: string): boolean {
  const t = turns.get(key);
  return !!t && !t.done;
}

export function stopAgentTurn(key: string): boolean {
  const t = turns.get(key);
  if (!t || t.done) return false;
  t.abort.abort();
  return true;
}

/** Lee los eventos desde `from` y espera los siguientes hasta que el turno termine. */
export async function* followAgentTurn(key: string, from = 0): AsyncGenerator<AgentEvent> {
  const t = turns.get(key);
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

/** Respuesta HTTP del GET de una ruta …/claude: estado o NDJSON del turno en curso. */
export function agentTurnResponse(key: string, from: number): Response {
  if (!isAgentTurnActive(key)) return Response.json({ activo: false, modo: sandboxMode() });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of followAgentTurn(key, from)) controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export class AgentBusyError extends Error {}

/** Empieza una conversación nueva (Claude olvida lo hablado; el historial visible se borra). */
export async function resetAgentChat(spec: Pick<AgentSpec, 'key' | 'saveChat'>): Promise<void> {
  if (isAgentTurnActive(spec.key)) throw new AgentBusyError('Claude está trabajando. Detenlo primero.');
  await spec.saveChat(() => ({ mensajes: [] }));
}

// ---------------------------------------------------------------------------
// Configuración de cada sesión
// ---------------------------------------------------------------------------

async function toolsDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ getDataDir(), 'claude-herramientas');
  await Promise.all(['bin', 'py', 'cache', 'descargas'].map((s) => fsp.mkdir(path.join(/*turbopackIgnore: true*/ d, s), { recursive: true })));
  return d;
}

function describeStep(e: ToolUseEvent): ClaudeChatStep {
  const i = e.input;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  let detalle = '';
  switch (e.name) {
    case 'Bash':
      detalle = str(i.description) || str(i.command).slice(0, 160);
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
      detalle = path.basename(str(i.file_path));
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
    case 'Skill':
      detalle = str(i.skill) || str(i.command) || str(i.name);
      break;
  }
  const m = /^mcp__lulo-[a-z-]+__(.+)$/.exec(e.name);
  return { herramienta: m ? `lulo: ${m[1]}` : e.name, detalle };
}

/** Comandos y archivos que ningún Claude de la app puede tocar (además de lo que impida el sandbox). */
const AGENT_DENY = [
  'Bash(*approve*)',
  'Bash(*approvals*)',
  'Bash(*reject*)',
  'Bash(*director-token*)',
  'Bash(*.env.local*)',
  'Bash(*localhost:3000*)',
  'Bash(*127.0.0.1:3000*)',
  'Read(**/.env.local)',
  'Read(**/.env)',
  'Read(**/director-token)',
  // Estado de la app (lo cambian sus herramientas, no a mano)
  'Edit(**/produccion.json)',
  'Edit(**/project-metadata.json)',
  'WebFetch(domain:localhost)',
  'WebFetch(domain:127.0.0.1)',
  // Su propia configuración (se reescribe en cada turno, pero mejor que no la toque)
  'Edit(./claude/.ajustes.json)',
  'Edit(./claude/.mcp.json)',
  'Edit(./claude/.sistema.txt)',
];

/**
 * Ruta absoluta en el formato de las reglas de permisos de Claude Code ("//ruta"). En Windows
 * Claude Code compara rutas en forma POSIX: C:\\Users\\ana → /c/Users/ana.
 */
function rulePath(p: string): string {
  if (process.platform === 'win32') {
    const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
    if (m) return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
    return p.replace(/\\/g, '/');
  }
  return p.replace(/\/+$/, '');
}

function sandboxSettings(spec: AgentSpec, dirs: AgentDirs, mode: SandboxMode) {
  const settings: Record<string, unknown> = {
    permissions: {
      deny: [
        // Edit cubre todas las escrituras de archivos (Claude Code avisa de que Write(...) no se usa)
        ...spec.protectedFiles.map((f) => `Edit(./${f})`),
        // Aprobar gastos es solo de la persona en la app. En macOS/Linux el sandbox ya bloquea
        // localhost; en Windows (sin sandbox) esto evita que Claude se apruebe a sí mismo con un
        // comando o lea el token del Director o las claves.
        ...AGENT_DENY,
        ...secretPaths().flatMap((p) => [`Read(/${rulePath(p)})`, `Read(/${rulePath(p)}/**)`]),
        // Sin reglas de denegación sobre carpetas que Claude usa (material…): hacían que Claude Code
        // rechazara comandos compuestos que las mencionan (probado 2026-11-10).
      ],
    },
  };
  if (mode === 'aislado') {
    settings.sandbox = {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      // Libertad (pedido del dueño, 2026-11-10): lee todo el equipo salvo secretos y escribe en sus
      // carpetas de trabajo, la de proyectos, la de material, herramientas, cachés y temporales
      filesystem: {
        allowWrite: [...writableDirs(spec, dirs), ...cacheDirs()],
        denyWrite: spec.protectedFiles.map((f) => path.join(/*turbopackIgnore: true*/ spec.cwd, f)),
        denyRead: secretPaths(),
      },
      network: { allowedDomains: allowedDomains(), allowLocalBinding: false },
    };
  }
  return settings;
}

function allowedTools(spec: AgentSpec, dirs: AgentDirs, mode: SandboxMode): string[] {
  const abs = (d: string) => `/${rulePath(d)}/**`;
  const list = [
    // Leer: todo el equipo (los secretos están en deny)
    'Read',
    'Glob',
    'Grep',
    'Edit(./**)',
    ...writableDirs(spec, dirs)
      .filter((d) => d !== spec.cwd)
      .map((d) => `Edit(${abs(d)})`),
    'WebSearch',
    'WebFetch',
    `mcp__${spec.mcpName}__*`,
  ];
  if (mode !== 'sin_bash') list.push('Bash');
  if (dirs.skills) list.push('Skill');
  return list;
}

// ---------------------------------------------------------------------------
// Enviar un mensaje
// ---------------------------------------------------------------------------

export async function startAgentTurn(
  spec: AgentSpec,
  mensaje: string,
  appUrl: string,
  opts: { mostrar?: string } = {}
): Promise<{ turnoId: string }> {
  const texto = mensaje.trim();
  if (!texto) throw new Error('Escribe qué quieres que haga Claude.');
  if (isAgentTurnActive(spec.key)) throw new AgentBusyError('Claude ya está trabajando en esto. Espera o detenlo.');
  const chat = await spec.loadChat();

  const userMsg: ClaudeChatMessage = {
    id: randomUUID(),
    rol: 'usuario',
    // En el chat se ve lo que escribió la persona; Claude recibe además las instrucciones
    texto: opts.mostrar?.trim() || texto,
    fecha: new Date().toISOString(),
  };
  // La sesión solo se guarda cuando Claude Code la crea de verdad (al terminar el turno)
  const sessionId = chat?.sessionId ?? randomUUID();
  const resume = Boolean(chat?.sessionId);
  await spec.saveChat((c) => ({ sessionId: c?.sessionId, mensajes: [...(c?.mensajes ?? []), userMsg].slice(-60) }));

  const turn: Turn = { id: randomUUID(), key: spec.key, events: [], done: false, abort: new AbortController(), listeners: new Set() };
  turns.set(spec.key, turn);
  // runTurn nunca lanza: todo error termina el turno con un evento 'error'
  void runTurn(spec, turn, texto, { sessionId, resume, appUrl }).catch((err) => console.error('[claude-agente]', err));
  return { turnoId: turn.id };
}

async function runTurn(spec: AgentSpec, turn: Turn, texto: string, o: { sessionId: string; resume: boolean; appUrl: string }) {
  let release: () => void = () => {};
  const started = Date.now();
  const steps = new Map<string, ClaudeChatStep>();
  let streamed = '';
  let session = { id: o.sessionId, resume: o.resume };
  try {
    release = await acquireClaudeSlot();
    const mode = sandboxMode();
    const plugin = spec.videoSkills ? await ensureVideoSkillsPlugin() : null;
    // Se vuelve a validar en cada turno: la carpeta pudo borrarse o moverse
    const material = spec.material ? await usableMaterialFolder(spec.key) : null;
    const proyectos = await getStorageBasePath().catch(() => null);
    const dirs: AgentDirs = { tools: await toolsDir(), fuentes: await fontsDir(), modelos: await modelsDir(), skills: plugin ? path.dirname(plugin) : null, material, proyectos };
    const ffmpegBin = resolveFfmpegPath();
    const py = await findPython().catch(() => null);
    const ctx: AgentContext = {
      mode,
      ...dirs,
      ffmpeg: ffmpegBin,
      python: py ? [py.cmd, ...py.args].join(' ') : null,
      domains: allowedDomains(),
      escribir: writableDirs(spec, dirs),
    };

    const workDir = path.join(/*turbopackIgnore: true*/ spec.cwd, 'claude');
    await fsp.mkdir(workDir, { recursive: true });
    const systemFile = path.join(/*turbopackIgnore: true*/ workDir, '.sistema.txt');
    const systemPrompt =
      spec.systemPrompt(ctx) +
      (plugin && spec.videoSkills ? '\n' + videoSkillsPrompt(spec.videoSkills) : '') +
      (material && spec.material ? '\n' + (await materialPrompt(material, { puedeCopiar: mode !== 'sin_bash', comoUsar: spec.material.comoUsar })) : '');
    await fsp.writeFile(systemFile, systemPrompt, 'utf8');
    // Configuración en archivos y no en la línea de comandos: con claude.cmd (npm) Windows corta la
    // orden a 8191 caracteres

    const mcpConfig = {
      mcpServers: {
        [spec.mcpName]: {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(/*turbopackIgnore: true*/ process.cwd(), 'mcp', 'lulo-mcp.mjs')],
          env: { LULO_APP_URL: o.appUrl, LULO_DATA_DIR: getDataDir(), ...spec.mcpEnv },
        },
      },
    };

    const mcpFile = path.join(/*turbopackIgnore: true*/ workDir, '.mcp.json');
    const settingsFile = path.join(/*turbopackIgnore: true*/ workDir, '.ajustes.json');
    await fsp.writeFile(mcpFile, JSON.stringify(mcpConfig), 'utf8');
    await fsp.writeFile(settingsFile, JSON.stringify(sandboxSettings(spec, dirs, mode)), 'utf8');

    const model = process.env.CLAUDE_CODE_MODEL?.trim() || CLAUDE_SUBSCRIPTION_MODEL;
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      '--system-prompt-file', systemFile,
      '--mcp-config', mcpFile,
      '--strict-mcp-config',
      '--settings', settingsFile,
      '--setting-sources', 'local',
      '--permission-mode', 'dontAsk',
      '--allowedTools', ...allowedTools(spec, dirs, mode),
      '--tools', [...(mode === 'sin_bash' ? [] : ['Bash']), 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', ...(plugin ? ['Skill'] : [])].join(','),
      ...(plugin ? ['--plugin-dir', plugin] : []),
      // Sus carpetas de escritura como directorios de trabajo: así Claude Code no rechaza comandos
      // por usar rutas «de fuera» (pasaba con la carpeta de material)
      ...writableDirs(spec, dirs)
        .filter((d) => d !== spec.cwd)
        .flatMap((d) => ['--add-dir', d]),
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
      // Bash de verdad (no zsh): Claude escribe scripts de bash; en zsh `for t in $lista` no separa
      // la lista y sus comandos fallaban (visto 2026-11-10). En Windows ya usa Git Bash.
      ...(process.platform !== 'win32' && fsSync.existsSync('/bin/bash') ? { SHELL: '/bin/bash' } : {}),
      // npx (HyperFrames y otros) escribe su caché en la carpeta de herramientas: ~/.npm no se puede escribir
      npm_config_cache: path.join(dirs.tools, 'cache', 'npm'),
      PUPPETEER_CACHE_DIR: path.join(dirs.tools, 'cache', 'puppeteer'),
      HYPERFRAMES_NO_TELEMETRY: '1',
      HYPERFRAMES_SKIP_SKILLS: '1',
      // Herramientas largas (storyboard, render, edición): que Claude Code no las corte antes
      MCP_TOOL_TIMEOUT: String(40 * 60_000),
    });

    const exec = (stdin: string) =>
      execClaude({
        args: [...args, ...sessionArgs()],
        cwd: spec.cwd,
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
          emit(turn, { tipo: 'paso', id: e.id, herramienta: step.herramienta, detalle: step.detalle });
        },
        onToolResult: (e) => {
          const step = steps.get(e.id);
          if (step && e.isError) step.error = e.text.slice(0, 300);
          emit(turn, { tipo: 'resultado_paso', id: e.id, error: e.isError, resumen: e.text.slice(0, 300) });
        },
      });

    // Con --resume Claude Code conserva el prompt de sistema del primer mensaje: si la carpeta de
    // material se eligió o cambió después, esta línea es lo que le avisa
    const prefix = material
      ? `[Carpeta de material de este proyecto (no toques los originales): ${material}. Si el pedido usa material, revísala con Glob/Read antes de decidir.]\n\n`
      : '';
    let r;
    try {
      r = await exec(prefix + texto);
    } catch (err) {
      // La conversación anterior ya no existe (se borró o venía de otro PC): se empieza una nueva
      if (!session.resume || !/No conversation found/i.test(errorMessage(err, ''))) throw err;
      session = { id: randomUUID(), resume: false };
      r = await exec(`${spec.lostSessionNote}\n\n${prefix}${texto}`);
    }

    const tokens = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens + r.usage.outputTokens;
    await recordUsage({
      tool: spec.usage.tool,
      kind: 'script',
      provider: 'claude-code',
      model: r.model,
      description: `${spec.usage.description} · suscripción (≈ $${r.equivalentCostUSD.toFixed(4)} por API)`,
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
        (d) => `${d.tool}${d.input && typeof d.input === 'object' && 'file_path' in d.input ? `: ${String((d.input as { file_path?: string }).file_path)}` : ''}`
      ),
      duracionSeg: Math.round((Date.now() - started) / 1000),
    };
    const finalSession = r.sessionId ?? session.id;
    await spec.saveChat((c) => ({ sessionId: finalSession, mensajes: [...(c?.mensajes ?? []), msg].slice(-60) }));
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
    // Si la sesión nunca llegó a crearse, la próxima vez se empieza una nueva
    const keep = session.resume || steps.size > 0 || streamed.length > 0;
    await spec
      .saveChat((c) => ({ sessionId: keep ? session.id : c?.sessionId, mensajes: [...(c?.mensajes ?? []), msg].slice(-60) }))
      .catch(() => undefined);
    emit(turn, { tipo: 'error', mensaje, codigo });
  } finally {
    release();
    turn.done = true;
    for (const l of turn.listeners) l();
    // El turno terminado se queda un rato para quien se reconecte
    setTimeout(() => {
      if (turns.get(turn.key) === turn) turns.delete(turn.key);
    }, 10 * 60_000);
  }
}
