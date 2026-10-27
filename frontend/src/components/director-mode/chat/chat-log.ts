/**
 * Historial del chat del Director, por producción, en el navegador (últimos 100 mensajes).
 * No va en produccion.json: el estado real lo tiene el motor; esto es solo la conversación.
 */

export interface ChatMessage {
  id: string;
  rol: 'agente' | 'tu';
  texto: string;
  cuando: string;
  /** Nodo enfocado cuando se escribió (p. ej. 'escena:e2'). */
  nodo?: string;
  error?: boolean;
  /** Cambio propuesto por el chat libre que espera un clic (Hacerlo / No). */
  propuesta?: {
    body: Record<string, unknown> & { accion: string };
    resumen: string;
    boton: string;
    costo: string;
    estado: 'pendiente' | 'hecha' | 'descartada';
  };
}

const MAX = 100;
const key = (productionId: string) => `lulo_director_chat_${productionId}`;

export function readChat(productionId: string): ChatMessage[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(productionId)) || '[]');
    return Array.isArray(v) ? (v as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function writeChat(productionId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(key(productionId), JSON.stringify(messages.slice(-MAX)));
  } catch {
    // sin almacenamiento: la conversación no se recuerda al volver
  }
}

export function newMessage(rol: ChatMessage['rol'], texto: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: Math.random().toString(36).slice(2, 10), rol, texto, cuando: new Date().toISOString(), ...extra };
}
