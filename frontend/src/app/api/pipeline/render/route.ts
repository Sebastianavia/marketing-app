import { NextRequest } from 'next/server';
import { UgcPipelineMasterOrchestrator } from '@/services/pipeline/ugc-pipeline.service';
import { UgcPipelineExecutionInput } from '@/types/pipeline.types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutos máximo de ejecución en servidor

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      script,
      avatarImageUrl,
      voiceId,
      aspectRatio = '9:16',
      projectName,
      elevenLabsKey,
      openRouterKey,
    } = body;

    if (!script || !avatarImageUrl) {
      return new Response(
        JSON.stringify({ error: 'script y avatarImageUrl son requeridos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const input: UgcPipelineExecutionInput = {
      script,
      avatarImageUrl,
      voiceId,
      aspectRatio,
      projectName,
    };

    const orchestrator = new UgcPipelineMasterOrchestrator({
      elevenLabsKey,
      openRouterKey,
    });

    // Crear stream SSE (Server-Sent Events) para transmitir el progreso en tiempo real al hook
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const sendEvent = async (data: any) => {
      try {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        await writer.write(encoder.encode(payload));
      } catch (err) {
        console.warn('[SSE Pipeline] Error emitiendo evento:', err);
      }
    };

    // Iniciar ejecución asíncrona desacoplada
    (async () => {
      try {
        const result = await orchestrator.executePipeline(input, async (progress) => {
          await sendEvent(progress);
        });

        await sendEvent({
          type: 'DONE',
          result,
        });
      } catch (err: any) {
        await sendEvent({
          type: 'ERROR',
          error: err.message || 'Error en pipeline de renderizado',
          phase: err.phase || 'failed',
        });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
