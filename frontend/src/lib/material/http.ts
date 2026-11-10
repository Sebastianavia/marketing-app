import { NextResponse } from 'next/server';
import { ForbiddenError } from '@/lib/director/local-guard';
import { MaterialError } from '@/lib/material/material';
import { errorMessage } from '@/lib/errors';

export function materialError(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof MaterialError) return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json({ error: errorMessage(err, fallback) }, { status: 500 });
}
