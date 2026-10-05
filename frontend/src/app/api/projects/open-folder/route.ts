import { NextRequest, NextResponse } from 'next/server';
import { openInExplorer } from '@/lib/storage/project-storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetPath = body.path;

    const opened = await openInExplorer(targetPath);
    return NextResponse.json({ success: opened });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
