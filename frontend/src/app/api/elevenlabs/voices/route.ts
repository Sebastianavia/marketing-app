import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PREMADE_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'Conversacional / Calma', category: 'premade' },
  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', style: 'Publicitario / Enérgico', category: 'premade' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', style: 'Narrativa / Juvenil', category: 'premade' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'Comercial / Cercana', category: 'premade' },
];

export async function GET() {
  try {
    // Sincronizar de forma proactiva con ElevenLabs y purgar registros fantasma
    const { storedVoices } = await elevenLabsService.syncAndGetVoices();
    const configuredVoice = await elevenLabsService.getConfiguredVoiceMetadata();

    // Construcción de la lista consolidada de voces disponibles
    const combinedVoices: Array<{
      id: string;
      name: string;
      style: string;
      category: 'configured' | 'cloned' | 'premade';
      isDefault?: boolean;
    }> = [];

    // 1. Voz clonada configurada en el entorno (Prioridad Máxima)
    if (configuredVoice) {
      combinedVoices.push({
        id: configuredVoice.id,
        name: configuredVoice.name || 'Mi Voz Clonada Oficial',
        style: 'Voz Clonada Principal (Recomendada)',
        category: 'configured',
        isDefault: true,
      });
    }

    // 2. Otras voces clonadas locales que no sean la configurada
    for (const v of storedVoices) {
      if (!configuredVoice || v.id !== configuredVoice.id) {
        combinedVoices.push({
          id: v.id,
          name: v.name,
          style: v.description || 'Voz Clonada Personalizada',
          category: 'cloned',
        });
      }
    }

    // 3. Voces predeterminadas de ElevenLabs
    for (const p of PREMADE_VOICES) {
      if (!combinedVoices.some((v) => v.id === p.id)) {
        combinedVoices.push({
          id: p.id,
          name: p.name,
          style: p.style,
          category: 'premade',
        });
      }
    }

    return NextResponse.json(
      {
        isConfigured: elevenLabsService.isConfigured,
        configuredVoiceId: configuredVoice?.id || null,
        configuredVoice,
        voices: combinedVoices,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al listar las voces disponibles.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let voiceId = searchParams.get('id') || searchParams.get('voiceId');

    if (!voiceId) {
      const body = await req.json().catch(() => ({}));
      voiceId = body.voiceId || body.id;
    }

    if (!voiceId || typeof voiceId !== 'string') {
      return NextResponse.json(
        { error: 'El parámetro voiceId es obligatorio para eliminar una voz.' },
        { status: 400 }
      );
    }

    const result = await elevenLabsService.deleteVoice(voiceId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API ElevenLabs Delete Voice Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error al eliminar la voz de ElevenLabs.' },
      { status: 500 }
    );
  }
}
