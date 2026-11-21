import { NextResponse } from 'next/server';
import { isStatus } from '@/lib/reports';
import { getSession } from '@/lib/server/session';
import { errorResponse, getStore } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/reports[?status=pending] -> every report, newest first (admin only) */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== 'admin') return NextResponse.json({ error: 'Admins only. Sign in as admin@wheelpath.com.' }, { status: 401 });
  try {
    const st = new URL(req.url).searchParams.get('status');
    const store = getStore();
    const reports = await store.list(isStatus(st) ? { status: st } : {});
    return NextResponse.json({ reports, storage: store.kind }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
