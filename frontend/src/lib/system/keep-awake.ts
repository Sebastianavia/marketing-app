import { spawn, type ChildProcess } from 'child_process';

/**
 * Mantener el PC despierto mientras hay trabajo largo (lotes nocturnos). Contador de usos: el
 * equipo vuelve a poder dormirse cuando el último lo suelta.
 *  - macOS: `caffeinate -i -w <pid>` (muere solo si la app se cierra).
 *  - Windows: PowerShell que llama a SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
 *    cada minuto y termina si la app se cierra.
 *  - Linux: `systemd-inhibit` si existe.
 * La pantalla sí puede apagarse.
 */

const g = globalThis as unknown as { __luloAwake?: { users: Set<string>; child: ChildProcess | null } };
const state = (g.__luloAwake ??= { users: new Set(), child: null });

const WIN_SCRIPT = `
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$k = Add-Type -MemberDefinition $sig -Name Awake -Namespace Lulo -PassThru
while ($true) {
  if (-not (Get-Process -Id ${'$'}env:LULO_PARENT_PID -ErrorAction SilentlyContinue)) { break }
  $null = $k::SetThreadExecutionState([uint32]"0x80000001")
  Start-Sleep -Seconds 60
}`;

function start(): ChildProcess | null {
  try {
    if (process.platform === 'darwin') {
      return spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    }
    if (process.platform === 'win32') {
      return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, LULO_PARENT_PID: String(process.pid) },
      });
    }
    return spawn('systemd-inhibit', ['--what=idle:sleep', '--why=Lulo Studio: lote nocturno', 'sleep', 'infinity'], { stdio: 'ignore' });
  } catch {
    return null;
  }
}

export function keepAwake(user: string): void {
  state.users.add(user);
  if (state.child && state.child.exitCode === null) return;
  state.child = start();
  state.child?.on('error', () => {
    state.child = null;
  });
}

export function releaseAwake(user: string): void {
  state.users.delete(user);
  if (state.users.size || !state.child) return;
  try {
    state.child.kill();
  } catch {
    // ya había terminado
  }
  state.child = null;
}

export function isKeepingAwake(): boolean {
  return Boolean(state.child && state.child.exitCode === null);
}
