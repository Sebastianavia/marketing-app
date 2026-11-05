import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import spawn from 'cross-spawn';
import { errorMessage } from '@/lib/errors';

/**
 * Puente con Claude Code (el programa `claude` instalado en este PC).
 *
 * La app NO toca el token de la suscripción: lanza el CLI oficial en modo `-p`
 * con la sesión que la persona ya inició (`claude` → /login) y lee su salida.
 * Así cada uno usa su propio plan Pro/Max en su propio equipo.
 *
 * Aislamiento de cada llamada:
 * - cwd = carpeta temporal propia (solo el prompt de sistema y los adjuntos).
 * - Única herramienta: Read, limitada a esa carpeta (permission-mode dontAsk niega lo demás).
 * - Sin MCP (--strict-mcp-config), sin ajustes/hooks del usuario ni CLAUDE.md
 *   (--setting-sources local en una carpeta vacía), sin guardar la sesión.
 * - Se quita ANTHROPIC_API_KEY del entorno: si existiera, el CLI cobraría por API.
 */

export type ClaudeCodeErrorReason = 'not_installed' | 'not_logged_in' | 'limit' | 'failed' | 'timeout';

export class ClaudeCodeError extends Error {
  constructor(
    readonly reason: ClaudeCodeErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ClaudeCodeError';
  }
}

export interface ClaudeCodeFile {
  data: Uint8Array;
  mediaType: string;
  filename?: string;
}

export interface ClaudeCodeRequest {
  system?: string;
  prompt: string;
  /** Alias del CLI ('sonnet', 'opus', 'haiku') o id completo. */
  model?: string;
  /** JSON Schema: la respuesta llega validada por Claude Code en `structured`. */
  jsonSchema?: object;
  files?: ClaudeCodeFile[];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Cada fragmento de texto según llega (streaming). */
  onText?: (delta: string) => void;
}

export interface ClaudeCodeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface RateLimitInfo {
  status: string;
  /** 0–1: cuánto se ha usado de la ventana de 5 h y de la semanal. */
  fiveHour?: number;
  sevenDay?: number;
  resetsAt?: string;
  at: string;
}

export interface ClaudeCodeResult {
  text: string;
  structured?: unknown;
  model: string;
  usage: ClaudeCodeUsage;
  /** Lo que costaría por API; con la suscripción no se cobra. */
  equivalentCostUSD: number;
  rateLimit?: RateLimitInfo;
  durationMs: number;
}

