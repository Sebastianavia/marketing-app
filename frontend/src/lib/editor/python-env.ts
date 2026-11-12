import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';

/**
 * Herramientas avanzadas de la edición (opcionales):
 *  - Python + PyTorch → recorte del sujeto (texto detrás de la cabeza) con RobustVideoMatting.
 *  - Whisper → transcripción gratis en este PC.
 * La app busca el Python del PC, dice qué falta e instala cada cosa con un botón (pip / winget),
 * mostrando el registro. Los scripts propios están en frontend/python/.
 */

export type TranscriberChoice = 'elevenlabs' | 'whisper';
export type WhisperModel = 'turbo' | 'small' | 'base';
export type MatteModel = 'auto' | 'resnet50' | 'mobilenetv3';

export interface EditorEnvSettings {
  python?: { cmd: string; args: string[] };
  transcriptor: TranscriberChoice;
  whisperModelo: WhisperModel;
  recorteModelo: MatteModel;
}

export interface PythonInfo {
  python: string;
  ejecutable: string;
  plataforma: string;
  torch: string | null;
  torchError?: string;
  cuda: boolean;
  gpu: string | null;
  mps: boolean;
  whisper: boolean;
  numpy: boolean;
  opencv?: boolean;
}

export interface EnvStatus {
  plataforma: NodeJS.Platform;
  python: (PythonInfo & { cmd: string; args: string[] }) | null;
  nvidia: string | null;
  modelos: Array<{ id: Exclude<MatteModel, 'auto'>; ruta: string; listo: boolean; mb: number }>;
  ajustes: EditorEnvSettings;
  recorteListo: boolean;
  whisperListo: boolean;
  carasListo: boolean;
}

const DEFAULTS: EditorEnvSettings = { transcriptor: 'elevenlabs', whisperModelo: 'turbo', recorteModelo: 'auto' };

export const MATTE_MODELS: Record<Exclude<MatteModel, 'auto'>, { url: string; archivo: string; mb: number }> = {
  resnet50: {
    url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.torchscript',
    archivo: 'rvm_resnet50_fp32.torchscript',
    mb: 103,
  },
  mobilenetv3: {
    url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.torchscript',
    archivo: 'rvm_mobilenetv3_fp32.torchscript',
    mb: 15,
  },
};

export function pythonScript(name: string): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'python', name);
}

async function envFile() {
  return path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'editor-env.json');
}

export async function getEnvSettings(): Promise<EditorEnvSettings> {
  return { ...DEFAULTS, ...(await readJson<Partial<EditorEnvSettings>>(await envFile(), {})) };
}

export async function updateEnvSettings(patch: Partial<EditorEnvSettings>): Promise<EditorEnvSettings> {
  const next = { ...(await getEnvSettings()), ...patch };
  await writeJsonAtomic(await envFile(), next);
  return next;
}

export async function modelsDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'modelos');
  await fs.mkdir(d, { recursive: true });
  return d;
}

// ── Ejecutar procesos ────────────────────────────────────────────────────────

export interface RunResult {
  code: number | null;
  out: string;
}

