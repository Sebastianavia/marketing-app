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
    const { startEditRunner } = await import('@/lib/editor/edit-runner');
    const { startResumeWatcher } = await import('@/lib/ai/claude-code/quota-resume');
    await ensureDataDir();
    startRunner();
    startSceneRunner();
    startEditRunner();
    // Retoma los chats con Claude que se cortaron por falta de cupo cuando este se libera
    startResumeWatcher();
  }
}
