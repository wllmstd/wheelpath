/* SERVER ONLY. Loads OpenStreetMap street data for the focus area and builds the network.
   Order: data/osm-snapshot.json (committed with the app) -> on-disk cache -> public Overpass servers.
   Requests identify the app with a User-Agent, as the Overpass servers require. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AREA } from '@/lib/config';
import { buildNetwork, type OsmJson } from '@/lib/engine/build';
import type { Network } from '@/lib/engine/types';

const SNAPSHOT = path.join(process.cwd(), 'data', 'osm-snapshot.json');
const CACHE_DIR = process.env.WHEELPATH_CACHE_DIR || path.join(os.tmpdir(), 'wheelpath');
const CACHE = path.join(CACHE_DIR, 'osm-streets.json');
const CACHE_DAYS = 7;
const UA = process.env.OVERPASS_USER_AGENT || 'WheelPath/0.1 (accessibility research prototype, Valenzuela City)';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

export function overpassQuery(lat = AREA.lat, lng = AREA.lng, r = AREA.roadRadius): string {
  const ll = `${lat},${lng}`;
  const hw = '^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|path|steps|track|primary_link|secondary_link|tertiary_link|trunk_link)$';
  const am = '^(school|college|kindergarten|university|library|pharmacy|clinic|hospital|doctors|townhall|community_centre|place_of_worship|marketplace|bank|bus_station|restaurant|fast_food|cafe)$';
  return `[out:json][timeout:90];(way["highway"~"${hw}"](around:${r},${ll}););out geom tags;` +
    `(nwr["amenity"~"${am}"]["name"](around:${r},${ll});nwr["shop"~"^(supermarket|convenience|bakery|mall)$"]["name"](around:${r},${ll});nwr["office"="government"]["name"](around:${r},${ll}););out center tags;`;
}

function valid(o: unknown): o is OsmJson {
  const j = o as OsmJson;
  return !!j && Array.isArray(j.elements) && j.elements.length > 0 && !(j.remark && /error|timed out|out of memory/i.test(j.remark));
}
async function readJson(file: string, maxAgeDays?: number): Promise<OsmJson | null> {
  try {
    if (maxAgeDays != null) { const st = await fs.stat(file); if (Date.now() - st.mtimeMs > maxAgeDays * 864e5) return null; }
    const o = JSON.parse(await fs.readFile(file, 'utf8'));
    return valid(o) ? o : null;
  } catch { return null; }
}

export async function fetchOverpass(): Promise<{ osm: OsmJson; host: string }> {
  const body = new URLSearchParams({ data: overpassQuery() }).toString(), errors: string[] = [];
  for (const url of MIRRORS) {
    const host = new URL(url).host;
    try {
      const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(100_000), cache: 'no-store' });
      if (!r.ok) { errors.push(`${host} answered ${r.status}`); continue; }
      const text = await r.text();
      let o: unknown; try { o = JSON.parse(text); } catch { errors.push(`${host} sent a page instead of data`); continue; }
      if (!valid(o)) { errors.push(`${host} sent no usable data`); continue; }
      return { osm: o, host };
    } catch (e) { errors.push(`${host} ${(e as Error).name === 'TimeoutError' ? 'took too long' : (e as Error).message}`); }
  }
  throw new Error(errors.join(' · '));
}

let memo: Promise<Network> | null = null;

async function load(): Promise<Network> {
  const opts = { name: AREA.name, street: AREA.street, lng: AREA.lng, lat: AREA.lat, dataRadius: AREA.dataRadius };
  const snap = await readJson(SNAPSHOT);
  if (snap) return buildNetwork(snap, { ...opts, source: 'snapshot file (data/osm-snapshot.json)' });
  const cached = await readJson(CACHE, CACHE_DAYS);
  if (cached) return buildNetwork(cached, { ...opts, source: 'server cache' });
  try {
    const { osm, host } = await fetchOverpass();
    try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(CACHE, JSON.stringify(osm)); } catch { /* read-only filesystem: fine */ }
    return buildNetwork(osm, { ...opts, source: host });
  } catch (e) {
    const stale = await readJson(CACHE);
    if (stale) return buildNetwork(stale, { ...opts, source: 'server cache (older than 7 days)' });
    throw e;
  }
}

/** The network is built once per server process and reused. */
export function getNetwork(refresh = false): Promise<Network> {
  if (refresh) memo = null;
  if (!memo) memo = load().catch((e) => { memo = null; throw e; });
  return memo;
}
