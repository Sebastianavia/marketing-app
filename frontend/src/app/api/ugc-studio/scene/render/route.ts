import { NextRequest, NextResponse } from 'next/server';
import { dispatchSceneRender, getActiveRender, planSceneRender } from '@/services/ugc-studio/scene-render.service';
import { sanitizeSettings, Storyboard, StudioSettings, UgcReference } from '@/types/ugc-studio.types';

export const runtime = 'nodejs';

interface RenderBody {
  storyboard: Storyboard;
  references: UgcReference[];
  settings: Partial<StudioSettings>;
  sceneId: string;
  /** false = solo estimar costo (sin gastar); true = el usuario confirmó el gasto */
  confirm?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RenderBody;
    const settings = sanitizeSettings(body.settings);
    const scene = body.storyboard?.scenes.find((s) => s.id === body.sceneId);
    if (!scene) return NextResponse.json({ error: 'Escena no encontrada.' }, { status: 404 });
    if (!scene.videoPrompt.trim()) return NextResponse.json({ error: 'La escena no tiene prompt de video.' }, { status: 400 });
    if (scene.status === 'draft') {
      return NextResponse.json({ error: 'Aprueba la escena antes de renderizarla.' }, { status: 409 });
    }

    const inFlight = getActiveRender(scene.id);
    if (inFlight) {
      return NextResponse.json(
        { error: 'Esta escena ya se está renderizando. Espera a que termine antes de lanzarla otra vez.', taskId: inFlight },
        { status: 409 }
      );
    }

    const plan = await planSceneRender(body.storyboard, scene, body.references ?? [], settings);
    if (!body.confirm) {
      return NextResponse.json({
        estimatedCostUSD: plan.estimatedCostUSD,
        ratePerSecondUSD: plan.ratePerSecondUSD,
        discount: plan.discount,
        livePricing: plan.livePricing,
        usesFirstFrame: Boolean(plan.firstFrameUrl),
        continuityReference: plan.continuityReference,
        referenceCount: plan.referenceUrls.length,
      });
    }

    const taskId = await dispatchSceneRender(body.storyboard, scene, plan, settings);
    return NextResponse.json({
      taskId,
      estimatedCostUSD: plan.estimatedCostUSD,
      usedFirstFrame: Boolean(plan.firstFrameUrl) || plan.continuityReference,
      usedReferences: plan.referenceUrls.length > 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error al renderizar la escena.' }, { status: 422 });
  }
}