export interface ClaudeCodeStatus {
  installed: boolean;
  cliPath?: string;
  version?: string;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  /** Hay una ANTHROPIC_API_KEY en el entorno de la app (el puente la ignora). */
  apiKeyInEnv: boolean;
  rateLimit?: RateLimitInfo;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
// 4: el Estudio Claude usa el editor (otro Claude) y este a su vez hace consultas internas
const MAX_CONCURRENT = 4;

// En globalThis: las rutas pueden cargar copias distintas de este módulo en desarrollo
const g = globalThis as unknown as {
  __luloClaudeCode?: {
    cliPath?: string | null;
    status?: { at: number; value: ClaudeCodeStatus };
    rateLimit?: RateLimitInfo;
    running: number;
    queue: Array<() => void>;
  };
};
const state = (g.__luloClaudeCode ??= { running: 0, queue: [] });

// ---------------------------------------------------------------------------
// Localizar el CLI
// ---------------------------------------------------------------------------

function candidateNames(): string[] {
  return process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
}

function candidateDirs(): string[] {
  const home = os.homedir();
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  // El servidor puede arrancar sin el PATH de la terminal (p. ej. desde un acceso directo)
  dirs.push(path.join(/*turbopackIgnore: true*/ home, '.local', 'bin'));
  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(path.join(/*turbopackIgnore: true*/ process.env.APPDATA, 'npm'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(/*turbopackIgnore: true*/ home, '.npm-global', 'bin'));
  }
  return [...new Set(dirs)];
}

export function resolveClaudeCli(): string | null {
  if (state.cliPath !== undefined) return state.cliPath;
  const override = process.env.CLAUDE_CLI_PATH?.trim();
  if (override) return (state.cliPath = fs.existsSync(override) ? override : null);
  for (const dir of candidateDirs()) {
    for (const name of candidateNames()) {
      const p = path.join(/*turbopackIgnore: true*/ dir, name);
      try {
        if (fs.statSync(p).isFile()) return (state.cliPath = p);
      } catch {
        // no está aquí
      }
    }
  }
  return (state.cliPath = null);
}

/**
 * Variables del sistema que el CLI necesita. Se pasa una LISTA BLANCA, no process.env:
 * Next carga .env.local en process.env y Claude (que puede ejecutar comandos en el modo agente)
 * no debe ver ninguna clave (OpenRouter, ElevenLabs…) ni ANTHROPIC_API_KEY (cobraría por API).
 */
const ENV_ALLOW = new Set([
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TERM', 'TZ',
  'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'OS',
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'ProgramData', 'ProgramFiles',
  'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'CLAUDE_CONFIG_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (ENV_ALLOW.has(k) || k.startsWith('LC_') || k.startsWith('XDG_'))) env[k] = v;
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

function runQuick(cli: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cli, args, { env: childEnv(), cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || errorMessage(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Estado del CLI (instalado, sesión iniciada, cupo). Se guarda 60 s. */
export async function getClaudeCodeStatus(force = false): Promise<ClaudeCodeStatus> {
  if (!force && state.status && Date.now() - state.status.at < 60_000) {
    return { ...state.status.value, rateLimit: state.rateLimit };
  }
  if (force) state.cliPath = undefined;
  const apiKeyInEnv = Boolean(process.env.ANTHROPIC_API_KEY);
  const cli = resolveClaudeCli();
  let value: ClaudeCodeStatus;
  if (!cli) {
    value = { installed: false, loggedIn: false, apiKeyInEnv, error: 'No se encontró el programa `claude` (Claude Code).' };
  } else {
    const [ver, auth] = await Promise.all([runQuick(cli, ['--version']), runQuick(cli, ['auth', 'status', '--json'])]);
    let parsed: { loggedIn?: boolean; authMethod?: string; subscriptionType?: string } = {};
    try {
      parsed = JSON.parse(auth.stdout);
    } catch {
      // versión antigua sin --json: se intenta igual al primer uso
    }
    value = {
      installed: ver.code === 0,
      cliPath: cli,
      version: ver.stdout.trim().split(/\s/)[0] || undefined,
      loggedIn: parsed.loggedIn === true,
      authMethod: parsed.authMethod,
      subscriptionType: parsed.subscriptionType,
      apiKeyInEnv,
      error: ver.code === 0 ? undefined : (ver.stderr || 'El programa `claude` no respondió.').slice(0, 300),
    };
  }
  state.status = { at: Date.now(), value };
  return { ...value, rateLimit: state.rateLimit };
}

// ---------------------------------------------------------------------------
// Ejecutar una petición
// ---------------------------------------------------------------------------

async function acquire(): Promise<() => void> {
  if (state.running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.running--;
    state.queue.shift()?.();
  };
}

function extensionFor(mediaType: string): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
    'text/csv': '.csv',
  };
  return map[mediaType] ?? '';
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'archivo';
}

interface StreamLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  api_error_status?: number | null;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
  model?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  rate_limit_info?: {
    status?: string;
    resetsAt?: number;
    unifiedWindows?: Record<string, { utilization?: number }>;
  };
  errors?: string[];
  session_id?: string;
  parent_tool_use_id?: string | null;
  num_turns?: number;
  permission_denials?: Array<{ tool_name?: string; tool_input?: unknown }>;
  message?: { content?: unknown[] };
}

function toRateLimit(info: NonNullable<StreamLine['rate_limit_info']>): RateLimitInfo {
  return {
    status: info.status ?? 'unknown',
    fiveHour: info.unifiedWindows?.five_hour?.utilization,
    sevenDay: info.unifiedWindows?.seven_day?.utilization,
    resetsAt: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : undefined,
    at: new Date().toISOString(),
  };
}

function looksLikeLogin(text: string): boolean {
  return /\/login|not logged in|invalid api key|authentication|oauth token/i.test(text);
}

function looksLikeLimit(text: string): boolean {
  return /usage limit|rate limit|limit reached|429|too many requests/i.test(text);
}

function limitMessage(rl?: RateLimitInfo): string {
  const when = rl?.resetsAt ? ` Se libera hacia las ${new Date(rl.resetsAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}.` : '';
  return `Se agotó el cupo de tu suscripción de Claude por ahora.${when}`;
}

export interface ToolUseEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  id: string;
  isError: boolean;
  text: string;
}

export interface ExecClaudeOptions {
  args: string[];
  cwd: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  defaultModel?: string;
  onText?: (delta: string) => void;
  onToolUse?: (e: ToolUseEvent) => void;
  onToolResult?: (e: ToolResultEvent) => void;
}

export interface ExecClaudeResult extends ClaudeCodeResult {
  sessionId?: string;
  /** Herramientas que el modo de permisos negó (rutas fuera de la carpeta, etc.). */
  denied: Array<{ tool: string; input: unknown }>;
  numTurns: number;
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c && typeof c.text === 'string' ? c.text : ''))
      .join('\n');
  }
  return '';
}

