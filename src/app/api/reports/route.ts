import { NextResponse } from 'next/server';
import { AREA } from '@/lib/config';
import { haversine } from '@/lib/engine/geo';
import { HAZARD_TYPES } from '@/lib/engine/rules';
import { isHazardType, isSeverity, toPublic } from '@/lib/reports';
import { getSession } from '@/lib/server/session';
import { errorResponse, getStore, type Photo } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_PHOTO = 6 * 1024 * 1024;

/** GET /api/reports            -> approved reports (shown on the map)
    GET /api/reports?ids=a,b     -> the caller's own reports, any status (ids are kept in their browser) */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const ids = new URL(req.url).searchParams.get('ids');
    const store = getStore();
    const rows = ids != null
      ? await store.list({ ids: ids.split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 100) })
      : await store.list({ status: 'approved' });
    return NextResponse.json({ reports: rows.map(toPublic) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}

function sniff(b: Buffer): Photo['ext'] | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** POST multipart/form-data: type, sev, lng, lat, note?, photo? -> a new report waiting for review */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in again to send a report.' }, { status: 401 });
  try {
    const f = await req.formData();
    const type = f.get('type'), sev = Number(f.get('sev')), lng = Number(f.get('lng')), lat = Number(f.get('lat'));
    const note = String(f.get('note') || '').trim().slice(0, 500);
    if (!isHazardType(type) || !isSeverity(sev)) return NextResponse.json({ error: 'Choose what the problem is and how bad it is.' }, { status: 400 });
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || haversine([lng, lat], [AREA.lng, AREA.lat]) > AREA.roadRadius + 200)
      return NextResponse.json({ error: 'That spot is outside the mapped area.' }, { status: 400 });
    let photo: Photo | null = null;
    const file = f.get('photo');
    if (file && typeof file !== 'string' && file.size > 0) {
      if (file.size > MAX_PHOTO) return NextResponse.json({ error: 'The photo is too large (6 MB at most).' }, { status: 413 });
      const data = Buffer.from(await file.arrayBuffer()), ext = sniff(data);
      if (!ext) return NextResponse.json({ error: 'The photo must be a JPEG, PNG or WebP image.' }, { status: 415 });
      photo = { data, ext, contentType: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
    }
    const row = await getStore().create({ type, sev, title: HAZARD_TYPES[type].label, note: note || null, lng, lat, reporter_name: s.name, reporter_email: s.email }, photo);
    return NextResponse.json({ report: toPublic(row) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
