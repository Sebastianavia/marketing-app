import { NextRequest, NextResponse } from 'next/server';
import { heygenService, HeyGenApiError } from '@/services/heygen.service';
import { ElevenLabsService } from '@/services/elevenlabs/elevenlabs.service';
import { openRouterService } from '@/services/openrouter.service';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutos máximo

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // 1. Parámetros principales
    const imageFile = formData.get('image') as File | null;
    const audioMode = (formData.get('audioMode') as string) || 'generar';
    const prompt = (formData.get('prompt') as string) || '';
    let scriptText = (formData.get('scriptText') as string) || '';
    const voiceId = (formData.get('voiceId') as string) || '21m00Tcm4TlvDq8ikWAM';
    const localAudioFile = formData.get('audioFile') as File | null;
    const aspectRatio = (formData.get('aspectRatio') as '9:16' | '16:9') || '9:16';
    const existingPhotoId = formData.get('talkingPhotoId') as string | null;

    if (!imageFile && !existingPhotoId) {
      return NextResponse.json(
        { error: 'Debes proporcionar una foto (.jpg/.png) para el Talking Photo.' },
        { status: 400 }
      );
    }

    // 2. Módulo de Texto: Si el usuario solicitó generar o no tiene guion, llamar a OpenRouter
    if (audioMode === 'generar' && !scriptText.trim()) {
      if (!prompt.trim()) {
        return NextResponse.json(
          { error: 'Se requiere una idea o prompt para que OpenRouter redacte el guion.' },
          { status: 400 }
        );
      }

      const scriptResponse = await openRouterService.generateMarketingScript({
        productName: prompt.slice(0, 40),
        productDescription: prompt,
        targetAudience: 'Audiencia general de video marketing',
        keyBenefit: prompt,
        format: 'ugc_testimonial',
      });
      scriptText = scriptResponse.fullSpokenText || scriptResponse.coreHook;
    }

    // 3. Módulo de Audio Condicional
    let audioBuffer: Buffer;

    if (audioMode === 'generar') {
      const elevenLabs = new ElevenLabsService();
      const ttsResult = await elevenLabs.synthesizeSpeech({
        text: scriptText,
        voiceId,
      });
      audioBuffer = ttsResult.buffer;
    } else {
      if (!localAudioFile) {
        return NextResponse.json(
          { error: 'En modo local debes subir un archivo de audio .mp3' },
          { status: 400 }
        );
      }
      const arrayBuf = await localAudioFile.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);
    }

    // 4. Módulo de Carga: Subir Imagen a HeyGen (si no tiene assetId previo)
    let talkingPhotoId = existingPhotoId;
    if (!talkingPhotoId && imageFile) {
      const imgArrayBuf = await imageFile.arrayBuffer();
      const imgBuffer = Buffer.from(imgArrayBuf);
      talkingPhotoId = await heygenService.uploadTalkingPhoto(
        imgBuffer,
        imageFile.type || 'image/jpeg'
      );
    }

    // 5. Módulo de Carga: Subir Audio a HeyGen
    const audioAssetId = await heygenService.uploadAudioAsset(audioBuffer);

    // 6. Módulo de Video: Despachar orden Talking Photo Lip-Sync
    const width = aspectRatio === '9:16' ? 1080 : 1920;
    const height = aspectRatio === '9:16' ? 1920 : 1080;

    const generatePayload = {
      title: `TalkingPhoto_${Date.now()}`,
      video_inputs: [
        {
          character: {
            type: 'talking_photo' as const,
            talking_photo_id: talkingPhotoId!,
            talking_photo_style: 'normal',
          },
          voice: {
            type: 'audio' as const,
            audio_asset_id: audioAssetId,
          },
          background: {
            type: 'color' as const,
            value: '#000000',
          },
        },
      ],
      dimension: { width, height },
      aspect_ratio: aspectRatio,
    };

    const heygenResponse = await heygenService.generateAvatarVideo(generatePayload as any);

    return NextResponse.json({
      success: true,
      video_id: heygenResponse.video_id,
      talking_photo_id: talkingPhotoId,
      audio_asset_id: audioAssetId,
      script_text: scriptText,
    });
  } catch (error: any) {
    const err = error as HeyGenApiError;
    return NextResponse.json(
      {
        error: err.message || 'Error en el pipeline de Talking Photo',
        details: err.details,
      },
      { status: err.statusCode || 500 }
    );
  }
}