/** Ejecuta un programa y devuelve su salida; `onLine` recibe cada línea mientras corre. */
export function runProcess(
  cmd: string,
  args: string[],
  o: { timeoutMs?: number; onLine?: (line: string) => void; cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = '';
    let pending = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        windowsHide: true,
        cwd: o.cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', ...o.env },
      });
    } catch (err) {
      resolve({ code: -1, out: errorMessage(err) });
      return;
    }
    const timer = setTimeout(() => child.kill(), o.timeoutMs ?? 60_000);
    const onData = (d: Buffer) => {
      const text = d.toString();
      out = (out + text).slice(-20000);
      if (!o.onLine) return;
      pending += text;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) o.onLine(l.trim());
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, out: `${out}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending.trim() && o.onLine) o.onLine(pending.trim());
      resolve({ code, out });
    });
  });
}

// ── Encontrar Python ─────────────────────────────────────────────────────────

function candidates(saved?: { cmd: string; args: string[] }): Array<{ cmd: string; args: string[] }> {
  const list: Array<{ cmd: string; args: string[] }> = [];
  const fromEnv = process.env.LULO_PYTHON?.trim();
  if (fromEnv) list.push({ cmd: fromEnv, args: [] });
  if (saved) list.push(saved);
  if (process.platform === 'win32') {
    for (const v of ['3.12', '3.11', '3.13', '3.10']) list.push({ cmd: 'py', args: [`-${v}`] });
    list.push({ cmd: 'py', args: ['-3'] });
    const local = process.env.LOCALAPPDATA;
    if (local) {
      for (const v of ['312', '311', '313', '310']) {
        const exe = path.join(/*turbopackIgnore: true*/ local, 'Programs', 'Python', `Python${v}`, 'python.exe');
        if (fsSync.existsSync(exe)) list.push({ cmd: exe, args: [] });
      }
    }
    list.push({ cmd: 'python', args: [] });
  } else {
    list.push({ cmd: 'python3', args: [] }, { cmd: 'python', args: [] });
  }
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.cmd} ${c.args.join(' ')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function probe(c: { cmd: string; args: string[] }): Promise<PythonInfo | null> {
  const r = await runProcess(c.cmd, [...c.args, pythonScript('lulo_check.py')], { timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  const line = r.out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) return null;
  try {
    const info = JSON.parse(line) as PythonInfo & { ok?: boolean };
    const [maj, min] = info.python.split('.').map(Number);
    if (maj !== 3 || min < 9) return null;
    return info;
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __luloPyCache?: { at: number; value: EnvStatus['python'] } };

/** El Python del PC: el guardado, o el primero con PyTorch, o el primero que funcione. */
export async function findPython(force = false): Promise<EnvStatus['python']> {
  const cached = g.__luloPyCache;
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.value;
  const settings = await getEnvSettings();
  let first: EnvStatus['python'] = null;
  let found: EnvStatus['python'] = null;
  for (const c of candidates(settings.python)) {
    const info = await probe(c);
    if (!info) continue;
    const item = { ...info, ...c };
    if (!first) first = item;
    if (info.torch) {
      found = item;
      break;
    }
  }
  const value = found ?? first;
  if (value && (settings.python?.cmd !== value.cmd || settings.python?.args.join(' ') !== value.args.join(' '))) {
    await updateEnvSettings({ python: { cmd: value.cmd, args: value.args } });
  }
  g.__luloPyCache = { at: Date.now(), value };
  return value;
}

async function nvidiaGpu(): Promise<string | null> {
  const r = await runProcess('nvidia-smi', ['-L'], { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  return r.out.split(/\r?\n/).find((l) => l.startsWith('GPU'))?.replace(/\s*\(UUID.*$/, '').trim() ?? null;
}

export async function matteModelPath(choice: MatteModel, cuda: boolean): Promise<{ id: Exclude<MatteModel, 'auto'>; ruta: string } | null> {
  const dir = await modelsDir();
  const order: Array<Exclude<MatteModel, 'auto'>> =
    choice === 'auto' ? (cuda ? ['resnet50', 'mobilenetv3'] : ['mobilenetv3', 'resnet50']) : [choice];
  for (const id of order) {
    const ruta = path.join(/*turbopackIgnore: true*/ dir, MATTE_MODELS[id].archivo);
    if (fsSync.existsSync(ruta) && fsSync.statSync(ruta).size > 1_000_000) return { id, ruta };
  }
  return null;
}

export async function envStatus(force = false): Promise<EnvStatus> {
  const [python, nvidia, ajustes, dir] = await Promise.all([findPython(force), nvidiaGpu(), getEnvSettings(), modelsDir()]);
  const modelos = (Object.keys(MATTE_MODELS) as Array<Exclude<MatteModel, 'auto'>>).map((id) => {
    const ruta = path.join(/*turbopackIgnore: true*/ dir, MATTE_MODELS[id].archivo);
    const listo = fsSync.existsSync(ruta) && fsSync.statSync(ruta).size > 1_000_000;
    return { id, ruta, listo, mb: MATTE_MODELS[id].mb };
  });
  const recorteListo = !!python?.torch && !!(await matteModelPath(ajustes.recorteModelo, !!python?.cuda));
  return {
    plataforma: process.platform,
    python,
    nvidia,
    modelos,
    ajustes,
    recorteListo,
    whisperListo: !!python?.torch && !!python?.whisper,
    carasListo: !!python?.opencv,
  };
}

// ── Instalaciones con botón ──────────────────────────────────────────────────

export type InstallTarget = 'python' | 'torch' | 'whisper' | 'opencv' | 'modelo-resnet50' | 'modelo-mobilenetv3' | 'claude-base';

export interface InstallJob {
  id: string;
  que: InstallTarget;
  estado: 'corriendo' | 'ok' | 'error';
  inicio: string;
  fin?: string;
  log: string;
}

const jobsState = globalThis as unknown as { __luloInstallJobs?: InstallJob[] };
const jobs = (jobsState.__luloInstallJobs ??= []);

export function listInstallJobs(): InstallJob[] {
  return jobs.slice(-10);
}

function log(job: InstallJob, line: string) {
  job.log = `${job.log}${line}\n`.slice(-8000);
}

export async function startInstall(que: InstallTarget): Promise<InstallJob> {
  if (jobs.some((j) => j.estado === 'corriendo')) throw new Error('Ya hay una instalación en marcha. Espera a que termine.');
  const job: InstallJob = { id: `${Date.now()}`, que, estado: 'corriendo', inicio: new Date().toISOString(), log: '' };
  jobs.push(job);
  void runInstall(job).catch((err) => {
    job.estado = 'error';
    job.fin = new Date().toISOString();
    log(job, `Error: ${errorMessage(err)}`);
  });
  return job;
}

async function pip(job: InstallJob, pkgs: string[], extra: string[] = []) {
  const py = await findPython(true);
  if (!py) throw new Error('No se encontró Python 3.9 o superior en este PC. Instálalo primero.');
  log(job, `Python ${py.python} (${py.cmd} ${py.args.join(' ')})`);
  const args = [...py.args, '-m', 'pip', 'install', '--upgrade', ...pkgs, ...extra];
  log(job, `> ${py.cmd} ${args.join(' ')}`);
  const r = await runProcess(py.cmd, args, { timeoutMs: 90 * 60_000, onLine: (l) => log(job, l) });
  if (r.code !== 0) throw new Error(`pip terminó con código ${r.code}. Mira el registro.`);
}

/** pip install en una carpeta propia (--target): así lo instala la app igual que lo haría Claude. */
async function pipTarget(job: InstallJob, pkgs: string[], target: string) {
  const py = await findPython(true);
  if (!py) throw new Error('No se encontró Python 3.9 o superior en este PC. Instálalo primero (botón de arriba).');
  await fs.mkdir(target, { recursive: true });
  const args = [...py.args, '-m', 'pip', 'install', '--upgrade', '--target', target, ...pkgs];
  log(job, `> ${py.cmd} ${args.join(' ')}`);
  const r = await runProcess(py.cmd, args, { timeoutMs: 60 * 60_000, onLine: (l) => log(job, l) });
  if (r.code !== 0) throw new Error(`pip terminó con código ${r.code}. Mira el registro.`);
}

/** Kit base de Claude: paquetes de Python que más usa + HyperFrames con su Chrome (macOS y Windows). */
async function installClaudeBase(job: InstallJob) {
  const target = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'claude-herramientas', 'py');
  log(job, `Carpeta de herramientas de Claude: ${target}`);
  await pipTarget(job, ['numpy', 'scipy', 'opencv-python-headless', 'fonttools', 'pillow', 'tqdm'], target);
  try {
    await pipTarget(job, ['mediapipe'], target);
  } catch (err) {
    log(job, `Aviso: MediaPipe no se pudo instalar (${errorMessage(err)}). Suele pasar con Python 3.13 o más nuevo: Claude usará otras vías para recortar a la persona.`);
  }
  // HyperFrames (Node) y su Chrome: así el primer render de Claude no espera la descarga
  try {
    const { HYPERFRAMES_VERSION } = await import('@/lib/ai/claude-code/code-video');
    const crossSpawn = (await import('cross-spawn')).default;
    log(job, `> npx -y hyperframes@${HYPERFRAMES_VERSION} browser ensure`);
    const code = await new Promise<number | null>((resolve) => {
      const child = crossSpawn('npx', ['-y', `hyperframes@${HYPERFRAMES_VERSION}`, 'browser', 'ensure'], {
        env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const onData = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(job, l));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (e) => {
        log(job, `No se pudo lanzar npx: ${errorMessage(e)} (¿está Node.js instalado?)`);
        resolve(-1);
      });
      child.on('close', resolve);
    });
    if (code !== 0) log(job, 'Aviso: no se pudo preparar el Chrome de HyperFrames; se descargará en el primer render.');
  } catch (err) {
    log(job, `Aviso: HyperFrames no se preparó (${errorMessage(err)}).`);
  }
  (globalThis as { __luloToolbox?: unknown }).__luloToolbox = undefined;
}

async function runInstall(job: InstallJob) {
  const done = (msg: string) => {
    job.estado = 'ok';
    job.fin = new Date().toISOString();
    log(job, msg);
    g.__luloPyCache = undefined;
  };
  switch (job.que) {
    case 'python': {
      if (process.platform !== 'win32') throw new Error('Instala Python 3.11 o 3.12 con el gestor de paquetes de tu sistema.');
      log(job, '> winget install -e --id Python.Python.3.12');
      const r = await runProcess(
        'winget',
        ['install', '-e', '--id', 'Python.Python.3.12', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
        { timeoutMs: 30 * 60_000, onLine: (l) => log(job, l) }
      );
      if (r.code !== 0 && !/already installed|ya está instalado/i.test(r.out)) {
        throw new Error('winget no pudo instalar Python. Instálalo desde python.org (marca "Add python.exe to PATH") y vuelve a comprobar.');
      }
      done('Python instalado. Si no aparece, reinicia la app.');
      return;
    }
    case 'torch': {
      const gpu = await nvidiaGpu();
      if (gpu) {
        log(job, `Tarjeta detectada: ${gpu} → PyTorch con CUDA (descarga grande, ~2,5 GB).`);
        await pip(job, ['torch'], ['--index-url', 'https://download.pytorch.org/whl/cu128']);
      } else {
        log(job, 'Sin tarjeta NVIDIA → PyTorch para CPU.');
        await pip(job, ['torch'], process.platform === 'darwin' ? [] : ['--index-url', 'https://download.pytorch.org/whl/cpu']);
      }
      done('PyTorch instalado.');
      return;
    }
    case 'claude-base': {
      await installClaudeBase(job);
      done('Herramientas de Claude listas. Claude las reutiliza en cada edición.');
      return;
    }
    case 'opencv': {
      await pip(job, ['opencv-python-headless', 'numpy']);
      done('Detector de caras instalado.');
      return;
    }
    case 'whisper': {
      await pip(job, ['openai-whisper', 'numpy']);
      done('Whisper instalado. La primera transcripción descarga el modelo elegido (turbo ~1,5 GB, small ~460 MB).');
      return;
    }
    case 'modelo-resnet50':
    case 'modelo-mobilenetv3': {
      const id = job.que === 'modelo-resnet50' ? 'resnet50' : 'mobilenetv3';
      const m = MATTE_MODELS[id];
      const dest = path.join(/*turbopackIgnore: true*/ await modelsDir(), m.archivo);
      log(job, `Descargando ${m.archivo} (~${m.mb} MB, licencia GPL-3.0) desde GitHub…`);
      const res = await fetch(m.url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`GitHub respondió ${res.status}.`);
      const tmp = `${dest}.${process.pid}.tmp`;
      await pipeline(Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream), fsSync.createWriteStream(tmp));
      const size = (await fs.stat(tmp)).size;
      if (size < 1_000_000) {
        await fs.rm(tmp, { force: true });
        throw new Error('La descarga quedó incompleta.');
      }
      await fs.rename(tmp, dest);
      done(`Modelo guardado (${(size / 1024 / 1024).toFixed(0)} MB) en ${dest}.`);
      return;
    }
  }
}
