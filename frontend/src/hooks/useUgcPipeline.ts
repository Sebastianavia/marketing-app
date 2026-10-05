'use client';

import { useState, useCallback, useRef } from 'react';
import { UgcPipelineInput, UgcPipelineState } from '@/types/ugc.types';
import { MarketingScriptOutput } from '@/types/openrouter.types';
import { HeyGenVideoStatusResponse } from '@/types/heygen.types';

export function useUgcPipeline() {
  const [state, setState] = useState<UgcPipelineState>({
    step: 'idle',
    progressPercent: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelPipeline = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setState((prev) => ({
        ...prev,
        step: 'idle',
        error: 'Pipeline cancelado por el usuario.',
      }));
    }
  }, []);

  const runPipeline = useCallback(async (input: UgcPipelineInput) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // ----------------------------------------------------
      // PASO 1: Generación de Guion con OpenRouter
      // ----------------------------------------------------
      setState({
        step: 'generating_script',
        progressPercent: 15,
      });

      const scriptResponse = await fetch('/api/openrouter/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: input.productName,
          productDescription: input.productDescription,
          targetAudience: input.targetAudience,
          keyBenefit: input.keyBenefit,
          format: input.format || 'ugc_testimonial',
        }),
        signal,
      });

      if (!scriptResponse.ok) {
        throw new Error('Fallo al generar el guion de marketing.');
      }

      const script: MarketingScriptOutput = await scriptResponse.json();

      setState((prev) => ({
        ...prev,
        step: 'script_ready',
        progressPercent: 40,
        script,
      }));

      // ----------------------------------------------------
      // PASO 2: Enviar Guion a HeyGen para Renderizado
      // ----------------------------------------------------
      setState((prev) => ({
        ...prev,
        step: 'rendering_video',
        progressPercent: 55,
      }));

      const generateVideoResponse = await fetch('/api/heygen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `UGC_${script.campaignTitle.substring(0, 30)}`,
          video_inputs: [
            {
              character: {
                type: 'avatar',
                avatar_id: input.avatarId || 'Daisy-inskirt-20220818',
                avatar_style: 'normal',
              },
              voice: {
                type: 'text',
                input_text: script.fullSpokenText,
                voice_id: input.voiceId || '2d5b0e6cf36f460aa7fc47e3eee4ba54',
              },
              background: {
                type: 'color',
                value: '#0F172A',
              },
            },
          ],
          dimension: { width: 1080, height: 1920 },
          aspect_ratio: '9:16',
        }),
        signal,
      });

      if (!generateVideoResponse.ok) {
        throw new Error('Fallo al despachar la orden de video a HeyGen.');
      }

      const { video_id }: { video_id: string } = await generateVideoResponse.json();

      setState((prev) => ({
        ...prev,
        heygenVideoId: video_id,
        progressPercent: 65,
      }));

      // ----------------------------------------------------
      // PASO 3: Polling de Estado de Renderizado
      // ----------------------------------------------------
      let isCompleted = false;
      while (!isCompleted) {
        if (signal.aborted) return;

        // Espera de 5 segundos entre consultas
        await new Promise((res) => setTimeout(res, 5000));

        const statusResponse = await fetch(`/api/heygen/status/${video_id}`, { signal });
        if (!statusResponse.ok) {
          throw new Error('Error consultando el estado del video en HeyGen.');
        }

        const statusData: HeyGenVideoStatusResponse['data'] = await statusResponse.json();

        if (statusData.status === 'completed') {
          isCompleted = true;
          setState((prev) => ({
            ...prev,
            step: 'completed',
            progressPercent: 100,
            videoStatus: 'completed',
            finalVideoUrl: statusData.video_url,
          }));
        } else if (statusData.status === 'failed') {
          throw new Error(statusData.error?.message || 'El renderizado del video falló en HeyGen.');
        } else {
          // Incremento suave del porcentaje durante el procesamiento
          setState((prev) => ({
            ...prev,
            videoStatus: statusData.status,
            progressPercent: Math.min(prev.progressPercent + 3, 95),
          }));
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: (err as Error).message || 'Error inesperado en el pipeline UGC.',
        }));
      }
    }
  }, []);

  return {
    state,
    runPipeline,
    cancelPipeline,
    isLoading: ['generating_script', 'rendering_video'].includes(state.step),
  };
}
