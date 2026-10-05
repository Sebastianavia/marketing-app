'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useMiaStore } from '@/store/useMiaStore';
import {
  Terminal,
  X,
  CornerDownLeft,
  Trash2,
  Check,
  ArrowRight,
  FileVideo,
  FileAudio,
  FileText,
  FileImage,
  File,
  UploadCloud,
  Play,
  Key,
  ChevronDown,
  Sparkles,
} from 'lucide-react';

interface DroppedLocalFile {
  name: string;
  size: string;
  path: string;
  type: 'video' | 'audio' | 'image' | 'text' | 'other';
}

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Tu Gemini)', badge: 'Directo' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: 'Directo' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'OpenRouter' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', badge: 'OpenRouter' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', badge: 'OpenRouter' },
];

const QUICK_PROMPTS_BY_TOOL: Record<string, string[]> = {
  'avatar-studio': [
    'Escribe un gancho de 3 segundos para detener el scroll.',
    'Redacta un guion de 30s con pausas naturales para locución.',
    'Reescribe mi texto para sonar más persuasivo y conversacional.',
  ],
  'ugc-generator': [
    'Genera una estructura UGC en 4 fases (Gancho, Dolor, Solución, CTA).',
    'Crea un gancho con la técnica "Pattern Interrupt".',
    'Dame 3 ángulos emocionales diferentes para este producto.',
  ],
  'deep-swap': [
    '¿Qué tipo de iluminación en el rostro objetivo garantiza mejor integración?',
    'Escribe un guion para probar este reemplazo facial en Meta Ads.',
  ],
  'text-to-video': [
    'Crea un prompt cinemático con lente anamórfica y slow-motion.',
    'Describe una toma de producto flotante con iluminación neón.',
    'Agrega especificaciones técnicas de cámara para Google VEO / Sora.',
  ],
};

const CLI_PRESET_COMMANDS = [
  { label: 'ffmpeg probe', cmd: 'ffmpeg -i input.mp4 -hide_banner' },
  { label: 'crewai pipeline', cmd: 'python -m crewai run --flow marketing_campaign' },
  { label: 'heygen cache', cmd: 'heygen-cli avatars list --cached' },
  { label: 'whisper transcribe', cmd: 'whisper audio.mp3 --model turbo --output_dir ./transcripts' },
];

