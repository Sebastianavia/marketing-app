#!/usr/bin/env node
/**
 * Servidor MCP de Lulo Studio (stdio) para Claude Code.
 *
 * No tiene lógica propia ni claves: pide la lista de herramientas a la app
 * (GET /api/director/tools) y reenvía cada llamada (POST /api/director/tools/<nombre>).
 * La lógica vive en src/lib/director/tools.ts. La app debe estar corriendo (npm run dev).
 *
 * Seguridad: la app solo acepta estas rutas desde este equipo y con el token del archivo
 * `director-token` de la carpeta de datos (lo crea quien llegue primero, la app o este servidor).
 *
 * stdout es el canal del protocolo: los mensajes de diagnóstico van a stderr.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const APP_URL = (process.env.LULO_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Conjunto de herramientas:
 *  - 'director' (por defecto): las del Director (/api/director/tools).
 *  - 'editor': las de UNA edición (/api/editor/agent-tools?edit=<LULO_EDIT_ID>). La app lanza
 *    así a Claude desde el chat de Edición; la edición queda fijada aquí y Claude no puede cambiarla.
 */
const TOOLSET = ['editor', 'director-mode', 'studio'].includes(process.env.LULO_TOOLSET) ? process.env.LULO_TOOLSET : 'director';
const STUDIO_ID = process.env.LULO_STUDIO_ID || '';
const EDIT_ID = process.env.LULO_EDIT_ID || '';
const PRODUCTION_ID = process.env.LULO_PRODUCTION_ID || '';
if (TOOLSET === 'editor' && !/^[a-f0-9-]{36}$/.test(EDIT_ID)) {
  console.error('[lulo-mcp] LULO_TOOLSET=editor necesita LULO_EDIT_ID válido.');
  process.exit(1);
}
if (TOOLSET === 'studio' && !/^st_[a-z0-9]{12}$/.test(STUDIO_ID)) {
  console.error('[lulo-mcp] LULO_TOOLSET=studio necesita LULO_STUDIO_ID válido.');
  process.exit(1);
}
if (TOOLSET === 'director-mode' && !/^[A-Za-z0-9_-]{6,64}$/.test(PRODUCTION_ID)) {
  console.error('[lulo-mcp] LULO_TOOLSET=director-mode necesita LULO_PRODUCTION_ID válido.');
  process.exit(1);
}
const LIST_PATH =
  TOOLSET === 'editor'
    ? `/api/editor/agent-tools?edit=${EDIT_ID}`
    : TOOLSET === 'director-mode'
      ? `/api/director-mode/agent-tools?prod=${encodeURIComponent(PRODUCTION_ID)}`
      : TOOLSET === 'studio'
        ? `/api/studio/agent-tools?studio=${STUDIO_ID}`
        : '/api/director/tools';
const callPath = (name) =>
  TOOLSET === 'editor'
    ? `/api/editor/agent-tools/${encodeURIComponent(name)}?edit=${EDIT_ID}`
    : TOOLSET === 'director-mode'
      ? `/api/director-mode/agent-tools/${encodeURIComponent(name)}?prod=${encodeURIComponent(PRODUCTION_ID)}`
      : TOOLSET === 'studio'
        ? `/api/studio/agent-tools/${encodeURIComponent(name)}?studio=${STUDIO_ID}`
        : `/api/director/tools/${encodeURIComponent(name)}`;
/** Render de la edición: hasta 15 min esperando dentro de la herramienta. */
const EDITOR_TOOL_TIMEOUT_MS = 20 * 60_000;
/** Estudio: renderizar UGC o editar un video puede tardar bastante más. */
const STUDIO_TOOL_TIMEOUT_MS = 35 * 60_000;
const TOKEN_HEADER = 'x-lulo-director-token';
const OFFLINE_MESSAGE = `Lulo Studio no responde en ${APP_URL}. Abre la app (en frontend: npm run dev) y vuelve a intentarlo.`;

