/* Routing engine: snapping, rule-based edge scoring, weighted Dijkstra with
   virtual start/end nodes, alternatives, route analysis and turn-by-turn. */
import { angDiff, bearing, cardinal, haversine, lerp, makeProjection, pointInPolygon, segProject, type Projection } from './geo';
import { CURB_STARS, HAZARD_TYPES, HZ_PTS, RULES, SURF_STARS, fmt, hazardStars, starsSlope, starsWidth } from './rules';
import type { AccessClass, Barrier, EdgeEval, GEdge, GNode, Hazard, HazardGeometry, HazardSpan, Issue, Leg, LngLat, NavIcon, NavState, Network, Place, Plan, Prefs, Route, Seg, Snap } from './types';

interface SpanRef { h: Hazard; t0: number; t1: number }

interface Ctx { wW: number; wS: number; wF: number; hazM: number; critM: number; stairsM: number; steepM: number; unk: number; nMissing: number; nSteep: number; nUnknown: number; penal: Record<string, number> | null }
interface Geo { ax: number; ay: number; bx: number; by: number; la: LngLat; lb: LngLat }

class Heap {
  private a: [number, string][] = [];
  push(k: number, v: string) {
    const a = this.a; let i = a.length; a.push([k, v]);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, string] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0; const n = a.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && a[l][0] < a[m][0]) m = l; if (r < n && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
    }
    return top;
  }
}

export class Engine {
  readonly net: Network;
  readonly P: Projection;
  readonly nodes: Record<string, GNode>;
  readonly edges: GEdge[];
  readonly byId: Record<string, GEdge> = {};
  private adj: Record<string, { e: GEdge; to: string }[]> = {};
  private g: Record<string, Geo> = {};
  hazards: Hazard[] = [];
  private byEdge: Record<string, SpanRef[]> = {};
  private rev = 0;
  private evCache = new Map<string, { rev: number; ev: EdgeEval }>();

  constructor(net: Network) {
    this.net = net; this.P = makeProjection(net.anchor); this.nodes = net.nodes; this.edges = net.edges;
    for (const id in this.nodes) this.adj[id] = [];
    for (const e of this.edges) {
      const a = this.nodes[e.a], b = this.nodes[e.b];
      this.byId[e.id] = e;
      this.g[e.id] = { ax: a.x, ay: a.y, bx: b.x, by: b.y, la: a.ll, lb: b.ll };
      this.adj[e.a].push({ e, to: e.b }); this.adj[e.b].push({ e, to: e.a });
    }
    this.setHazards(net.hazards);
  }

  edgeAt(e: GEdge, t: number): LngLat { const g = this.g[e.id]; return lerp(g.la, g.lb, t); }
  edgeCoords(e: GEdge): [LngLat, LngLat] { const g = this.g[e.id]; return [g.la, g.lb]; }

  /** Attach every hazard's fixed geometry to the pathway stretches it touches (spatial join). */
  setHazards(list: Hazard[]) {
    this.hazards = list; this.byEdge = {}; this.rev++;
    for (const h of list) {
      h.spans = this.spansFor(h.geometry);
      h.anchor = this.anchorOf(h.geometry);
      for (const sp of h.spans) (this.byEdge[sp.edgeId] ||= []).push({ h, t0: sp.t0, t1: sp.t1 });
    }
  }
  /** unique hazards touching an edge */
  hazardsOn(edgeId: string): Hazard[] { return [...new Set((this.byEdge[edgeId] || []).map((r) => r.h))]; }

