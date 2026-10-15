import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Indica si la conexión MCP con Buzzy está configurada (sin exponer los valores). */
export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.BUZZY_MCP_URL?.trim()),
    hasToken: Boolean(process.env.BUZZY_MCP_TOKEN?.trim()),
  });
}
