import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectByPath } from '@/lib/storage/project-storage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const name = searchParams.get('name');
    const path = searchParams.get('path');

    let project = null;

    if (path) {
      project = await getProjectByPath(path);
    } else if (category && name) {
      project = await getProject(category, name);
    } else {
      return NextResponse.json(
        { error: 'Debes proporcionar (category y name) o la ruta del proyecto (path)' },
        { status: 400 }
      );
    }

    if (!project) {
      return NextResponse.json(
        { error: 'Proyecto no encontrado en disco' },
        { status: 404 }
      );
    }

    // Generar avisos multimedia si los archivos faltan
    const mediaWarnings: string[] = [];
    if (!project.mediaAvailable?.image) {
      mediaWarnings.push(
        'El archivo de retrato (imagen) no se encuentra en el disco local ni en la nube. Puedes seleccionar una nueva imagen sin perder tu guion.'
      );
    }

    if (project.audioMode === 'local' && !project.mediaAvailable?.audio) {
      mediaWarnings.push(
        'El archivo MP3 local asociado no fue encontrado en la carpeta de disco. Puedes seleccionar un nuevo archivo de audio o cambiar a síntesis por IA.'
      );
    }

    return NextResponse.json({ project, mediaWarnings });
  } catch (err: any) {
    console.error('Error al cargar proyecto:', err);
    return NextResponse.json(
      { error: err.message || 'Error al cargar el proyecto desde disco' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { category, name, path } = body;

    let project = null;
    if (path) {
      project = await getProjectByPath(path);
    } else if (category && name) {
      project = await getProject(category, name);
    }

    if (!project) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    const mediaWarnings: string[] = [];
    if (!project.mediaAvailable?.image) {
      mediaWarnings.push(
        'El archivo de imagen no está disponible en disco, pero el guion y la configuración se mantienen activos.'
      );
    }
    if (project.audioMode === 'local' && !project.mediaAvailable?.audio) {
      mediaWarnings.push(
        'El archivo de audio local no está disponible en disco. Selecciona un archivo MP3 o genera audio con ElevenLabs.'
      );
    }

    return NextResponse.json({ project, mediaWarnings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
