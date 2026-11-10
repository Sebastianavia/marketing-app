/** Cliente de /api/feedback (subir videos a la app de feedback y llevar las notas a Claude). */

export type FeedbackSourceClient =
  | { tipo: 'edicion'; id: string }
  | { tipo: 'director'; id: string }
  | { tipo: 'studio'; id: string; mediaId: string }
  | { tipo: 'archivo'; ruta: string; servicio: 'avatar' | 'ugc' | 'escenas' | 'proyectos'; titulo?: string };

export interface FeedbackItem {
  key: string;
  proyecto: string;
  nombre: string;
  origen: { servicio: string; id?: string; version?: number; titulo: string } | null;
  subidoEn: string | null;
  enBucket: boolean;
  notas: number;
  general: boolean;
  feedbackEn: string | null;
  nuevo: boolean;
  claude: { destino: string; en: string; edicionId?: string; notas: number } | null;
  siguiente: string | null;
  enlace: string;
}

export interface FeedbackInboxData {
  configurado: boolean;
  app: string;
  ultimaSync: string | null;
  errorSync: string | null;
  nuevos: number;
  entradas: FeedbackItem[];
}

/** Aviso para que la bandeja y los botones se refresquen tras subir o enviar. */
export const FEEDBACK_EVENT = 'lulo:feedback';
export const notifyFeedback = () => window.dispatchEvent(new Event(FEEDBACK_EVENT));

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

export const feedbackApi = {
  inbox: async (sync = false): Promise<FeedbackInboxData> => {
    const res = await fetch(`/api/feedback${sync ? '?sync=1' : ''}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  },
  estado: (fuente: FeedbackSourceClient) =>
    post<{ entrada: FeedbackItem | null; disponible: boolean; sugerido: { proyecto: string; nombre: string } | null; error: string | null }>({ accion: 'estado', fuente }),
  subir: (fuente: FeedbackSourceClient, proyecto?: string, nombre?: string) => post<{ entrada: FeedbackItem }>({ accion: 'subir', fuente, proyecto, nombre }),
  claude: (key: string) => post<{ ok: true; destino: string; edicionId?: string }>({ accion: 'claude', key }),
  revisado: (key: string) => post<{ entrada: FeedbackItem }>({ accion: 'revisado', key }),
};
