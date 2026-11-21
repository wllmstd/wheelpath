import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PHOTO_DIR } from '@/lib/server/store';

export const runtime = 'nodejs';
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** photos of the local development store (Supabase serves its own photo URLs) */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const m = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.exec(name);
  if (!m) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(path.join(PHOTO_DIR, name));
    return new Response(new Uint8Array(data), { headers: { 'Content-Type': TYPES[m[1].toLowerCase()], 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
