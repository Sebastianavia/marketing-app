import { NextRequest, NextResponse } from 'next/server';
import { checkProjectExists, sanitizeProjectName } from '@/lib/storage/project-storage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const name = searchParams.get('name');

    if (!category || !name) {
      return NextResponse.json({ exists: false, sanitizedName: '' });
    }

    const sanitizedName = sanitizeProjectName(name);
    const exists = await checkProjectExists(category, sanitizedName);

    return NextResponse.json({ exists, sanitizedName });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