/** Lanza el CLI, lee stream-json y devuelve el resultado. No crea carpetas ni limita la concurrencia. */
export function execClaude(o: ExecClaudeOptions): Promise<ExecClaudeResult> {
  const cli = resolveClaudeCli();
  if (!cli) {
    return Promise.reject(
      new ClaudeCodeError(
        'not_installed',
        'No encontré Claude Code en este PC. Instálalo (https://claude.com/claude-code), abre una terminal, ejecuta `claude` e inicia sesión con tu cuenta.'
      )
    );
  }
  const started = Date.now();
  return new Promise<ExecClaudeResult>((resolve, reject) => {
    const child = spawn(cli, o.args, { cwd: o.cwd, env: o.env ?? childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let finalLine: StreamLine | null = null;
    let rateLimit: RateLimitInfo | undefined;
    let model = o.defaultModel || 'sonnet';
    let sessionId: string | undefined;
    let settled = false;

    const finish = (err: Error | null, value?: ExecClaudeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value!);
    };
    const kill = () => {
      if (child.exitCode === null) child.kill();
    };
    const onAbort = () => {
      kill();
      finish(new ClaudeCodeError('failed', 'Petición cancelada.'));
    };
    const timer = setTimeout(() => {
      kill();
      finish(new ClaudeCodeError('timeout', 'Claude Code tardó demasiado en responder.'));
    }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (o.signal?.aborted) return onAbort();
    o.signal?.addEventListener('abort', onAbort);

    const handle = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      let msg: StreamLine;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.session_id) sessionId = msg.session_id;
      if (msg.type === 'system' && msg.subtype === 'init' && msg.model) model = msg.model;
      else if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        rateLimit = toRateLimit(msg.rate_limit_info);
        state.rateLimit = rateLimit;
      } else if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
        if (msg.event.delta.text) o.onText?.(msg.event.delta.text);
      } else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
        for (const b of (msg.message?.content ?? []) as ContentBlock[]) {
          if (b.type === 'tool_use' && b.id && b.name) o.onToolUse?.({ id: b.id, name: b.name, input: b.input ?? {} });
        }
      } else if (msg.type === 'user' && !msg.parent_tool_use_id) {
        for (const b of (msg.message?.content ?? []) as ContentBlock[]) {
          if (b.type === 'tool_result' && b.tool_use_id) {
            o.onToolResult?.({ id: b.tool_use_id, isError: b.is_error === true, text: blockText(b.content).slice(0, 2000) });
          }
        }
      } else if (msg.type === 'result') finalLine = msg;
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    child.on('error', (err) => finish(new ClaudeCodeError('failed', `No se pudo iniciar Claude Code: ${errorMessage(err)}`)));
    child.on('close', (code) => {
      handle(buffer);
      const r = finalLine as StreamLine | null;
      const detail = [r?.result, ...(r?.errors ?? []), stderr].filter(Boolean).join(' ').slice(0, 400);
      if (!r || r.is_error || r.subtype !== 'success') {
        if (rateLimit?.status === 'rejected' || r?.api_error_status === 429 || looksLikeLimit(detail)) {
          return finish(new ClaudeCodeError('limit', limitMessage(rateLimit)));
        }
        if (r?.api_error_status === 401 || looksLikeLogin(detail)) {
          return finish(
            new ClaudeCodeError('not_logged_in', 'Claude Code no tiene la sesión iniciada. Abre una terminal, ejecuta `claude` y luego /login.')
          );
        }
        if (r?.subtype === 'error_max_turns') {
          return finish(new ClaudeCodeError('failed', 'Claude llegó al máximo de pasos para este pedido. Pídele que continúe.'));
        }
        return finish(new ClaudeCodeError('failed', `Claude Code no pudo responder${code ? ` (código ${code})` : ''}: ${detail || 'sin detalle'}`));
      }
      const u = r.usage ?? {};
      finish(null, {
        text: r.result ?? '',
        structured: r.structured_output,
        model: Object.keys(r.modelUsage ?? {})[0] ?? model,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
        equivalentCostUSD: r.total_cost_usd ?? 0,
        rateLimit,
        durationMs: Date.now() - started,
        sessionId: r.session_id ?? sessionId,
        denied: (r.permission_denials ?? []).map((d) => ({ tool: d.tool_name ?? '?', input: d.tool_input })),
        numTurns: r.num_turns ?? 0,
      });
    });

    child.stdin?.on('error', () => {
      // el proceso se cerró antes de leer: lo informa 'close'
    });
    child.stdin?.end(o.stdin, 'utf8');
  });
}

