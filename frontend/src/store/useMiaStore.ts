import { create } from 'zustand';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  suggestedAction?: {
    type: 'inject_script' | 'inject_prompt';
    payload: string;
    targetTool: string;
    label?: string;
  };
}

export type MiaMessage = AssistantMessage;

export interface InjectedPayload {
  targetTool: string;
  content: string;
  timestamp: number;
}

interface AssistantStoreState {
  isOpen: boolean;
  activeTool: string | null;
  messages: AssistantMessage[];
  injectedData: InjectedPayload | null;
  selectedSkillId: string;
  selectedModel: string;
  customApiKey: string;

  // Actions
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setActiveTool: (toolId: string | null) => void;
  addMessage: (msg: Omit<AssistantMessage, 'id' | 'timestamp'>) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  injectIntoTool: (targetTool: string, content: string) => void;
  clearInjectedData: () => void;
  setSelectedSkillId: (skillId: string) => void;
  setSelectedModel: (model: string) => void;
  setCustomApiKey: (key: string) => void;
}

export const useAssistantStore = create<AssistantStoreState>((set) => ({
  isOpen: false,
  activeTool: null,
  selectedSkillId: 'auto',
  selectedModel: 'gemini-2.5-flash',
  customApiKey: '',
  injectedData: null,
  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hola, soy tu Asistente, tu copiloto creativo y CLI local. Pídeme redactar un gancho publicitario, optimizar tu guion de locución para HeyGen o diseñar un prompt cinemático. Puedes inyectar cualquier resultado directamente en tu herramienta activa con un solo clic o arrastrar archivos locales aquí.',
      timestamp: Date.now(),
    },
  ],

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setActiveTool: (toolId) => set({ activeTool: toolId }),

  setSelectedModel: (model) => set({ selectedModel: model }),
  setCustomApiKey: (key) => set({ customApiKey: key }),

  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...msg,
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
        },
      ],
    })),

  updateLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      if (messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last.role === 'assistant') {
          messages[messages.length - 1] = {
            ...last,
            content,
          };
        }
      }
      return { messages };
    }),

  clearMessages: () =>
    set({
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content:
            'Consola del Asistente reiniciada. ¿En qué campaña o creativo deseas trabajar ahora?',
          timestamp: Date.now(),
        },
      ],
    }),

  injectIntoTool: (targetTool, content) =>
    set({
      injectedData: {
        targetTool,
        content,
        timestamp: Date.now(),
      },
    }),

  clearInjectedData: () => set({ injectedData: null }),
  setSelectedSkillId: (skillId) => set({ selectedSkillId: skillId }),
}));

// Backward compatibility alias
export const useMiaStore = useAssistantStore;
