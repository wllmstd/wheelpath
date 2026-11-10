// Refreshes data/osm-snapshot.json from the public Overpass servers (with retries).
// Usage: npm run fetch-streets
import { writeFile, mkdir } from 'node:fs/promises';

const LAT = 14.69198, LNG = 120.96665, R = 750;
const UA = process.env.OVERPASS_USER_AGENT || 'WheelPath/0.1 (accessibility research prototype, Valenzuela City)';
const ll = `${LAT},${LNG}`;
const hw = '^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|path|steps|track|primary_link|secondary_link|tertiary_link|trunk_link)$';
const am = '^(school|college|kindergarten|university|library|pharmacy|clinic|hospital|doctors|townhall|community_centre|place_of_worship|marketplace|bank|bus_station|restaurant|fast_food|cafe)$';
const q = `[out:json][timeout:90];(way["highway"~"${hw}"](around:${R},${ll}););out geom tags;(nwr["amenity"~"${am}"]["name"](around:${R},${ll});nwr["shop"~"^(supermarket|convenience|bakery|mall)$"]["name"](around:${R},${ll});nwr["office"="government"]["name"](around:${R},${ll}););out center tags;`;
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

let wait = 10;
for (let attempt = 1; attempt <= 6; attempt++) {
  for (const url of MIRRORS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(100000) });
      const t = await r.text();
      const o = JSON.parse(t);
      if (!Array.isArray(o.elements) || !o.elements.length || /error|timed out/i.test(o.remark || '')) throw new Error('no usable data');
      await mkdir('data', { recursive: true });
      await writeFile('data/osm-snapshot.json', t);
      console.log(`Saved ${o.elements.length} elements from ${new URL(url).host} to data/osm-snapshot.json`);
      process.exit(0);
    } catch (e) { console.log(`${new URL(url).host}: ${e.message.slice(0, 80)}`); }
  }
  console.log(`All servers busy. Waiting ${wait}s (attempt ${attempt}/6)…`);
  await new Promise((r) => setTimeout(r, wait * 1000)); wait = Math.min(wait * 2, 120);
}
console.error('Could not download street data. Try again later.');
process.exit(1);
