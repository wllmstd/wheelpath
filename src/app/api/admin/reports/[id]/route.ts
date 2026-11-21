import { NextResponse } from 'next/server';
import { AREA } from '@/lib/config';
import { haversine } from '@/lib/engine/geo';
import { HAZARD_TYPES } from '@/lib/engine/rules';
import type { HazardType } from '@/lib/engine/types';
import { isHazardType, isSeverity, isStatus } from '@/lib/reports';
import { getSession } from '@/lib/server/session';
import { errorResponse, getStore, type ReportPatch } from '@/lib/server/store';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };
const denied = () => NextResponse.json({ error: 'Admins only. Sign in as admin@wheelpath.com.' }, { status: 401 });

/** PATCH { status?, type?, sev?, note?, admin_note?, lng?, lat? } -> approve, reject, mark fixed or edit */
export async function PATCH(req: Request, { params }: Ctx) {
  const s = await getSession();
  if (s?.role !== 'admin') return denied();
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const patch: ReportPatch = {};
  if (b.status !== undefined) { if (!isStatus(b.status)) return NextResponse.json({ error: 'Unknown status.' }, { status: 400 }); patch.status = b.status; patch.reviewed_at = new Date().toISOString(); patch.reviewed_by = s.email; }
  if (b.type !== undefined) { if (!isHazardType(b.type)) return NextResponse.json({ error: 'Unknown problem type.' }, { status: 400 }); const t: HazardType = b.type; patch.type = t; patch.title = HAZARD_TYPES[t].label; }
  if (b.sev !== undefined) { if (!isSeverity(b.sev)) return NextResponse.json({ error: 'Unknown severity.' }, { status: 400 }); patch.sev = b.sev; }
  if (b.note !== undefined) patch.note = String(b.note || '').trim().slice(0, 500) || null;
  if (b.admin_note !== undefined) patch.admin_note = String(b.admin_note || '').trim().slice(0, 500) || null;
  if (b.lng !== undefined || b.lat !== undefined) {
    const lng = Number(b.lng), lat = Number(b.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || haversine([lng, lat], [AREA.lng, AREA.lat]) > AREA.roadRadius + 200) return NextResponse.json({ error: 'That spot is outside the mapped area.' }, { status: 400 });
    patch.lng = lng; patch.lat = lat;
  }
  try {
    const row = await getStore().update(id, patch);
    return row ? NextResponse.json({ report: row }) : NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const s = await getSession();
  if (s?.role !== 'admin') return denied();
  const { id } = await params;
  try {
    return (await getStore().remove(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  } catch (e) { return errorResponse(e); }
}