  anchorOf(g: HazardGeometry): LngLat {
    if (g.type === 'Point') return g.coordinates;
    if (g.type === 'LineString') {
      const loc = g.coordinates.map((c) => this.P.toLocal(c)); let total = 0;
      for (let i = 1; i < loc.length; i++) total += Math.hypot(loc[i][0] - loc[i - 1][0], loc[i][1] - loc[i - 1][1]);
      let acc = 0;
      for (let i = 1; i < loc.length; i++) {
        const d = Math.hypot(loc[i][0] - loc[i - 1][0], loc[i][1] - loc[i - 1][1]);
        if (acc + d >= total / 2) { const t = d ? (total / 2 - acc) / d : 0; return this.P.fromLocal(loc[i - 1][0] + (loc[i][0] - loc[i - 1][0]) * t, loc[i - 1][1] + (loc[i][1] - loc[i - 1][1]) * t); }
        acc += d;
      }
      return g.coordinates[0];
    }
    const ring = g.coordinates[0].slice(0, -1);
    return [ring.reduce((a, c) => a + c[0], 0) / ring.length, ring.reduce((a, c) => a + c[1], 0) / ring.length];
  }
  /** length (m) of a line or area (m²) of a polygon, for the details card */
  measure(g: HazardGeometry): number {
    if (g.type === 'Point') return 0;
    const loc = (g.type === 'LineString' ? g.coordinates : g.coordinates[0]).map((c) => this.P.toLocal(c));
    if (g.type === 'LineString') { let d = 0; for (let i = 1; i < loc.length; i++) d += Math.hypot(loc[i][0] - loc[i - 1][0], loc[i][1] - loc[i - 1][1]); return d; }
    let a = 0; for (let i = 0, j = loc.length - 1; i < loc.length; j = i++) a += (loc[j][0] + loc[i][0]) * (loc[j][1] - loc[i][1]);
    return Math.abs(a / 2);
  }
  /** Which pathway stretches a geometry affects. Points snap to the nearest pathway within RULES.attachPoint;
      lines affect stretches within RULES.attachLine of the line; polygons affect stretches inside them. */
  spansFor(g: HazardGeometry): HazardSpan[] {
    if (g.type === 'Point') {
      const [px, py] = this.P.toLocal(g.coordinates);
      let best: { e: GEdge; t: number; d: number } | null = null;
      for (const e of this.edges) {
        if (e.kind === 'stairs') continue;
        const k = this.g[e.id], r = segProject(px, py, k.ax, k.ay, k.bx, k.by);
        if (!best || r.d < best.d) best = { e, t: r.t, d: r.d };
      }
      return best && best.d <= RULES.attachPoint ? [{ edgeId: best.e.id, t0: best.t, t1: best.t }] : [];
    }
    const line = g.type === 'LineString' ? g.coordinates.map((c) => this.P.toLocal(c)) : null;
    const ring = g.type === 'Polygon' ? g.coordinates[0] : null;
    const pts = (line || ring!.map((c) => this.P.toLocal(c)));
    const minX = Math.min(...pts.map((p) => p[0])) - 10, maxX = Math.max(...pts.map((p) => p[0])) + 10, minY = Math.min(...pts.map((p) => p[1])) - 10, maxY = Math.max(...pts.map((p) => p[1])) + 10;
    const inside = (x: number, y: number) => {
      if (line) { for (let i = 1; i < line.length; i++) if (segProject(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]).d <= RULES.attachLine) return true; return false; }
      return pointInPolygon(this.P.fromLocal(x, y), ring!);
    };
    const out: HazardSpan[] = [];
    for (const e of this.edges) {
      const k = this.g[e.id];
      if (Math.max(k.ax, k.bx) < minX || Math.min(k.ax, k.bx) > maxX || Math.max(k.ay, k.by) < minY || Math.min(k.ay, k.by) > maxY) continue;
      const n = Math.max(2, Math.ceil(e.len / 1.5));
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = k.ax + (k.bx - k.ax) * t, y = k.ay + (k.by - k.ay) * t, inn = inside(x, y);
        if (inn && start < 0) start = i;
        if ((!inn || i === n) && start >= 0) { const end = inn ? i : i - 1; out.push({ edgeId: e.id, t0: start / n, t1: end / n }); start = -1; }
      }
    }
    /* drop tiny touches of a line on a crossing street (less than 2 m) */
    return out.filter((sp) => g.type !== 'LineString' || (sp.t1 - sp.t0) * this.byId[sp.edgeId].len >= 2);
  }

  /* ---------------- network helpers used by navigation ---------------- */
  adjacent(nodeId: string) { return this.adj[nodeId] || []; }
  /** a point `dist` metres from a node along one of its edges */
  pointFromNode(e: GEdge, nodeId: string, dist: number): LngLat {
    const t = Math.min(1, dist / Math.max(1, e.len));
    return this.edgeAt(e, e.a === nodeId ? t : 1 - t);
  }
  /** distance along a route reached after `t` seconds of travel (inverse of timeAt) */
  sAtTime(R: Route, t: number): number {
    const c = R.cumT; if (t <= 0) return 0; if (t >= c[c.length - 1]) return R.length;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= t) lo = mid; else hi = mid; }
    const f = c[hi] - c[lo] ? (t - c[lo]) / (c[hi] - c[lo]) : 0;
    return R.cum[lo] + (R.cum[hi] - R.cum[lo]) * f;
  }

  evalEdge(e: GEdge): EdgeEval {
    const c = this.evCache.get(e.id); if (c && c.rev === this.rev) return c.ev;
    const hs = this.hazardsOn(e.id), crit: Issue[] = [], warn: Issue[] = [];
    let pts = 0;
    for (const h of hs) {
      pts += HZ_PTS[h.sev];
      (h.sev === 3 ? crit : warn).push({ code: 'hazard', kind: 'hazard', label: HAZARD_TYPES[h.type].label, hazard: h });
    }
    const ev: EdgeEval = { known: e.surveyed, hz: hs, pts, hazard: hazardStars(pts), crit, warn, width: null, slope: null, surface: null, avg: null };
    if (e.kind === 'stairs') crit.push({ code: 'stairs', kind: 'edge', label: 'Stairs with no ramp' });
    if (ev.known && e.width != null && e.slope != null && e.surface) {
      ev.width = starsWidth(e.width); ev.slope = starsSlope(e.slope); ev.surface = SURF_STARS[e.surface];
      if (e.width < RULES.critWidth) crit.push({ code: 'width', kind: 'edge', label: `Too narrow for a wheelchair (${e.width.toFixed(2)} m)` });
      else if (e.width < RULES.minWidth) warn.push({ code: 'width', kind: 'edge', label: `Narrower than 1.20 m (${e.width.toFixed(2)} m)` });
      const ag = Math.abs(e.slope);
      if (ag > RULES.critGrade) crit.push({ code: 'grade', kind: 'edge', label: `Very steep slope (${ag.toFixed(1)} %)` });
      else if (ag > RULES.rampGrade) warn.push({ code: 'grade', kind: 'edge', label: `Steeper than a 1:12 ramp (${ag.toFixed(1)} %)` });
      if (e.surface === 'broken') crit.push({ code: 'surface', kind: 'edge', label: 'Broken or uneven surface' });
      else if (e.surface === 'rough') warn.push({ code: 'surface', kind: 'edge', label: 'Rough surface' });
      ev.avg = (ev.width + ev.slope + ev.surface + ev.hazard) / 4;
    } else ev.known = false;
    this.evCache.set(e.id, { rev: this.rev, ev });
    return ev;
  }

  /* ---------------- cost model ---------------- */
  makeCtx(prefs: Prefs, mode: 'prefs' | 'hazards' | 'shortest' = 'prefs'): Ctx {
    const c: Ctx = { wW: 1.5, wS: 1.7, wF: 1.0, hazM: 170, critM: 1800, stairsM: prefs.stairs ? 60000 : 0, steepM: prefs.steep ? 500 : 0, unk: 2.6, nMissing: 700, nSteep: prefs.steep ? 260 : 120, nUnknown: 60, penal: null };
    if (prefs.steep) c.wS *= 1.4;
    if (prefs.ramps) { c.nSteep += 140; c.nUnknown += 90; c.nMissing += 200; }
    if (prefs.shortest) { c.wW *= 0.3; c.wS *= 0.3; c.wF *= 0.3; c.hazM *= 0.5; c.unk = 1.6; }
    if (mode === 'hazards') { c.hazM *= 3; c.wW *= 0.8; c.wS *= 0.8; }
    if (mode === 'shortest') Object.assign(c, { wW: 0, wS: 0, wF: 0, hazM: 0, unk: 1, critM: 60, stairsM: 60, steepM: 0, nMissing: 0, nSteep: 0, nUnknown: 0 });
    return c;
  }
  private nodeCost(n: GNode, c: Ctx) { return n.curb === 'missing' ? c.nMissing : n.curb === 'steep' ? c.nSteep : n.curb === 'unknown' ? c.nUnknown : 0; }
  private segCost(e: GEdge, t0: number, t1: number, c: Ctx) {
    const ev = this.evalEdge(e), frac = Math.abs(t1 - t0), lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    let f = 1;
    if (!ev.known) f = c.unk; else f += (c.wW * (5 - ev.width!)) / 4 + (c.wS * (5 - ev.slope!)) / 4 + (c.wF * (5 - ev.surface!)) / 4;
    let cost = e.len * frac * f, extra = 0;
    for (const x of ev.crit) if (x.kind !== 'hazard') extra += x.code === 'stairs' ? c.stairsM : c.critM;
    if (ev.known && Math.abs(e.slope!) > RULES.rampGrade) extra += c.steepM;
    cost += extra * frac;
    const met = new Set<Hazard>();
    for (const r of this.byEdge[e.id] || []) if (r.t1 >= lo - 1e-9 && r.t0 <= hi + 1e-9) met.add(r.h);
    for (const h of met) cost += HZ_PTS[h.sev] * c.hazM + (h.sev === 3 ? c.critM : 0);
    if (c.penal && c.penal[e.id]) cost *= c.penal[e.id];
    return cost;
  }

  /* ---------------- snapping & area ---------------- */
  inCoverage(ll: LngLat) { return pointInPolygon(ll, this.net.coverage); }
  snap(ll: LngLat): Snap {
    const [px, py] = this.P.toLocal(ll);
    let best: { e: GEdge; t: number; d: number; x: number; y: number } | null = null;
    for (const e of this.edges) {
      if (e.kind === 'stairs' || e.kind === 'path') continue;
      const g = this.g[e.id], r = segProject(px, py, g.ax, g.ay, g.bx, g.by);
      if (!best || r.d < best.d) best = { e, t: r.t, d: r.d, x: r.x, y: r.y };
    }
    if (!best) throw new Error('No pathways in the network');
    return { edgeId: best.e.id, t: best.t, dist: best.d, ll: this.P.fromLocal(best.x, best.y), inCoverage: this.inCoverage(ll), surveyed: best.e.surveyed };
  }

  /* ---------------- Dijkstra with virtual start/end nodes ---------------- */
  private mkSeg(e: GEdge, t0: number, t1: number): Seg { return { e, t0, t1, len: Math.abs(t1 - t0) * e.len, p0: this.edgeAt(e, t0), p1: this.edgeAt(e, t1), s0: 0, s1: 0 }; }
  private dijkstra(from: Snap, to: Snap, c: Ctx) {
    const eS = this.byId[from.edgeId], eT = this.byId[to.edgeId];
    if (eS === eT) return { segs: [this.mkSeg(eS, from.t, to.t)], cost: this.segCost(eS, from.t, to.t, c), explored: 0 };
    const dist: Record<string, number> = {}, prev: Record<string, { from: string | null; edge?: GEdge; tEnd?: number }> = {}, done: Record<string, 1> = {}, heap = new Heap();
    const D = (id: string) => dist[id] ?? Infinity;
    for (const [end, tt] of [['a', 0], ['b', 1]] as const) {
      const nid = eS[end], cc = this.segCost(eS, from.t, tt, c) + this.nodeCost(this.nodes[nid], c);
      if (cc < D(nid)) { dist[nid] = cc; prev[nid] = { from: null, tEnd: tt }; heap.push(cc, nid); }
    }
    let explored = 0, top: [number, string] | undefined;
    while ((top = heap.pop())) {
      const u = top[1];
      if (done[u] || top[0] > D(u)) continue;
      done[u] = 1; explored++;
      for (const nb of this.adj[u]) {
        const nd = dist[u] + this.segCost(nb.e, 0, 1, c) + this.nodeCost(this.nodes[nb.to], c);
        if (nd < D(nb.to)) { dist[nb.to] = nd; prev[nb.to] = { from: u, edge: nb.e }; heap.push(nd, nb.to); }
      }
    }
    let bestEnd: { nid: string; t: number } | null = null, bestCost = Infinity;
    for (const [end, tt] of [['a', 0], ['b', 1]] as const) {
      const nid = eT[end]; if (D(nid) === Infinity) continue;
      const cc = dist[nid] + this.segCost(eT, tt, to.t, c);
      if (cc < bestCost) { bestCost = cc; bestEnd = { nid, t: tt }; }
    }
    if (!bestEnd) return null;
    const chain: ({ start: true; tEnd: number } | { start?: false; e: GEdge; from: string; to: string })[] = [];
    let cur: string | null = bestEnd.nid, guard = 0;
    while (cur && guard++ < 50000) {
      const pv: { from: string | null; edge?: GEdge; tEnd?: number } = prev[cur];
      if (pv.from === null) { chain.unshift({ start: true, tEnd: pv.tEnd! }); break; }
      chain.unshift({ e: pv.edge!, from: pv.from, to: cur });
      cur = pv.from;
    }
    const segs: Seg[] = [];
    for (const ch of chain) {
      if (ch.start) segs.push(this.mkSeg(eS, from.t, ch.tEnd));
      else { const t0 = ch.e.a === ch.from ? 0 : 1; segs.push(this.mkSeg(ch.e, t0, 1 - t0)); }
    }
    segs.push(this.mkSeg(eT, bestEnd.t, to.t));
    return { segs, cost: bestCost, explored };
  }

  /* ---------------- route analysis ---------------- */
  analyze(segs0: Seg[]): Omit<Route, 'id' | 'rank' | 'label' | 'tag' | 'cost'> {
    let segs = segs0.filter((s) => s.len > 0.4);
    if (!segs.length) segs = segs0.slice(0, 1);
    const coords: LngLat[] = [segs[0].p0], cum = [0];
    let s = 0;
    for (const sg of segs) { sg.s0 = s; s += sg.len; sg.s1 = s; coords.push(sg.p1); cum.push(s); }
    let knownLen = 0, unkLen = 0, sw = 0, ss = 0, sf = 0, climb = 0, descent = 0, maxGrade = 0, minWidth = 99, time = 0;
    let barriers: Barrier[] = [];
    const cumT = [0], seenHz: Record<string, 1> = {}, hazardsOn: { h: Hazard; s: number }[] = [];
    segs.forEach((sg, i) => {
      const e = sg.e, ev = this.evalEdge(e), dir = sg.t1 >= sg.t0 ? 1 : -1, sl = ev.known ? e.slope! * dir : 0;
      let v = RULES.walkSpeed;
      if (ev.known) {
        knownLen += sg.len; sw += sg.len * ev.width!; ss += sg.len * ev.slope!; sf += sg.len * ev.surface!;
        if (sl > 2) v *= Math.max(0.45, 1 - 0.07 * (sl - 2)); else if (sl < -6) v *= 0.85;
        if (e.surface === 'rough') v *= 0.85; else if (e.surface === 'broken') v *= 0.6;
        minWidth = Math.min(minWidth, e.width!); maxGrade = Math.max(maxGrade, Math.abs(e.slope!));
      } else { unkLen += sg.len; v *= 0.9; }
      if (sl > 0) climb += (sl / 100) * sg.len; else descent -= (sl / 100) * sg.len;
      time += sg.len / v; cumT.push(time);
      const mid = (sg.s0 + sg.s1) / 2, ll = lerp(sg.p0, sg.p1, 0.5);
      for (const x of ev.crit) if (x.kind !== 'hazard') barriers.push({ kind: 'critical', code: x.code, label: x.label, where: e.name, s: mid, ll, edgeId: e.id });
      for (const x of ev.warn) if (x.kind !== 'hazard') barriers.push({ kind: 'caution', code: x.code, label: x.label, where: e.name, s: mid, ll, edgeId: e.id });
      if (!ev.known) barriers.push({ kind: 'unverified', code: 'unverified', label: 'No accessibility data for this stretch', where: e.name, s: mid, ll, edgeId: e.id });
      const lo = Math.min(sg.t0, sg.t1), hi = Math.max(sg.t0, sg.t1);
      for (const r of this.byEdge[e.id] || []) {
        const a = Math.max(lo, r.t0), b = Math.min(hi, r.t1);
        if (b < a - 1e-9 || seenHz[r.h.id]) continue;
        seenHz[r.h.id] = 1;
        /* where along the route the traveller first meets the hazard, and where its stretch ends */
        const tIn = sg.t1 >= sg.t0 ? a : b, tOut = sg.t1 >= sg.t0 ? b : a;
        const hs = sg.s0 + Math.abs(tIn - sg.t0) * e.len, he = sg.s0 + Math.abs(tOut - sg.t0) * e.len;
        hazardsOn.push({ h: r.h, s: hs });
        barriers.push({ kind: r.h.sev === 3 ? 'critical' : 'caution', code: 'hazard', label: HAZARD_TYPES[r.h.type].label, where: e.name, s: hs, sEnd: he > hs + 1 ? he : undefined, ll: this.edgeAt(e, tIn), edgeId: e.id, hazardId: r.h.id, sev: r.h.sev });
      }
      if (i < segs.length - 1 && (sg.t1 === 0 || sg.t1 === 1)) {
        const nid = sg.t1 === 1 ? e.b : e.a, n = this.nodes[nid];
        sg.endNode = nid;
        if (n.curb === 'missing') barriers.push({ kind: 'critical', code: 'curb', label: 'No curb ramp recorded at this crossing', where: e.name, s: sg.s1, ll: n.ll, edgeId: e.id, nodeId: nid });
        else if (n.curb === 'steep') barriers.push({ kind: 'caution', code: 'curb', label: 'Curb ramp is steeper than 1:12', where: e.name, s: sg.s1, ll: n.ll, edgeId: e.id, nodeId: nid });
        else if (n.curb === 'unknown') barriers.push({ kind: 'unverified', code: 'curb', label: 'Curb ramp not surveyed', where: e.name, s: sg.s1, ll: n.ll, edgeId: e.id, nodeId: nid });
        if (n.curb) time += 6;
      }
    });
    cumT[cumT.length - 1] = time;
    let curbSum = 0, curbN = 0;
    segs.forEach((sg, i) => { if (i < segs.length - 1 && sg.endNode) { const cv = CURB_STARS[this.nodes[sg.endNode].curb || '']; if (cv) { curbSum += cv; curbN++; } } });
    let hzPts = 0; for (const x of hazardsOn) hzPts += HZ_PTS[x.h.sev];
    let ratings: Route['ratings'] = null;
    if (knownLen > 0) {
      const slopeMean = ss / knownLen, curbMean = curbN ? curbSum / curbN : null;
      const r = { hazards: hazardStars(hzPts), width: sw / knownLen, surface: sf / knownLen, ramp: curbMean == null ? slopeMean : 0.6 * slopeMean + 0.4 * curbMean, avg: 0 };
      r.avg = (r.hazards + r.width + r.surface + r.ramp) / 4;
      ratings = r;
    }
    barriers.sort((a, b) => a.s - b.s);
    const MERGE: Record<string, 1> = { width: 1, grade: 1, surface: 1, unverified: 1, stairs: 1 }, merged: Barrier[] = [];
    outer: for (const b of barriers) {
      /* several graph nodes at one real crossing: report it once */
      if (b.code === 'curb') for (let q = merged.length - 1; q >= 0 && b.s - merged[q].s < 25; q--) {
        const m = merged[q]; if (m.code === 'curb' && m.kind === b.kind) continue outer;
      }
      if (MERGE[b.code]) for (let q = merged.length - 1; q >= 0 && b.s - merged[q].s < 160; q--) {
        const m = merged[q]; if (m.code === b.code && m.kind === b.kind && m.where === b.where) { m.s2 = b.s; continue outer; }
      }
      merged.push(b);
    }
    barriers = merged;
    const critN = barriers.filter((b) => b.kind === 'critical').length, unknownShare = s ? unkLen / s : 0;
    let cls: AccessClass;
    if (!ratings || unknownShare > 0.5) cls = 'limited';
    else if (critN) cls = 'not';
    else if (unkLen > 0) cls = ratings.avg >= 2.5 ? 'partial' : 'not';
    else cls = ratings.avg >= 4 ? 'accessible' : ratings.avg >= 2.5 ? 'partial' : 'not';
    /* hazards within the buffer distance of the path but not on it */
    const hazardsNear: { h: Hazard; d: number }[] = [], loc = coords.map((c) => this.P.toLocal(c));
    for (const h of this.hazards) {
      if (seenHz[h.id]) continue;
      const g = h.geometry, verts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0];
      let best = Infinity;
      for (const v of verts) {
        const [px, py] = this.P.toLocal(v);
        for (let k = 0; k < loc.length - 1; k++) best = Math.min(best, segProject(px, py, loc[k][0], loc[k][1], loc[k + 1][0], loc[k + 1][1]).d);
      }
      if (best <= RULES.hazardBuffer) hazardsNear.push({ h, d: best });
    }
    /* turn-by-turn legs */
    const legs: Leg[] = [];
    segs.forEach((sg, si) => {
      const br = bearing(sg.p0, sg.p1), last = legs[legs.length - 1], key = sg.e.legKey || sg.e.name;
      const pn = si > 0 && segs[si - 1].endNode ? this.nodes[segs[si - 1].endNode!] : null, bend = !!(pn && pn.deg === 2);
      if (last && last.key === key && (bend || Math.abs(angDiff(last.outBearing, br)) < 25)) { last.endS = sg.s1; last.dist = last.endS - last.startS; last.outBearing = br; }
      else legs.push({ name: sg.e.name, key, bearing: br, outBearing: br, startS: sg.s0, endS: sg.s1, dist: sg.len, ll: sg.p0, turn: 'start', verb: '' });
    });
    legs.forEach((lg, i) => {
      if (i === 0) { lg.turn = 'start'; lg.verb = `Head ${cardinal(lg.bearing)} on ${lg.name}`; return; }
      const d = angDiff(legs[i - 1].outBearing, lg.bearing), ad = Math.abs(d), side = d > 0 ? 'right' : 'left';
      if (ad < 20) { lg.turn = 'straight'; lg.verb = `continue straight onto ${lg.name}`; }
      else { lg.turn = side; lg.verb = ad < 60 ? `bear ${side} onto ${lg.name}` : ad < 135 ? `turn ${side} onto ${lg.name}` : `make a sharp ${side} onto ${lg.name}`; }
    });
    return { segs, coords, cum, length: s, ratings, barriers, criticalCount: critN, cls, knownLen, unknownLen: unkLen, unknownShare, hazardsOn, hazardsNear, time, cumT, climb, descent, minWidth: minWidth === 99 ? null : minWidth, maxGrade, legs };
  }

  findRoutes(fromLL: LngLat, toLL: LngLat, prefs: Prefs): Plan {
    const t0 = performance.now(), sf = this.snap(fromLL), st = this.snap(toLL);
    let out: Route[] = [], explored = 0;
    const seen: Record<string, 1> = {};
    const add = (res: { segs: Seg[]; cost: number; explored: number } | null, tag: Route['tag']) => {
      if (!res) return;
      explored += res.explored;
      const A = this.analyze(res.segs), k = A.segs.map((x) => x.e.id + ':' + x.t0.toFixed(2) + '>' + x.t1.toFixed(2)).join('|');
      if (seen[k]) return; seen[k] = 1;
      out.push({ ...A, cost: res.cost, tag, id: '', rank: 0, label: '' });
    };
    const r1 = this.dijkstra(sf, st, this.makeCtx(prefs, 'prefs'));
    add(r1, 'prefs');
    add(this.dijkstra(sf, st, this.makeCtx(prefs, 'hazards')), 'hazards');
    add(this.dijkstra(sf, st, this.makeCtx(prefs, 'shortest')), 'shortest');
    if (r1 && out.length < 3) {
      const c2 = this.makeCtx(prefs, 'prefs'); c2.penal = {};
      for (const x of r1.segs) c2.penal[x.e.id] = 1.7;
      add(this.dijkstra(sf, st, c2), 'detour');
    }
    const score = (R: Route) => (R.ratings ? R.ratings.avg : 0) - 1.5 * R.unknownShare;
    out.sort((a, b) => {
      const ca = a.criticalCount > 0 ? 1 : 0, cb = b.criticalCount > 0 ? 1 : 0;
      if (ca !== cb) return ca - cb;
      const d = score(b) - score(a); if (Math.abs(d) > 0.005) return d;
      return a.length - b.length;
    });
    out = out.slice(0, 3);
    const minLen = Math.min(...out.map((r) => r.length));
    out.forEach((R, i) => {
      R.id = 'route' + i; R.rank = i;
      const shortest = R.length <= minLen + 0.5;
      R.label = i === 0 ? (shortest && out.length > 1 ? 'Most accessible · also shortest' : 'Most accessible') : shortest ? 'Shortest' : 'Alternative';
      if (R.tag === 'shortest' && i !== 0) R.label = 'Shortest · ignores accessibility';
    });
    return { routes: out, from: sf, to: st, explored, ms: performance.now() - t0, prefs };
  }

  /* ---------------- positions along a route ---------------- */
  project(R: Route, ll: LngLat) {
    const [px, py] = this.P.toLocal(ll); let best = { d: Infinity, s: 0 };
    for (let k = 0; k < R.coords.length - 1; k++) {
      const a = this.P.toLocal(R.coords[k]), b = this.P.toLocal(R.coords[k + 1]), r = segProject(px, py, a[0], a[1], b[0], b[1]);
      if (r.d < best.d) best = { d: r.d, s: R.cum[k] + r.t * (R.cum[k + 1] - R.cum[k]) };
    }
    return best;
  }
  pointAt(R: Route, s: number) {
    s = Math.max(0, Math.min(R.length, s));
    let i = 0; while (i < R.cum.length - 2 && R.cum[i + 1] < s) i++;
    const a = R.coords[i], b = R.coords[i + 1], d = R.cum[i + 1] - R.cum[i], t = d ? (s - R.cum[i]) / d : 0;
    return { ll: lerp(a, b, t), bearing: bearing(a, b) };
  }
  slice(R: Route, s0: number, s1: number): LngLat[] {
    s0 = Math.max(0, s0); s1 = Math.min(R.length, s1);
    if (s1 <= s0) return [];
    const out = [this.pointAt(R, s0).ll];
    for (let i = 0; i < R.cum.length; i++) if (R.cum[i] > s0 && R.cum[i] < s1) out.push(R.coords[i]);
    out.push(this.pointAt(R, s1).ll);
    return out;
  }
  timeAt(R: Route, s: number) {
    let i = 0; while (i < R.cum.length - 2 && R.cum[i + 1] < s) i++;
    const d = R.cum[i + 1] - R.cum[i], t = d ? (s - R.cum[i]) / d : 0;
    return R.cumT[i] + (R.cumT[i + 1] - R.cumT[i]) * Math.max(0, Math.min(1, t));
  }
  navState(R: Route, s: number, destName: string): NavState {
    const legs = R.legs; let i = 0;
    while (i < legs.length - 1 && s >= legs[i].endS - 0.01) i++;
    const leg = legs[i], next = legs[i + 1], rem = Math.max(0, leg.endS - s);
    let text: string, icon: NavIcon, now = false;
    if (next) {
      now = rem < 18;
      const verb = next.verb;
      text = now ? verb.charAt(0).toUpperCase() + verb.slice(1) + ' now' : 'Continue straight, then ' + verb.replace(/ onto .*/, '') + ' in ' + fmt.dist(rem);
      icon = next.turn === 'left' || next.turn === 'right' ? next.turn : 'straight';
      if (/sharp/.test(verb)) icon = next.turn === 'left' ? 'sharpleft' : 'sharpright';
    } else {
      text = rem < 12 ? 'Arrive at ' + destName : `Continue straight, then arrive at ${destName} in ${fmt.dist(rem)}`;
      icon = rem < 12 ? 'arrive' : 'straight';
    }
    return { legIndex: i, text, icon, now, street: leg.name, rem, remTotal: Math.max(0, R.length - s), timeLeft: Math.max(0, R.time - this.timeAt(R, s)) };
  }

  searchPlaces(q: string, from: LngLat, cats: Record<string, { label: string }>): { p: Place; d: number; inCov: boolean }[] {
    const s = q.trim().toLowerCase();
    return this.net.places
      .filter((p) => !s || p.name.toLowerCase().includes(s) || cats[p.cat].label.toLowerCase().includes(s))
      .map((p) => ({ p, d: haversine(from, p.ll), inCov: this.inCoverage(p.ll) }))
      .sort((a, b) => a.d - b.d);
  }
}
