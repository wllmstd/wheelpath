/* Builds the routing network from OpenStreetMap (Overpass JSON).
   Street geometry and names are REAL. Every accessibility value (width, slope,
   surface, curb ramps), the hazards and the reports are SIMULATED,
   deterministically from OSM way IDs, and labelled as simulated. */
import { Engine } from './engine';
import { makeProjection, segProject } from './geo';
import { HAZARD_TYPES } from './rules';
import type { GEdge, GNode, Hazard, HazardType, LngLat, Network, Place, PlaceCat, Report, Severity, Surface } from './types';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
export interface OsmJson { elements: OsmElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } }

export interface BuildOptions { name: string; street: string; lng: number; lat: number; dataRadius: number; source: string }

function hash(a: number, b: number, c: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 1274126177 + 1013904223;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}

interface Pt { k: string; lon: number; lat: number; x: number; y: number }
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Douglas–Peucker on pts[i0..i1]; marks kept indices */
function dp(pts: Pt[], i0: number, i1: number, tol: number, keep: boolean[]) {
  if (i1 <= i0 + 1) return;
  let maxd = -1, idx = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const d = segProject(pts[i].x, pts[i].y, pts[i0].x, pts[i0].y, pts[i1].x, pts[i1].y).d;
    if (d > maxd) { maxd = d; idx = i; }
  }
  if (maxd > tol) { keep[idx] = true; dp(pts, i0, idx, tol, keep); dp(pts, idx, i1, tol, keep); }
}

const HW: Record<string, 1> = { trunk: 1, primary: 1, secondary: 1, tertiary: 1, unclassified: 1, residential: 1, living_street: 1, service: 1, pedestrian: 1, footway: 1, path: 1, steps: 1, track: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1, trunk_link: 1 };
const WIDTH: Record<string, [number, number]> = { trunk: [1.6, 2.4], primary: [1.5, 2.3], secondary: [1.4, 2.1], tertiary: [1.2, 1.9], unclassified: [1.0, 1.7], residential: [0.85, 1.6], living_street: [1.0, 1.7], service: [0.8, 1.3], pedestrian: [1.5, 2.4], footway: [1.0, 1.8], path: [0.8, 1.4], track: [0.8, 1.2], primary_link: [1.4, 2.0], secondary_link: [1.3, 1.9], tertiary_link: [1.2, 1.8], trunk_link: [1.4, 2.0] };
const CATMAP: Record<string, PlaceCat> = { school: 'school', college: 'school', kindergarten: 'school', university: 'school', library: 'gov', pharmacy: 'health', clinic: 'health', hospital: 'health', doctors: 'health', townhall: 'gov', community_centre: 'gov', place_of_worship: 'worship', marketplace: 'market', bank: 'bank', bus_station: 'transport', restaurant: 'food', fast_food: 'food', cafe: 'food', supermarket: 'market', convenience: 'market', bakery: 'food', mall: 'market' };

