/**
 * Next.js ejecuta register() una vez al arrancar el servidor.
 * Aquí se prepara la carpeta de datos y se arranca el runner de renders,
 * que retoma cualquier trabajo que quedó pendiente al cerrar la app.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureDataDir } = await import('@/lib/data/data-dir');
    const { startRunner } = await import('@/lib/jobs/runner');
    const { startSceneRunner } = await import('@/lib/scenes/scene-runner');
    await ensureDataDir();
    startRunner();
    startSceneRunner();
  }
}
