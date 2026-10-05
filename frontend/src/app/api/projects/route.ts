import { NextRequest, NextResponse } from 'next/server';
import {
  getAllProjects,
  saveProject,
  deleteProject,
  checkProjectExists,
  sanitizeProjectName,
} from '@/lib/storage/project-storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const projects = await getAllProjects();
    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al listar proyectos' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, name, data, overwrite = false } = body;

    if (!category || !name) {
      return NextResponse.json(
        { error: 'Faltan parámetros requeridos (category y name)' },
        { status: 400 }
      );
    }

    const safeName = sanitizeProjectName(name);
    if (!safeName) {
      return NextResponse.json(
        { error: 'El nombre del proyecto contiene caracteres inválidos' },
        { status: 400 }
      );
    }

    // Verificar si ya existe para evitar sobrescribir accidentalmente
    const exists = await checkProjectExists(category, safeName);
    if (exists && !overwrite) {
      return NextResponse.json(
        {
          error: `Ya existe un proyecto con el nombre "${safeName}" en la carpeta ${category}. Elige otro nombre o confirma sobrescribir.`,
          conflict: true,
          existingName: safeName,
        },
        { status: 409 }
      );
    }

    const result = await saveProject(category, safeName, data || {});
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al guardar proyecto' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const name = searchParams.get('name');

    if (!category || !name) {
      return NextResponse.json(
        { error: 'category y name son requeridos en query params' },
        { status: 400 }
      );
    }

    const deleted = await deleteProject(category, name);
    return NextResponse.json({ success: deleted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al eliminar proyecto' }, { status: 500 });
  }
}