interface SeedHazard { x: number; y: number; type: HazardType; sev: Severity; title: string; author: string; days: number; ratings: number[]; comments: { who: string; text: string; ago: string }[] }
const SEED_HAZARDS: SeedHazard[] = [
  { x: -115, y: -45, type: 'pavement', sev: 2, title: 'Broken pavement near the school gate', author: 'Ana', days: 1, ratings: [1, 1, 2],
    comments: [{ who: 'Mario', text: 'Unsafe sidewalk!', ago: '2 days ago' }, { who: 'Liza', text: 'The sidewalk is too close to the road.', ago: '2 days ago' }, { who: 'Ben', text: 'The ramp is too steep.', ago: '3 days ago' }] },
  { x: 145, y: 95, type: 'drain', sev: 3, title: 'Open drain beside the road', author: 'Rico', days: 3, ratings: [1, 1], comments: [{ who: 'Rico', text: 'No cover at all. A front wheel would drop right in.', ago: '3 days ago' }] },
  { x: -75, y: 25, type: 'obstruction', sev: 3, title: 'Parked tricycles block the walkway', author: 'Nena', days: 5, ratings: [1, 2],
    comments: [{ who: 'Nena', text: 'Only about 0.8 m of space left. A wheelchair cannot pass.', ago: '5 days ago' }, { who: 'Paolo', text: 'Cleared in the morning, back by noon.', ago: '4 days ago' }] },
  { x: 65, y: -115, type: 'narrow', sev: 2, title: 'Pole narrows the sidewalk', author: 'Juan', days: 8, ratings: [2], comments: [] },
  { x: 205, y: -65, type: 'flood', sev: 1, title: 'Standing water after rain', author: 'Grace', days: 9, ratings: [3, 3], comments: [{ who: 'Grace', text: 'Drains slowly. Fine when dry.', ago: '9 days ago' }] },
  { x: -165, y: 70, type: 'ramp', sev: 2, title: 'Curb ramp is too steep', author: 'Eli', days: 12, ratings: [2, 2], comments: [] },
  { x: 265, y: 150, type: 'obstruction', sev: 2, title: 'Vendor cart on the walkway', author: 'Liza', days: 14, ratings: [2, 3], comments: [] },
  { x: -255, y: -145, type: 'pavement', sev: 1, title: 'Cracked slab, still passable', author: 'Paolo', days: 16, ratings: [3, 4], comments: [] },
  { x: 25, y: 270, type: 'drain', sev: 2, title: 'Loose drain cover', author: 'Mario', days: 18, ratings: [2], comments: [] },
];

