import { NextRequest, NextResponse } from 'next/server';
import { Storyboard, StudioSettings, UgcReference } from '@/types/ugc-studio.types';
import { errorMessage } from '@/lib/errors';
import { sendToClaudeEditor } from '@/lib/editor/claude-handoff';
import { AssembleError, assembleStoryboard } from '@/services/ugc-studio/assemble.service';

/** Con "Claude · mi suscripción", el video montado pasa al editor y Claude lo mejora a su criterio. */
function claudeEditRequest(sb: Storyboard, videoPath: string, name: string) {
  return sendToClaudeEditor({
    videoPath,
    titulo: `${name} · Claude`,
    pedido: `Este es un anuncio UGC ya montado (escenas generadas con IA y unidas). Revísalo y mejóralo a tu criterio para que quede listo para publicar: ritmo, subtítulos dinámicos, gancho al inicio, color y cierre con el CTA. No cortes frases del diálogo salvo errores evidentes ni cambies el sentido. Concepto: ${sb.concept}. Tono: ${sb.tone}. Gancho: ${sb.hook}. CTA: ${sb.cta}.`,
  });
}

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Une las escenas renderizadas en un MP4 final y lo guarda como proyecto UGC. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      storyboard: Storyboard;
      references: UgcReference[];
      settings: Partial<StudioSettings>;
      projectName?: string;
    };
    const r = await assembleStoryboard(body);
    const edicionClaude = await claudeEditRequest(body.storyboard, r.videoPath, r.name);
    return NextResponse.json({ videoUrl: r.videoUrl, project: r.project, trimmedSeconds: r.trimmedSeconds, edicionClaude });
  } catch (error) {
    if (error instanceof AssembleError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[UGC Studio Assemble]:', error);
    return NextResponse.json({ error: errorMessage(error, 'Error al ensamblar el video final.') }, { status: 500 });
  }
}