/** Limita cuántos Claude Code corren a la vez en este PC (para no agotar el cupo de golpe). */
export function acquireClaudeSlot(): Promise<() => void> {
  return acquire();
}

export async function runClaudeCode(req: ClaudeCodeRequest): Promise<ClaudeCodeResult> {
  const release = await acquire();
  const dir = path.join(/*turbopackIgnore: true*/ os.tmpdir(), 'lulo-claude', randomUUID());
  try {
    await fsp.mkdir(dir, { recursive: true });
    const systemFile = path.join(/*turbopackIgnore: true*/ dir, 'sistema.txt');
    await fsp.writeFile(systemFile, req.system?.trim() || 'Eres un asistente útil. Responde en español.', 'utf8');

    let prompt = req.prompt;
    if (req.files?.length) {
      const names: string[] = [];
      for (const [i, f] of req.files.entries()) {
        const base = f.filename ? safeName(f.filename) : `adjunto-${i + 1}`;
        const name = path.extname(base) ? base : base + extensionFor(f.mediaType);
        await fsp.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), f.data);
        names.push(`./${name}`);
      }
      prompt += `\n\nArchivos adjuntos (léelos con la herramienta Read antes de responder): ${names.join(', ')}`;
    }

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', req.model || 'sonnet',
      '--system-prompt-file', systemFile,
      '--tools', 'Read',
      '--allowedTools', 'Read(./**)',
      '--permission-mode', 'dontAsk',
      '--strict-mcp-config',
      '--setting-sources', 'local',
      '--no-session-persistence',
    ];
    if (req.jsonSchema) args.push('--json-schema', JSON.stringify(req.jsonSchema));

    const r = await execClaude({
      args,
      cwd: dir,
      stdin: prompt,
      signal: req.signal,
      timeoutMs: req.timeoutMs,
      defaultModel: req.model,
      onText: req.onText,
    });
    return {
      text: r.text,
      structured: r.structured,
      model: r.model,
      usage: r.usage,
      equivalentCostUSD: r.equivalentCostUSD,
      rateLimit: r.rateLimit,
      durationMs: r.durationMs,
    };
  } finally {
    release();
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