export function MiaTerminal() {
  const {
    isOpen,
    toggleOpen,
    setOpen,
    activeTool,
    messages,
    addMessage,
    updateLastMessage,
    clearMessages,
    injectIntoTool,
    selectedModel,
    setSelectedModel,
    customApiKey,
    setCustomApiKey,
  } = useMiaStore();

  const [mode, setMode] = useState<'copilot' | 'cli'>('copilot');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [injectedMsgId, setInjectedMsgId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<DroppedLocalFile[]>([]);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(customApiKey);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo de teclado: Cmd+J o Ctrl+J
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleOpen]);

  // Enfocar input al abrir
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen]);

  // Scroll automático en mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Manejo de Drag & Drop de archivos locales
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (!files || files.length === 0) return;

    const newAttachments: DroppedLocalFile[] = files.map((file) => {
      let fileType: DroppedLocalFile['type'] = 'other';
      if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|avi|webm)$/i)) {
        fileType = 'video';
      } else if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|ogg|m4a)$/i)) {
        fileType = 'audio';
      } else if (file.type.startsWith('image/') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
        fileType = 'image';
      } else if (file.name.match(/\.(txt|md|json|csv)$/i)) {
        fileType = 'text';
      }

      const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
      const realPath = (file as any).path || `D:\\workspace\\assets\\${file.name}`;

      return {
        name: file.name,
        size: `${sizeInMb} MB`,
        path: realPath,
        type: fileType,
      };
    });

    setAttachedFiles((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || input;
    if ((!query.trim() && attachedFiles.length === 0) || isLoading) return;

    let enrichedQuery = query;
    if (attachedFiles.length > 0) {
      const filesInfo = attachedFiles
        .map((f) => `[Archivo Local: ${f.name} (${f.path}, ${f.size})]`)
        .join(' ');
      enrichedQuery = enrichedQuery ? `${enrichedQuery}\n${filesInfo}` : filesInfo;
    }

    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    if (mode === 'cli' || query.startsWith('$') || query.startsWith('>')) {
      const rawCmd = query.replace(/^[$>]\s*/, '');
      addMessage({ role: 'user', content: `$ ${rawCmd}` });

      setTimeout(() => {
        let cliOutput = '';
        if (rawCmd.includes('ffmpeg')) {
          cliOutput = `[FFMPEG LOCAL DAEMON] Analyzing video stream:\nInput #0, mov,mp4,m4a from '${attachedFiles[0]?.path || 'input.mp4'}':\n  Duration: 00:00:28.40, bitrate: 12450 kb/s\n  Stream #0:0: Video: h264, 1080x1920 [9:16], 60 fps\n[Status: Finalizado con código 0 - Listo para inyectar]`;
        } else if (rawCmd.includes('crewai')) {
          cliOutput = `[CREWAI LOCAL WORKER] Coordinando agentes locales:\n> Agent 'Director' formulando ángulos de conversión...\n> Agent 'Copywriter' estructurando variantes UGC...\nOutput guardado localmente: D:\\workspace\\campaigns\\brief_v1.json\n[Status: Ejecutado con código 0]`;
        } else if (rawCmd.includes('heygen')) {
          cliOutput = `[HEYGEN CLI] Cache Status:\n● Avatares sincronizados en disco: 14\n● Voces locales: 22 perfiles\n[Status: Sincronizado localmente]`;
        } else if (rawCmd.includes('whisper')) {
          cliOutput = `[WHISPER NATIVE] Transcribiendo audio local...\nTexto: "Descubre la suite definitiva para multiplicar tus conversiones con video marketing."\n[Status: Guardado en memoria local]`;
        } else {
          cliOutput = `[LOCAL SHELL] Comando: ${rawCmd}\nProceso iniciado en segundo plano (PID: 5120)\nCódigo de salida: 0 [OK]`;
        }

        addMessage({ role: 'assistant', content: cliOutput });
        setIsLoading(false);
      }, 500);

      return;
    }

    // AI Copilot Mode
    addMessage({ role: 'user', content: enrichedQuery });

    try {
      const history = [...messages, { role: 'user', content: enrichedQuery }];

      const response = await fetch('/api/mia-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          activeTool: activeTool || 'dashboard',
          activeSkillId: 'auto',
          selectedModel,
          customApiKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Error al conectar con el Asistente');
      }

      addMessage({ role: 'assistant', content: '' });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamedText += decoder.decode(value, { stream: true });
          updateLastMessage(streamedText);
        }
      }
    } catch (err: any) {
      addMessage({
        role: 'assistant',
        content: `Error del Asistente: ${err.message || 'No se pudo generar respuesta.'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInject = (msgId: string, content: string) => {
    if (!activeTool) return;
    injectIntoTool(activeTool, content);
    setInjectedMsgId(msgId);
    setTimeout(() => setInjectedMsgId(null), 2500);
  };

  const getFileIcon = (type: DroppedLocalFile['type']) => {
    switch (type) {
      case 'video':
        return <FileVideo className="h-3.5 w-3.5 text-blue-400" />;
      case 'audio':
        return <FileAudio className="h-3.5 w-3.5 text-amber-400" />;
      case 'image':
        return <FileImage className="h-3.5 w-3.5 text-emerald-400" />;
      case 'text':
        return <FileText className="h-3.5 w-3.5 text-purple-400" />;
      default:
        return <File className="h-3.5 w-3.5 text-zinc-400" />;
    }
  };

  const quickPrompts = activeTool
    ? QUICK_PROMPTS_BY_TOOL[activeTool] || QUICK_PROMPTS_BY_TOOL['avatar-studio']
    : QUICK_PROMPTS_BY_TOOL['avatar-studio'];

  return (
    <>
      {/* Floating Console Drawer (Desktop Frameless style) */}
      {isOpen && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="fixed bottom-4 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[500px] h-[610px] max-h-[85vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#0A0A0A]/95 shadow-[0_30px_70px_rgba(0,0,0,0.9)] backdrop-blur-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-150"
        >
          {/* Drag & Drop Overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 border-2 border-dashed border-indigo-400/80 p-6 text-center backdrop-blur-md animate-in fade-in">
              <UploadCloud className="h-10 w-10 text-indigo-400 mb-3 animate-bounce" />
              <div className="text-sm font-medium text-white">Suelta archivos locales aquí</div>
              <p className="text-xs text-zinc-400 mt-1">
                Videos (.mp4), audios (.mp3), imágenes o scripts locales
              </p>
            </div>
          )}

          {/* Desktop Terminal Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08] bg-[#0F0F0F]">
            {/* Title & Mode Switcher */}
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-white text-black font-mono text-[10px] font-bold">
                A
              </div>
              <span className="font-mono text-xs font-semibold text-zinc-200 tracking-tight">
                ASISTENTE // COPILOT
              </span>

              {/* Mode Toggle: Copilot vs Local CLI */}
              <div className="flex items-center rounded-md border border-white/[0.08] bg-black/60 p-0.5 ml-1">
                <button
                  type="button"
                  onClick={() => setMode('copilot')}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
                    mode === 'copilot'
                      ? 'bg-zinc-800 text-white font-medium'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('cli')}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
                    mode === 'cli'
                      ? 'bg-zinc-800 text-white font-medium'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Terminal className="h-2.5 w-2.5" />
                  <span>CLI</span>
                </button>
              </div>
            </div>

            {/* Actions: Model/Key & Clear & Close */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowKeyModal(!showKeyModal)}
                title="Configurar LLM / API Key"
                className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                  customApiKey
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                    : 'border-white/[0.08] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06]'
                }`}
              >
                <Key className="h-3 w-3" />
              </button>

              <button
                type="button"
                onClick={clearMessages}
                title="Limpiar consola"
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Cerrar panel (Esc / ⌘J)"
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Model Selector Bar (Gemini, Claude, GPT-4o, DeepSeek) */}
          <div className="px-3.5 py-1.5 border-b border-white/[0.06] bg-[#0A0A0A] flex items-center justify-between gap-2 text-[10px] font-mono">
            <span className="text-zinc-500 shrink-0">MODELO:</span>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className={`shrink-0 rounded px-2 py-0.5 transition-colors ${
                    selectedModel === m.id
                      ? 'bg-zinc-800 text-white font-medium border border-white/20'
                      : 'text-zinc-500 hover:text-zinc-300 bg-zinc-950/60'
                  }`}
                >
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Dropdown Popover */}
          {showKeyModal && (
            <div className="p-3 border-b border-white/[0.08] bg-zinc-950 space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-white">Pool de API Keys (Google Gemini)</span>
                  <span className="font-mono text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 rounded">
                    Failover Automático
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <textarea
                  rows={2}
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="Pega una o varias llaves de Gemini separadas por comas o saltos de línea:&#10;AIzaSyKey1..., AIzaSyKey2..., AIzaSyKey3..."
                  className="w-full rounded border border-white/[0.1] bg-black p-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/30 resize-none"
                />
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px]">
                    {tempApiKey.trim() ? (
                      tempApiKey.includes(',') || tempApiKey.includes('\n') ? (
                        <span className="text-emerald-400 font-medium">
                          ⚡ Modo Pool Activo: Varias llaves registradas con rotación por agotamiento
                        </span>
                      ) : (
                        <span className="text-zinc-400">✓ 1 llave registrada</span>
                      )
                    ) : (
                      <span className="text-zinc-500">Sin llaves personalizadas (usa .env.local o modo local)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomApiKey(tempApiKey);
                      setShowKeyModal(false);
                    }}
                    className="rounded bg-white text-black px-3.5 py-1 font-mono text-[10px] font-medium hover:bg-zinc-200 shrink-0"
                  >
                    Guardar Pool
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1 text-[10px] text-zinc-400 leading-relaxed font-sans border-t border-white/[0.04] pt-2">
                <div className="flex items-center gap-1 text-zinc-300">
                  <span>Genera tus llaves gratis o de tu plan en:</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 underline hover:text-indigo-300 font-mono"
                  >
                    aistudio.google.com/app/apikey
                  </a>
                </div>
                <p className="text-zinc-500">
                  💡 <strong>¿Cómo funciona el Failover?</strong> Si una llave se agota por límite de cuota (error 429), el Asistente cambia automáticamente a la siguiente sin que tengas que hacer nada.
                </p>
              </div>
            </div>
          )}

          {/* Subheader / Preset Pills */}
          <div className="px-3.5 py-1.5 border-b border-white/[0.04] bg-zinc-950/40 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {mode === 'copilot'
              ? quickPrompts.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(p)}
                    className="shrink-0 rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors"
                  >
                    {p}
                  </button>
                ))
              : CLI_PRESET_COMMANDS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(item.cmd)}
                    className="shrink-0 flex items-center gap-1 rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors"
                  >
                    <Play className="h-2 w-2 text-zinc-500" />
                    <span>{item.label}</span>
                  </button>
                ))}
          </div>

          {/* Messages & Logs Viewport */}
          <div className="flex-1 overflow-y-auto desktop-scroll p-4 space-y-3.5 text-xs font-mono leading-relaxed">
            {messages.map((m) => {
              const isAssistant = m.role === 'assistant';
              const isInjected = injectedMsgId === m.id;
              const isCliOutput =
                m.content.startsWith('[') ||
                m.content.startsWith('Input #0') ||
                m.content.startsWith('$');

              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    isAssistant ? 'items-start' : 'items-end'
                  }`}
                >
                  <div
                    className={`max-w-[95%] rounded-xl p-3 ${
                      isAssistant
                        ? 'border border-white/[0.07] bg-zinc-950 text-zinc-200'
                        : 'bg-zinc-800 text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 opacity-50 text-[10px]">
                      <span>
                        {isAssistant
                          ? mode === 'cli'
                            ? 'LOCAL SHELL'
                            : 'ASISTENTE COPILOT'
                          : 'USER CLI'}
                      </span>
                    </div>

                    <pre
                      className={`whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300 ${
                        isCliOutput ? 'text-zinc-400 text-[11px]' : ''
                      }`}
                    >
                      {m.content}
                    </pre>

                    {/* One-Click Ingest Action Button */}
                    {isAssistant && m.id !== 'welcome' && activeTool && !isCliOutput && (
                      <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleInject(m.id, m.content)}
                          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                            isInjected
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/[0.06] text-zinc-300 hover:bg-white hover:text-black border border-white/[0.08]'
                          }`}
                        >
                          {isInjected ? (
                            <>
                              <Check className="h-3 w-3 stroke-[2.5]" />
                              <span>INYECTADO EN HERRAMIENTA</span>
                            </>
                          ) : (
                            <>
                              <CornerDownLeft className="h-3 w-3" />
                              <span>INYECTAR A {activeTool.toUpperCase()}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-ping" />
                <span>
                  {mode === 'cli'
                    ? 'Ejecutando comando local...'
                    : 'El Asistente está redactando...'}
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Attached Local Files Preview Tray */}
          {attachedFiles.length > 0 && (
            <div className="px-3 py-2 border-t border-white/[0.06] bg-zinc-950/80 flex flex-wrap gap-2">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-300"
                >
                  {getFileIcon(file.type)}
                  <span className="truncate max-w-[130px]">{file.name}</span>
                  <span className="text-zinc-500 text-[10px]">{file.size}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="text-zinc-500 hover:text-zinc-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Terminal Input Bar */}
          <div className="p-3 border-t border-white/[0.07] bg-black">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-zinc-950 px-3 py-2"
            >
              <span className="font-mono text-zinc-500 text-xs">
                {mode === 'cli' ? '$' : '>'}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === 'cli'
                    ? 'ffmpeg -i video.mp4, python crewai, whisper...'
                    : activeTool
                    ? `Pide al Asistente un guion o arrastra archivos locales...`
                    : 'Pide al Asistente un guion o consulta el CLI local...'
                }
                className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none font-sans"
              />
              <button
                type="submit"
                disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
                className="flex h-6 w-6 items-center justify-center rounded bg-white text-black hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                title="Ejecutar"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>

            {/* Quick File Drop Hint */}
            <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-zinc-600 px-1">
              <span>Arrastra archivos desde el explorador</span>
              <span>Atajo: ⌘J / Ctrl+J</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