/** Misma regla que getDataDir() en src/lib/data/data-dir.ts. */
function dataDir() {
  const override = process.env.LULO_DATA_DIR?.trim();
  if (override) return override;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'LuloStudio');
  return path.join(os.homedir(), '.lulo-studio');
}

async function readOrCreateToken() {
  const dir = dataDir();
  const file = path.join(dir, 'director-token');
  try {
    const token = (await fs.readFile(file, 'utf-8')).trim();
    if (token) return token;
  } catch {
    // No existe todavía.
  }
  await fs.mkdir(dir, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  try {
    await fs.writeFile(file, token, { encoding: 'utf-8', flag: 'wx' });
    return token;
  } catch {
    return (await fs.readFile(file, 'utf-8')).trim();
  }
}

class AppOfflineError extends Error {}

/** Las herramientas que generan (imágenes, voz) pueden tardar; el resto responde al instante. */
const TOOL_TIMEOUT_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 60_000;

/**
 * Petición a la app con node:http y no con fetch: el fetch de Node (undici) corta a los 300 s si la
 * respuesta no empieza, y herramientas como el storyboard de UGC, un render o una edición tardan más.
 * El tiempo máximo lo pone `timeoutMs`.
 */
function request(url, { method = 'GET', headers = {}, body } = {}, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      req.destroy(err);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function callApp(pathname, init = {}, timeoutMs = LIST_TIMEOUT_MS) {
  const token = await readOrCreateToken();
  let res;
  try {
    res = await request(
      `${APP_URL}${pathname}`,
      { ...init, headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token, ...init.headers } },
      timeoutMs,
    );
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `Lulo Studio no respondió en ${Math.round(timeoutMs / 1000)} s. La tarea puede seguir en la app: revisa el estado antes de repetirla (no la lances dos veces).`,
      );
    }
    throw new AppOfflineError(OFFLINE_MESSAGE);
  }
  let data = {};
  try {
    data = JSON.parse(res.text);
  } catch {
    // respuesta no JSON
  }
  if (res.status < 200 || res.status >= 300) throw new Error(data.error || `La app respondió ${res.status}.`);
  return data;
}

/** Herramienta que se ofrece mientras la app está cerrada: al usarla, reconecta. */
const CONNECT_TOOL = {
  name: 'conectar_lulo',
  description:
    'Lulo Studio no estaba abierto cuando se cargaron las herramientas. Úsala después de abrir la app para cargar las herramientas reales (ver_catalogo, estimar_costo, estado_trabajo).',
  inputSchema: { type: 'object', properties: {} },
};

let online = false;

const server = new Server(
  { name: TOOLSET === 'editor' ? 'lulo-editor' : TOOLSET === 'director-mode' ? 'lulo-director' : TOOLSET === 'studio' ? 'lulo-studio-chat' : 'lulo-studio', version: '0.4.0' },
  { capabilities: { tools: { listChanged: true } } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const { tools } = await callApp(LIST_PATH);
    online = true;
    return {
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
  } catch (err) {
    online = false;
    console.error(`[lulo-mcp] ${err.message}`);
    return { tools: [CONNECT_TOOL] };
  }
});

const text = (value, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === CONNECT_TOOL.name) {
    try {
      await callApp(LIST_PATH);
      online = true;
      await server.sendToolListChanged();
      return text('Conectado con Lulo Studio. Las herramientas ya están disponibles.');
    } catch (err) {
      return text(err.message, true);
    }
  }

  try {
    const { result } = await callApp(callPath(name), {
      method: 'POST',
      body: JSON.stringify(args ?? {}),
    }, TOOLSET === 'director' ? TOOL_TIMEOUT_MS : TOOLSET === 'studio' ? STUDIO_TOOL_TIMEOUT_MS : EDITOR_TOOL_TIMEOUT_MS);
    if (!online) {
      online = true;
      await server.sendToolListChanged();
    }
    return text(result);
  } catch (err) {
    if (err instanceof AppOfflineError) online = false;
    return text(err.message, true);
  }
});

await server.connect(new StdioServerTransport());
console.error(`[lulo-mcp] listo; app en ${APP_URL}`);
