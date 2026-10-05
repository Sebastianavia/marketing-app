'use client';

import { useState, useCallback, useRef } from 'react';
import {
  PipelinePhase,
  UgcPipelineExecutionInput,
  UgcPipelineFinalResult,
} from '@/types/pipeline.types';

export interface UseVideoPipelineState {
  isProcessing: boolean;
  currentPhase: PipelinePhase;
  phaseLabel: string;
  progressPercent: number;
  elapsedSeconds: number;
  taskId: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  error: string | null;
  result: UgcPipelineFinalResult | null;
}

const INITIAL_STATE: UseVideoPipelineState = {
  isProcessing: false,
  currentPhase: 'idle',
  phaseLabel: 'Listo para renderizar',
  progressPercent: 0,
  elapsedSeconds: 0,
  taskId: null,
  audioUrl: null,
  videoUrl: null,
  error: null,
  result: null,
};

export function useVideoPipeline() {
  const [state, setState] = useState<UseVideoPipelineState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const cancelPipeline = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        currentPhase: 'failed',
        phaseLabel: 'Cancelado por el usuario',
        error: 'El renderizado fue detenido.',
      }));
    }
  }, []);

  const startPipeline = useCallback(async (input: UgcPipelineExecutionInput) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setState({
      isProcessing: true,
      currentPhase: 'tts_generation',
      phaseLabel: 'Sintetizando voz neuronal con ElevenLabs...',
      progressPercent: 10,
      elapsedSeconds: 0,
      taskId: null,
      audioUrl: null,
      videoUrl: null,
      error: null,
      result: null,
    });

    try {
      const response = await fetch('/api/pipeline/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('La respuesta del servidor no tiene un flujo de datos legible.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine.startsWith('data: ')) {
            const rawJson = cleanLine.replace(/^data:\s*/, '');
            try {
              const event = JSON.parse(rawJson);

              if (event.type === 'ERROR') {
                throw new Error(event.error || 'Error reportado por el pipeline');
              }

              if (event.type === 'DONE') {
                setState((prev) => ({
                  ...prev,
                  isProcessing: false,
                  currentPhase: 'completed',
                  phaseLabel: '¡Renderizado completado con éxito!',
                  progressPercent: 100,
                  videoUrl: event.result.videoUrl,
                  audioUrl: event.result.audioUrl,
                  result: event.result,
                }));
                return;
              }

              // Evento de progreso estándar
              setState((prev) => ({
                ...prev,
                currentPhase: event.phase || prev.currentPhase,
                phaseLabel: event.phaseLabel || prev.phaseLabel,
                progressPercent: event.progressPercent ?? prev.progressPercent,
                elapsedSeconds: event.elapsedSeconds ?? prev.elapsedSeconds,
                taskId: event.taskId ?? prev.taskId,
                audioUrl: event.audioUrl ?? prev.audioUrl,
                videoUrl: event.videoUrl ?? prev.videoUrl,
              }));
            } catch (parseErr) {
              console.warn('[useVideoPipeline] Error parseando chunk SSE:', parseErr);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;

      setState((prev) => ({
        ...prev,
        isProcessing: false,
        currentPhase: 'failed',
        phaseLabel: 'Fallo en el pipeline',
        error: err.message || 'Error durante la ejecución del renderizado.',
      }));
    }
  }, []);

  return {
    ...state,
    startPipeline,
    cancelPipeline,
    reset,
  };
}
