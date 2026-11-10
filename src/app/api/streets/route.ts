import { NextResponse } from 'next/server';
import { getNetwork } from '@/lib/server/streets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/streets -> the routing network (real OSM streets + simulated accessibility layer) */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1' && process.env.NODE_ENV !== 'production';
  try {
    const net = await getNetwork(refresh);
    return NextResponse.json(net, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Street data did not load' }, { status: 503 });
  }
}
