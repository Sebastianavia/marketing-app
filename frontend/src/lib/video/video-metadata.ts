/**
 * Extrae la duración exacta en segundos (duración real de reproducción)
 * de un archivo de video MP4 cargando sus metadatos nativos en el navegador.
 */
export function extractVideoDurationSeconds(videoUrl: string): Promise<number> {
  return new Promise((resolve) => {
    if (!videoUrl || typeof window === 'undefined') {
      resolve(0);
      return;
    }

    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.crossOrigin = 'anonymous';
      video.src = videoUrl;

      const onLoaded = () => {
        cleanup();
        const duration = video.duration;
        if (duration && isFinite(duration) && duration > 0) {
          resolve(Math.round(duration * 10) / 10);
        } else {
          resolve(0);
        }
      };

      const onError = () => {
        cleanup();
        resolve(0);
      };

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);

      // Timeout de seguridad en caso de fallo de red en la precarga
      setTimeout(() => {
        cleanup();
        resolve(0);
      }, 8000);
    } catch {
      resolve(0);
    }
  });
}
