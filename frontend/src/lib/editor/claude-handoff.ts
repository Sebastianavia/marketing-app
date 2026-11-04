import { resolveMode } from '@/lib/ai/orchestrator';
import { errorMessage } from '@/lib/errors';
import { createEdit } from './actions';
import { listProfiles } from './profile-store';

/**
 * Modo "Claude · mi suscripción": un video ya montado (UGC Studio, Director) pasa a Edición de video
 * y Claude lo mejora a su criterio (se transcribe ≈ $0,004/min y luego Claude trabaja con la suscripción).
 * Nunca lanza: devuelve null fuera del modo Claude o { error } si no se pudo.
 */
export async function sendToClaudeEditor(o: {
  videoPath: string;
  titulo: string;
  /** Qué es el video y qué debe cuidar Claude al editarlo. */
  pedido: string;
}): Promise<{ id: string; titulo: string } | { error: string } | null> {
  if ((await resolveMode()) !== 'claude-subscription') return null;
  try {
    const perfil = (await listProfiles())[0];
    if (!perfil) return { error: 'No hay perfiles de edición.' };
    const edit = await createEdit(
      { titulo: o.titulo.slice(0, 80), pedido: o.pedido.slice(0, 2000), perfilId: perfil.id, revisarAntes: false, rutaLocal: o.videoPath },
      null
    );
    return { id: edit.id, titulo: edit.titulo };
  } catch (err) {
    return { error: errorMessage(err, 'No se pudo pasar el video al editor.') };
  }
}
