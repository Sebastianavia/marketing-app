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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const APP_URL = (process.env.LULO_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
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

async function callApp(pathname, init = {}, timeoutMs = LIST_TIMEOUT_MS) {
  const token = await readOrCreateToken();
  let res;
  try {
    res = await fetch(`${APP_URL}${pathname}`, {
      ...init,
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `Lulo Studio no respondió en ${Math.round(timeoutMs / 1000)} s. La tarea puede seguir en la app: revisa con ver_produccion antes de repetirla (no la lances dos veces).`,
      );
    }
    throw new AppOfflineError(OFFLINE_MESSAGE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `La app respondió ${res.status}.`);
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
  { name: 'lulo-studio', version: '0.1.0' },
  { capabilities: { tools: { listChanged: true } } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const { tools } = await callApp('/api/director/tools');
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
      await callApp('/api/director/tools');
      online = true;
      await server.sendToolListChanged();
      return text('Conectado con Lulo Studio. Las herramientas ya están disponibles.');
    } catch (err) {
      return text(err.message, true);
    }
  }

  try {
    const { result } = await callApp(`/api/director/tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(args ?? {}),
    }, TOOL_TIMEOUT_MS);
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