export function buildNetwork(osm: OsmJson, o: BuildOptions): Network {
  const anchor = { lng: o.lng, lat: o.lat }, P = makeProjection(anchor), COV_R = o.dataRadius;
  const ways: OsmElement[] = [], pois: OsmElement[] = [];
  for (const e of osm.elements || []) {
    const t = e.tags || {};
    if (e.type === 'way' && e.geometry && e.geometry.length > 1 && t.highway) {
      if (!HW[t.highway] || t.foot === 'no' || t.area === 'yes') continue;
      if ((t.access === 'private' || t.access === 'no') && t.foot !== 'yes') continue;
      if (t.highway === 'service' && /^(driveway|parking_aisle|drive-through)$/.test(t.service || '')) continue;
      ways.push(e);
    } else if (t.name && (e.type === 'node' || e.center) && !t.highway) pois.push(e);
  }
  if (!ways.length) throw new Error('No streets were returned for this area');

  /* 1. vertex usage across ways (shared vertices are junctions) */
  const key = (g: { lat: number; lon: number }) => g.lon.toFixed(7) + ',' + g.lat.toFixed(7);
  const cnt: Record<string, number> = {};
  for (const w of ways) for (const g of w.geometry!) { const k = key(g); cnt[k] = (cnt[k] || 0) + 1; }

  /* 2. nodes and straight edges between kept vertices */
  let nodes: Record<string, GNode> = {};
  const nodeByKey: Record<string, string> = {};
  let edges: GEdge[] = [], edgeById: Record<string, GEdge> = {}, nodeSeq = 0, wayCount = 0;
  const nodeFor = (p: Pt): GNode => {
    const id0 = nodeByKey[p.k]; if (id0) return nodes[id0];
    const id = 'n' + ++nodeSeq; nodeByKey[p.k] = id;
    return (nodes[id] = { id, x: p.x, y: p.y, ll: [p.lon, p.lat], curb: null, deg: 0 });
  };
  for (const w of ways) {
    const t = w.tags!, pts: Pt[] = [];
    for (const g of w.geometry!) {
      const k = key(g), xy = P.toLocal([g.lon, g.lat]);
      if (pts.length && pts[pts.length - 1].k === k) continue;
      pts.push({ k, lon: g.lon, lat: g.lat, x: xy[0], y: xy[1] });
    }
    if (pts.length < 2) continue;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist2(pts[i - 1], pts[i]));
    const keep: boolean[] = []; keep[0] = keep[pts.length - 1] = true;
    for (let i = 1; i < pts.length - 1; i++) if (cnt[pts[i].k] > 1) keep[i] = true;
    const anchors: number[] = []; for (let i = 0; i < pts.length; i++) if (keep[i]) anchors.push(i);
    for (let i = 0; i < anchors.length - 1; i++) dp(pts, anchors[i], anchors[i + 1], 2.2, keep);
    const named = t.name || t['name:en'] || t.ref || null, hw = t.highway;
    const kind: GEdge['kind'] = hw === 'steps' ? 'stairs' : (hw === 'footway' || hw === 'path' || hw === 'track') && t.footway !== 'sidewalk' && t.footway !== 'crossing' ? 'path' : 'sidewalk';
    const name = named || (kind === 'stairs' ? 'Steps' : kind === 'path' ? 'Footpath' : t.footway === 'crossing' ? 'Crossing' : 'Unnamed street');
    let prevI = -1, used = 0;
    for (let i = 0; i < pts.length; i++) {
      if (!keep[i]) continue;
      if (prevI >= 0) {
        const p = pts[prevI], q = pts[i], a = nodeFor(p), b = nodeFor(q), id = a.id + '-' + b.id, rid = b.id + '-' + a.id, len = dist2(p, q);
        if (a !== b && len >= 0.8 && !edgeById[id] && !edgeById[rid]) {
          const e: GEdge = { id, a: a.id, b: b.id, name, kind, hw, way: w.id, legKey: named ? name : 'w' + w.id, len, chunk: Math.floor(cum[prevI] / 80), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, surveyed: false };
          edges.push(e); edgeById[id] = e; used++;
        }
      }
      prevI = i;
    }
    if (used) wayCount++;
  }
  if (!edges.length) throw new Error('The street data had no usable segments');

  /* 3. keep the largest connected piece */
  const adj: Record<string, string[]> = {};
  for (const id in nodes) adj[id] = [];
  for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const comp: Record<string, string> = {};
  let best = '', bestN = -1;
  for (const id in nodes) {
    if (comp[id]) continue;
    const stack = [id]; let n = 0; comp[id] = id;
    while (stack.length) { const u = stack.pop()!; n++; for (const v of adj[u]) if (!comp[v]) { comp[v] = id; stack.push(v); } }
    if (n > bestN) { bestN = n; best = id; }
  }
  edges = edges.filter((e) => comp[e.a] === best);
  const kept: Record<string, GNode> = {};
  edgeById = {};
  for (const e of edges) { edgeById[e.id] = e; kept[e.a] = nodes[e.a]; kept[e.b] = nodes[e.b]; nodes[e.a].deg++; nodes[e.b].deg++; }
  nodes = kept;

  /* 4. SIMULATED accessibility attributes (deterministic per OSM way and 80 m chunk) */
  const coverage: LngLat[] = [];
  for (let k = 0; k <= 48; k++) { const ang = (k / 48) * Math.PI * 2; coverage.push(P.fromLocal(Math.cos(ang) * COV_R, Math.sin(ang) * COV_R)); }
  for (const e of edges) {
    const inCov = Math.hypot(e.mx, e.my) <= COV_R, w = e.way % 1000003, c = e.chunk;
    e.surveyed = inCov;
    if (e.kind === 'stairs') { if (inCov) { e.width = 1.8; e.slope = 14; e.surface = 'fair'; } }
    else if (inCov) {
      if (hash(w, c, 7) < 0.045) { e.surveyed = false; e.gap = true; continue; }
      const r = WIDTH[e.hw] || [1.0, 1.6];
      let wd = r[0] + (r[1] - r[0]) * hash(w, c, 1);
      if (hash(w, c, 2) < 0.09) wd -= 0.32;
      e.width = Math.max(0.6, Math.round(wd * 20) / 20);
      let s = (hash(w, c, 3) * 2 - 1) * 2.2;
      const sp = hash(w, c, 4);
      if (sp < 0.09) s = (hash(w, c, 5) < 0.5 ? -1 : 1) * (4 + hash(w, c, 6) * 2.8);
      else if (sp < 0.115) s = (hash(w, c, 5) < 0.5 ? -1 : 1) * (8.6 + hash(w, c, 6) * 2.4);
      e.slope = Math.round(s * 10) / 10;
      const sf = hash(w, c, 8);
      e.surface = (sf < 0.38 ? 'smooth' : sf < 0.80 ? 'fair' : sf < 0.965 ? 'rough' : 'broken') as Surface;
    }
  }
  const junctions = Object.values(nodes).filter((n) => n.deg >= 3);
  for (const n of junctions) {
    if (Math.hypot(n.x, n.y) > COV_R) { n.curb = 'unknown'; continue; }
    const u = hash(Math.round(n.x * 10), Math.round(n.y * 10), 11);
    n.curb = u < 0.80 ? 'ok' : u < 0.89 ? 'steep' : u < 0.92 ? 'missing' : 'unknown';
  }
  const nearJ = junctions.filter((n) => { const d = Math.hypot(n.x, n.y); return d > 70 && d < 320; }).sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));
  /* one deliberate blockage and one steep ramp near the focus point, so the demo always shows them */
  if (nearJ[0]) nearJ[0].curb = 'missing';
  if (nearJ[2]) nearJ[2].curb = 'steep';
  if (edges.filter((e) => e.surveyed && e.kind === 'sidewalk').length < 3) throw new Error('The street data had too few streets near the focus point');

  /* 5. SIMULATED hazards and reports, snapped to real streets */
  const nearestEdge = (x: number, y: number, usedE: Record<string, 1>, clean = false) => {
    let bestE: GEdge | null = null, bd = 1e9, bt = 0.5;
    for (const e of edges) {
      if (e.kind !== 'sidewalk' || !e.surveyed || e.len < 10 || usedE[e.id]) continue;
      if (clean && !((e.width ?? 0) >= 1.2 && Math.abs(e.slope ?? 99) <= 5 && e.surface !== 'broken' && e.surface !== 'rough')) continue;
      const a = nodes[e.a], b = nodes[e.b], r = segProject(x, y, a.x, a.y, b.x, b.y);
      if (r.d < bd) { bd = r.d; bestE = e; bt = r.t; }
    }
    return bestE ? { e: bestE, t: Math.max(0.2, Math.min(0.8, bt)), d: bd } : null;
  };
  const hazards: Hazard[] = [], reports: Report[] = [], usedE: Record<string, 1> = {};
  for (const s of SEED_HAZARDS) {
    const n = nearestEdge(s.x, s.y, usedE); if (!n || n.d > 140) continue;
    usedE[n.e.id] = 1;
    const h: Hazard = { id: 'h' + (hazards.length + 1), edgeId: n.e.id, t: n.t, type: s.type, sev: s.sev, seed: true };
    hazards.push(h);
    reports.push({ id: 'r' + hazards.length, hazardId: h.id, title: s.title, author: s.author, daysAgo: s.days, ratings: s.ratings.slice(), contact: HAZARD_TYPES[s.type].agency, comments: s.comments.map((c) => ({ ...c })), simulated: true });
  }

  /* 6. places: the focus point first, then real named places from OpenStreetMap */
  const places: Place[] = [{ id: 'p1', name: o.name, cat: 'school', ll: [o.lng, o.lat], hours: 'Hours not recorded in this prototype', note: o.street + '. The simulated hazards and reports are placed on the streets around it.' }];
  const cand: (Omit<Place, 'id' | 'note'> & { d: number })[] = [];
  for (const e of pois) {
    const t = e.tags!, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const kindKey = t.amenity || t.shop || (t.office === 'government' ? 'townhall' : '');
    const cat = CATMAP[kindKey]; if (!cat) continue;
    const xy = P.toLocal([lon, lat]), d = Math.hypot(xy[0], xy[1]);
    if (d < 70 && /math|science|school/i.test(t.name)) continue;
    cand.push({ name: t.name, cat, ll: [lon, lat], d, hours: t.opening_hours ? 'Hours on OpenStreetMap: ' + t.opening_hours : 'Hours not recorded in this prototype' });
  }
  cand.sort((a, b) => a.d - b.d);
  const seen: Record<string, 1> = {};
  for (const c of cand) {
    if (places.length >= 40 || seen[c.name.toLowerCase()]) continue;
    seen[c.name.toLowerCase()] = 1;
    places.push({ id: 'p' + (places.length + 1), name: c.name, cat: c.cat, ll: c.ll, hours: c.hours, note: 'Name and position from OpenStreetMap.' });
  }

  /* 7. demo starting point ~300 m from the focus, kept off hazards and barrier edges */
  const st = nearestEdge(-215, -190, usedE, true) || nearestEdge(-100, -100, usedE, true) || nearestEdge(-215, -190, {});
  const defaultYou: LngLat = st ? P.fromLocal(nodes[st.e.a].x + (nodes[st.e.b].x - nodes[st.e.a].x) * st.t, nodes[st.e.a].y + (nodes[st.e.b].y - nodes[st.e.a].y) * st.t) : P.fromLocal(-150, -150);

  const net: Network = {
    anchor, areaName: o.name, covRadius: COV_R, coverage, nodes, edges, places, hazards, reports, defaultYou,
    meta: { ways: wayCount, edges: edges.length, nodes: Object.keys(nodes).length, pois: pois.length, source: o.source, osmTimestamp: osm.osm3s?.timestamp_osm_base ?? null, builtAt: new Date().toISOString() },
  };

  /* 8. keep the demo meaningful: if the simulated hazards leave the focus point with no
     passable path from the demo start, downgrade the hazards that block the best path.
     (Real survey data would never be edited like this; it only tunes the simulation.) */
  const prefs = { stairs: true, steep: true, ramps: true, shortest: false };
  /* demo start: a clean street 200–380 m from the focus whose path there is not a long detour */
  {
    const eng0 = new Engine(net), cands = edges
      .filter((e) => e.kind === 'sidewalk' && e.surveyed && e.len >= 10 && !usedE[e.id] && (e.width ?? 0) >= 1.2 && Math.abs(e.slope ?? 99) <= 5 && e.surface !== 'broken' && e.surface !== 'rough')
      .map((e) => ({ e, d: Math.hypot(e.mx, e.my) })).filter((c) => c.d >= 200 && c.d <= 380)
      .sort((a, b) => Math.abs(a.d - 290) - Math.abs(b.d - 290)).slice(0, 40);
    let bestC: { ll: LngLat; score: number } | null = null;
    for (const c of cands) {
      const ll = P.fromLocal(c.e.mx, c.e.my), plan = eng0.findRoutes(ll, places[0].ll, prefs);
      const minLen = Math.min(...plan.routes.map((r) => r.length)), ratio = minLen / c.d;
      const score = ratio + (minLen > 650 ? 5 : 0);
      if (!bestC || score < bestC.score) bestC = { ll, score };
    }
    if (bestC) net.defaultYou = bestC.ll;
  }
  for (let k = 0; k < 4; k++) {
    const eng = new Engine(net), best = eng.findRoutes(net.defaultYou, places[0].ll, prefs).routes[0];
    const blocking = best ? best.barriers.filter((b) => b.kind === 'critical' && b.code === 'hazard' && b.hazardId) : [];
    if (!blocking.length) break;
    for (const b of blocking) { const h = hazards.find((x) => x.id === b.hazardId); if (h && h.sev === 3) h.sev = 2; }
  }
  for (const h of hazards) delete h.ll;
  return net;
}
