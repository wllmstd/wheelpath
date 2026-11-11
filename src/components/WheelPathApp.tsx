'use client';
import dynamic from 'next/dynamic';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AREA } from '@/lib/config';
import { Engine } from '@/lib/engine/engine';
import { haversine } from '@/lib/engine/geo';
import { CATS, CLS_LABEL, CURB_LABEL, HAZARD_TYPES, RULES, SEV, SOURCE_LABEL, SURF_LABEL, fmt } from '@/lib/engine/rules';
import type { Hazard, HazardType, LngLat, Network, Place, Plan, Prefs, Report, Severity } from '@/lib/engine/types';
import { useGeolocation } from '@/hooks/useGeolocation';
import type { Feature, Layers, MapHandle } from './MapView';
import { ClsTag, Icon, SevTag, Stars, Tag } from './ui';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => <div className="map map-loading" /> });

type Screen = 'home' | 'search' | 'route' | 'nav' | 'arrive' | 'reports' | 'report' | 'prefs' | 'about';
type Mode = 'demo' | 'gps';
/** demo runs on simulated time along the route; gps follows the device */
interface NavRun { kind: Mode; t: number; s: number; playing: boolean; speed: number; off: LngLat | null; offCount: number; reroutes: number }

const DEFAULT_PREFS: Prefs = { stairs: true, steep: true, ramps: true, shortest: false };
const DEFAULT_LAYERS: Layers = { access: true, hazards: true, curbs: true, places: true, coverage: false, buffers: false };
const LS = 'wheelpath:v2';
const OFF_ROUTE_M = 30, SNAP_SHOW_M = 60;
function load<T extends object>(k: string, d: T): T { try { const v = localStorage.getItem(LS + ':' + k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } }
function loadArr<T>(k: string): T[] { try { const v = localStorage.getItem(LS + ':' + k); return v ? JSON.parse(v) : []; } catch { return []; } }
function save(k: string, v: unknown) { try { localStorage.setItem(LS + ':' + k, JSON.stringify(v)); } catch { /* storage blocked */ } }
const ll5 = (ll: LngLat) => `${ll[1].toFixed(5)}° N, ${ll[0].toFixed(5)}° E`;

export default function WheelPathApp() {
  const [net, setNet] = useState<Network | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const fetchNet = useCallback(() => {
    setLoadErr(null);
    fetch('/api/streets').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Street data did not load'); setNet(j as Network); })
      .catch((e: Error) => setLoadErr(e.message));
  }, []);
  useEffect(fetchNet, [fetchNet]);
  if (!net) return (
    <div className="boot" role="status" aria-live="polite">
      <div className="wm">WHEELPATH</div>
      {loadErr ? <><p className="boot-msg">The street data did not load</p><p className="boot-err">{loadErr}</p><button className="btn" onClick={fetchNet}>Try again</button></>
        : <><div className="spin" aria-hidden="true" /><p className="boot-msg">Loading the streets…</p></>}
      <p className="boot-sub">Real streets near {AREA.name} come from OpenStreetMap. The accessibility data on them is simulated.</p>
    </div>
  );
  return <App net={net} />;
}

function App({ net }: { net: Network }) {
  const engine = useMemo(() => new Engine(net), [net]);
  useEffect(() => { (window as unknown as { wheelpath: unknown }).wheelpath = { engine, net }; }, [engine, net]);

  /* ---------- state ---------- */
  const [screen, setScreen] = useState<Screen>('home');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<Mode>('demo');
  const [demoYou, setDemoYou] = useState<LngLat>(net.defaultYou);
  const [hazards, setHazardList] = useState<Hazard[]>(net.hazards);
  const [reports, setReports] = useState<Report[]>(net.reports);
  const [hazardRev, setHazardRev] = useState(0);
  const [selected, setSelected] = useState<Feature>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sel, setSel] = useState(0);
  const [warnStart, setWarnStart] = useState(false);
  const [nav, setNav] = useState<NavRun | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [rfilter, setRfilter] = useState<'all' | 'near' | 'crit'>('all');
  const [pickMode, setPickMode] = useState(false);
  const [form, setForm] = useState<{ type: HazardType; sev: Severity; note: string; ll: LngLat | null }>({ type: 'pavement', sev: 2, note: '', ll: null });
  const [comment, setComment] = useState('');
  const [arrivalRating, setArrivalRating] = useState(0);
  const [routeDetails, setRouteDetails] = useState(false);
  const [following, setFollowing] = useState(true);
  const [bearing, setBearing] = useState(0);
  const [needOrigin, setNeedOrigin] = useState(false);
  const mapH = useRef<MapHandle>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [padBottom, setPadBottom] = useState(120);
  const [wide, setWide] = useState(false);
  useEffect(() => { const mq = window.matchMedia('(min-width: 900px)'); const f = () => setWide(mq.matches); f(); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);

  /* restore per-browser settings and this browser's own reports */
  useEffect(() => {
    setPrefs(load('prefs', DEFAULT_PREFS)); setLayers(load('layers', DEFAULT_LAYERS));
    const mine = loadArr<{ h: Hazard; r: Report }>('myReports').filter((x) => x.h && x.h.geometry);
    if (mine.length) { setHazardList((l) => [...l, ...mine.map((x) => x.h)]); setReports((l) => [...mine.map((x) => x.r), ...l]); }
  }, [engine]);
  useEffect(() => save('prefs', prefs), [prefs]);
  useEffect(() => save('layers', layers), [layers]);
  useEffect(() => { engine.setHazards(hazards); setHazardRev((r) => r + 1); }, [engine, hazards]);

  const say = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? null : c)), 4200); }, []);

  /* ---------- location: demo position, or the device's live GPS (never silently swapped) ---------- */
  const geo = useGeolocation(mode === 'gps');
  const gpsLL = geo.fix?.ll ?? null;
  const gpsDist = gpsLL ? haversine(gpsLL, [net.anchor.lng, net.anchor.lat]) : null;
  const gpsUsable = !!gpsLL && !geo.stale;
  const gpsInArea = gpsUsable && gpsDist! <= AREA.roadRadius;
  const R = plan?.routes[sel] ?? null;
  const navS = nav && R ? (nav.kind === 'demo' ? engine.sAtTime(R, nav.t) : nav.s) : 0;
  const simPos: LngLat | null = screen === 'nav' && nav?.kind === 'demo' && R ? nav.off || engine.pointAt(R, navS).ll : null;
  /** where the person is shown: raw GPS fix (even far away) or the demo position */
  const shownPos: LngLat | null = mode === 'gps' ? gpsLL : simPos || demoYou;
  /** where routes start from; null when live location is on but not usable here */
  const origin: LngLat | null = mode === 'demo' ? simPos || demoYou : gpsInArea ? gpsLL : null;
  const snapped = useMemo(() => {
    if (mode !== 'gps' || !gpsInArea || !gpsLL) return null;
    const sn = engine.snap(gpsLL); return sn.dist <= SNAP_SHOW_M ? sn : null;
  }, [mode, gpsInArea, gpsLL, engine]);
  const acc = geo.fix?.accuracy ?? null, accTone = acc == null ? '' : acc <= 15 ? 'good' : acc <= 40 ? 'fair' : 'poor';
  const locNote = mode === 'demo' ? 'Demo position. Drag the dark dot to move it.'
    : geo.status === 'requesting' ? 'Asking for your location… Allow it when your browser asks.'
    : geo.status === 'denied' ? 'Location permission was denied. Allow location for this site in your browser settings, or use the demo position.'
    : geo.status === 'unsupported' || (geo.status === 'unavailable' && !gpsLL) ? (geo.error || 'Location is unavailable.') + ' You can use the demo position instead.'
    : geo.stale ? 'Your last location is more than 30 seconds old. Waiting for a new fix…'
    : gpsLL && !gpsInArea ? `You are ${fmt.dist(gpsDist!)} from the area with accessibility data, so routes can’t be rated here.`
    : gpsLL ? `Live location, accurate to about ${Math.round(acc!)} m${snapped ? `. Matched to ${engine.byId[snapped.edgeId].name}, ${Math.round(snapped.dist)} m away` : ''}.` : 'Waiting for your location…';

  const startGps = () => { setMode('gps'); setFollowing(true); setNeedOrigin(false); if (geo.status === 'denied' || geo.status === 'unavailable') geo.retry(); };
  const useDemo = () => { setMode('demo'); setNeedOrigin(false); mapH.current?.flyTo(demoYou, 17); };

  /* the map follows the live position until the person pans it */
  const fixTs = geo.fix?.timestamp;
  const centeredOnce = useRef(false);
  useEffect(() => {
    if (mode !== 'gps' || !gpsLL) { centeredOnce.current = false; return; }
    if (!centeredOnce.current) { centeredOnce.current = true; mapH.current?.flyTo(gpsLL, 17.5); return; }
    if (following) mapH.current?.follow(gpsLL);
  }, [fixTs]); // eslint-disable-line react-hooks/exhaustive-deps
  const recenter = () => { setFollowing(true); if (shownPos) mapH.current?.flyTo(shownPos, 17.5); else if (mode === 'gps') say('Waiting for your location…'); };

  /* ---------- measured bottom panel -> map padding ---------- */
  useEffect(() => {
    const el = bottomRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setPadBottom(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el); return () => ro.disconnect();
  });

  /* ---------- routing ---------- */
  const replan = useCallback((from: LngLat, keepSel = true) => {
    if (!dest) return null;
    const p = engine.findRoutes(from, dest.ll, prefs);
    setPlan(p); setSel((s) => (keepSel ? Math.min(s, p.routes.length - 1) : 0));
    return p;
  }, [dest, engine, prefs]);
  useEffect(() => { if (plan && screen === 'route' && origin) replan(origin); }, [prefs, hazardRev]); // eslint-disable-line react-hooks/exhaustive-deps

  function setDestination(p: Place) {
    if (!origin) { setNeedOrigin(true); return; }
    setDest(p); setSelected(null); setWarnStart(false); setNeedOrigin(false);
    const pl = engine.findRoutes(origin, p.ll, prefs);
    setPlan(pl); setSel(0); setRouteDetails(false); setScreen('route');
    setTimeout(() => mapH.current?.fit([...pl.routes[0].coords, origin, p.ll]), 80);
  }
  function startNav(force = false) {
    if (!R || !origin) return;
    if (R.criticalCount > 0 && !force) { setWarnStart(true); return; }
    setWarnStart(false); setRouteDetails(false);
    setNav({ kind: mode === 'gps' ? 'gps' : 'demo', t: 0, s: 0, playing: mode !== 'gps', speed: 8, off: null, offCount: 0, reroutes: 0 });
    setScreen('nav'); setFollowing(true);
    mapH.current?.flyTo(origin, 18);
  }
  function endNav(arrived: boolean) {
    if (nav?.kind === 'demo' && simPos) setDemoYou(arrived && dest ? engine.snap(dest.ll).ll : simPos);
    setNav(null);
    if (arrived) { setArrivalRating(0); setScreen('arrive'); } else setScreen('route');
  }

  /* demo: simulated time advances on animation frames; the position comes from the route geometry */
  useEffect(() => {
    if (screen !== 'nav' || !nav || nav.kind !== 'demo' || !nav.playing || nav.off) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      setNav((n) => (n && n.playing && !n.off ? { ...n, t: n.t + dt * n.speed } : n));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [screen, nav?.kind, nav?.playing, nav?.off, R]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (screen === 'nav' && nav && R && !nav.off && R.length - navS < 2) endNav(true); }, [navS]); // eslint-disable-line react-hooks/exhaustive-deps
  const followTick = Math.round(navS / 6);
  useEffect(() => { if (screen === 'nav' && nav?.kind === 'demo' && following && simPos) mapH.current?.follow(simPos); }, [followTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** leaving the path: show where the person is, then find a new path from there */
  function deviate(at: LngLat, why: string) {
    if (!nav || !dest) return;
    setNav((n) => (n ? { ...n, off: at, playing: false } : n));
    say(why + ' Finding a new path from here…');
    window.setTimeout(() => {
      const p = engine.findRoutes(at, dest.ll, prefs);
      setPlan(p); setSel(0); setDemoYou(at);
      setNav((n) => (n ? { ...n, t: 0, s: 0, off: null, playing: n.kind === 'demo', offCount: 0, reroutes: n.reroutes + 1 } : n));
      say(`New path found: ${fmt.dist(p.routes[0].length)}, ${CLS_LABEL[p.routes[0].cls].toLowerCase()}.`);
    }, 1400);
  }
  /** demo: take a wrong turn onto a real side street at the next junction */
  function wrongTurn() {
    if (!R || !nav) return;
    for (let i = 0; i < R.segs.length - 1; i++) {
      const sg = R.segs[i]; if (!sg.endNode || sg.s1 < navS + 8) continue;
      const nextE = R.segs[i + 1].e, opts = engine.adjacent(sg.endNode).filter((a) => a.e !== sg.e && a.e !== nextE && a.e.kind !== 'stairs' && a.e.len > 12);
      if (!opts.length) continue;
      const pick = opts.sort((a, b) => b.e.len - a.e.len)[0].e;
      setNav((n) => (n ? { ...n, t: R.cumT[i + 1] } : n));
      deviate(engine.pointFromNode(pick, sg.endNode, Math.min(35, pick.len * 0.8)), `Wrong turn onto ${pick.name}.`);
      return;
    }
    say('No side street left before the destination.');
  }
  /* live GPS: project the raw fix onto the route; two fixes more than 30 m off means the person left it */
  useEffect(() => {
    if (screen !== 'nav' || !nav || nav.kind !== 'gps' || !R || !gpsLL || geo.stale) return;
    if (!gpsInArea) return;
    const pr = engine.project(R, gpsLL);
    if (pr.d > OFF_ROUTE_M) {
      if (nav.offCount + 1 >= 2) { const p = replan(gpsLL, false); setNav({ ...nav, s: 0, offCount: 0, reroutes: nav.reroutes + 1 }); if (p) say('You left the path. Found a new one from where you are.'); }
      else setNav({ ...nav, offCount: nav.offCount + 1 });
    } else {
      setNav({ ...nav, s: Math.max(nav.s, pr.s), offCount: 0 });
      if (R.length - pr.s < 8) endNav(true);
    }
  }, [fixTs]); // eslint-disable-line react-hooks/exhaustive-deps

  function onYouDrag(ll: LngLat) {
    const sn = engine.snap(ll), at = sn.dist < SNAP_SHOW_M ? sn.ll : ll;
    if (screen === 'nav' && R && nav?.kind === 'demo') {
      const pr = engine.project(R, at);
      if (pr.d > 25) deviate(at, 'You left the path.');
      else setNav((n) => (n ? { ...n, t: engine.timeAt(R, pr.s) } : n));
      return;
    }
    setDemoYou(at);
    if (!sn.inCoverage) say('Outside the area with data. There is no accessibility data here.');
    if (screen === 'route' && dest) { const p = engine.findRoutes(at, dest.ll, prefs); setPlan(p); setSel(0); }
  }

  /* ---------- reports: a fixed geographic point; the engine attaches it to the pathway ---------- */
  const reportLL = form.ll || origin;
  const reportSpans = useMemo(() => (reportLL ? engine.spansFor({ type: 'Point', coordinates: reportLL }) : []), [reportLL, engine]);
  function submitReport() {
    if (!reportLL) { say('Pick the spot on the map first.'); return; }
    if (!reportSpans.length) { say(`No pathway within ${RULES.attachPoint} m of that spot. Pick a spot on a pathway.`); return; }
    const id = 'u' + Date.now().toString(36);
    const h: Hazard = { id: 'h' + id, type: form.type, sev: form.sev, source: 'user', geometry: { type: 'Point', coordinates: reportLL } };
    const r: Report = { id: 'r' + id, hazardId: h.id, title: HAZARD_TYPES[form.type].label, author: 'You', daysAgo: 0, ratings: [], contact: HAZARD_TYPES[form.type].agency, comments: [], note: form.note.trim() || undefined, simulated: false };
    setHazardList((l) => [...l, h]); setReports((l) => [r, ...l]);
    save('myReports', [...loadArr<{ h: Hazard; r: Report }>('myReports'), { h: { ...h, spans: undefined, anchor: undefined }, r }]);
    setForm({ type: 'pavement', sev: 2, note: '', ll: null }); setPickMode(false);
    setScreen('home'); setSelected({ type: 'hazard', id: h.id });
    say('Report added at its map position. Paths through it are re-rated. Saved in this browser only for now.');
  }
  const reportFor = (hid: string) => reports.find((r) => r.hazardId === hid);
  const hazardById = (hid: string) => hazards.find((h) => h.id === hid);
  const hzAnchor = (h: Hazard) => h.anchor || engine.anchorOf(h.geometry);
  const distFrom = (ll: LngLat) => (shownPos ? fmt.dist(haversine(shownPos, ll)) + ' away' : '');

  function select(f: Feature) {
    setSelected(f); setNeedOrigin(false);
    if (f?.type === 'place') { const pl = net.places.find((x) => x.id === f.id); if (pl) mapH.current?.flyTo(pl.ll); }
    if (f?.type === 'hazard') { const h = hazardById(f.id); if (h) mapH.current?.flyTo(hzAnchor(h)); }
  }
  const go = (s: Screen) => { setLayersOpen(false); setScreen(s); };
  const openReport = (ll: LngLat | null) => { setForm((f) => ({ ...f, ll })); setSelected(null); go('report'); };

  /* ================= render pieces ================= */
  const closeBtn = <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}><Icon name="close" /></button>;
  const originChoice = (
    <div className="notice"><p className="small"><b>Where are you starting from?</b> {mode === 'gps' ? locNote : 'Choose a starting position.'}</p>
      <div className="row gap wrap"><button className="btn sm" onClick={startGps}><Icon name="locate" size={16} /> Use my live location</button><button className="btn line sm" onClick={useDemo}>Use the demo position</button></div></div>
  );

  function placeCard(pl: Place) {
    const cov = engine.inCoverage(pl.ll), i = pl.info;
    const rows: [string, ReactNode][] = [];
    if (i.address) rows.push(['Address', i.address]);
    if (i.hours) rows.push(['Opening hours', i.hours]);
    if (i.phone) rows.push(['Phone', i.phone]);
    if (i.website) rows.push(['Website', <a key="w" href={i.website} target="_blank" rel="noopener noreferrer">{i.website.replace(/^https?:\/\//, '').slice(0, 40)}</a>]);
    if (i.wheelchair) rows.push(['Wheelchair (OSM tag)', i.wheelchair + ' · not checked by WheelPath']);
    return (
      <div className="card" role="dialog" aria-label={pl.name}>
        <div className="row"><div className="grow"><h2>{pl.name}</h2><p className="meta"><span className="dot" style={{ background: CATS[pl.cat].color }} />{CATS[pl.cat].label}{i.kind && i.kind !== pl.cat ? ` · ${i.kind.replace(/_/g, ' ')}` : ''}{distFrom(pl.ll) && ' · ' + distFrom(pl.ll)}</p></div>{closeBtn}</div>
        <div>{cov ? <Tag kind="info">In the area with accessibility data</Tag> : <Tag kind="limited">Outside the area with data</Tag>}</div>
        {rows.length > 0 && <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
        <p className="small">{rows.length ? '' : 'OpenStreetMap has no opening hours, address or contact details for this place. '}{i.position}: {ll5(pl.ll)}.</p>
        {needOrigin ? originChoice : <button className="btn" onClick={() => setDestination(pl)}><Icon name="flag" size={18} /> Set as destination</button>}
      </div>
    );
  }

  function hazardCard(h: Hazard) {
    const r = reportFor(h.id), ty = HAZARD_TYPES[h.type], g = h.geometry, spans = h.spans || [];
    const streets = [...new Set(spans.map((sp) => engine.byId[sp.edgeId]?.name).filter(Boolean))];
    const shape = g.type === 'Point' ? 'Point hazard' : g.type === 'LineString' ? `Blocked stretch, about ${Math.round(engine.measure(g))} m long` : `Affected area, about ${Math.round(engine.measure(g))} m²`;
    const avg = r && r.ratings.length ? r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length : null;
    return (
      <div className="card" role="dialog" aria-label="Hazard report">
        <div className="row"><div className="grow"><h2>{r?.title || ty.label}</h2><p className="meta">{ty.label}{distFrom(hzAnchor(h)) && ' · ' + distFrom(hzAnchor(h))}</p></div>{closeBtn}</div>
        <div className="row gap wrap"><SevTag sev={h.sev} /><Tag kind={h.source === 'user' ? 'info' : 'limited'}>{h.source === 'user' ? 'Your report' : SOURCE_LABEL[h.source] + ' report'}</Tag></div>
        <p className="small">{ty.desc}{r?.note ? ` “${r.note}”` : ''}</p>
        <dl className="kv">
          <dt>Geometry</dt><dd>{shape}</dd>
          <dt>Location</dt><dd className="mono">{ll5(hzAnchor(h))}</dd>
          <dt>Affects</dt><dd>{streets.length ? `${streets.join(', ')} (${spans.length} pathway stretch${spans.length > 1 ? 'es' : ''})` : 'No mapped pathway, so routes are not affected'}</dd>
        </dl>
        {r && <p className="small">Reported by {r.author} · {r.daysAgo === 0 ? 'today' : r.daysAgo + (r.daysAgo === 1 ? ' day ago' : ' days ago')}{avg != null && <> · rated {fmt.n1(avg)} <Stars value={avg} size={12} /></>} · Goes to {r.contact}</p>}
        {r && r.comments.length > 0 && <ul className="comments">{r.comments.map((c, i) => <li key={i}><b>{c.who}</b> {c.text} <span className="small">{c.ago}</span></li>)}</ul>}
        {r && (
          <form className="row gap" onSubmit={(ev) => { ev.preventDefault(); const t = comment.trim(); if (!t) return; setReports((l) => l.map((x) => (x.id === r.id ? { ...x, comments: [...x.comments, { who: 'You', text: t, ago: 'just now' }] } : x))); setComment(''); }}>
            <input className="input grow" value={comment} onChange={(e2) => setComment(e2.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
            <button className="btn sm" type="submit">Post</button>
          </form>
        )}
      </div>
    );
  }

  function featureCard(): ReactNode {
    if (!selected) return null;
    if (selected.type === 'place') { const pl = net.places.find((x) => x.id === selected.id); return pl ? placeCard(pl) : null; }
    if (selected.type === 'hazard') { const h = hazardById(selected.id); return h ? hazardCard(h) : null; }
    if (selected.type === 'edge') {
      const e = engine.byId[selected.id]; if (!e) return null;
      const ev = engine.evalEdge(e);
      return (
        <div className="card" role="dialog" aria-label="Pathway details">
          <div className="row"><div className="grow"><h2>{e.name}</h2><p className="meta">{e.kind === 'stairs' ? 'Steps' : e.kind === 'path' ? 'Footpath' : 'Street pathway'} · {fmt.dist(e.len)} long · OpenStreetMap way {e.way}</p></div>{closeBtn}</div>
          {!ev.known ? <p className="small"><Tag kind="limited">No accessibility data</Tag> {e.gap ? 'This stretch is inside the data area but has no values.' : 'This stretch is outside the data area.'} It can’t be rated, so it is never counted as accessible.</p> : (<>
            <dl className="kv">
              <dt>Average rating</dt><dd>{fmt.n1(ev.avg)} <Stars value={ev.avg} size={14} /></dd>
              <dt>Clear width</dt><dd>{e.width!.toFixed(2)} m <span className="small">(min. 1.20 m)</span></dd>
              <dt>Slope</dt><dd>{Math.abs(e.slope!).toFixed(1)} %</dd>
              <dt>Surface</dt><dd>{SURF_LABEL[e.surface!]}</dd>
              <dt>Hazard reports</dt><dd>{ev.hz.length || 'None'}</dd>
              <dt>Data source</dt><dd>{SOURCE_LABEL[e.source || 'simulated']}</dd>
            </dl>
            {e.source !== 'survey' && <p className="small">Simulated values for the prototype, not a field survey.</p>}</>)}
          <div className="row gap">
            {mode === 'demo' && <button className="btn line sm grow" onClick={() => { setDemoYou(engine.snap(engine.edgeAt(e, 0.5)).ll); setSelected(null); }}>Move me here</button>}
            <button className="btn report sm grow" onClick={() => openReport(engine.edgeAt(e, 0.5))}>Report a problem</button>
          </div>
        </div>
      );
    }
    const n = engine.nodes[selected.id]; if (!n || !n.curb) return null;
    return (
      <div className="card" role="dialog" aria-label="Crossing">
        <div className="row"><div className="grow"><h2>Crossing</h2><p className="meta">{CURB_LABEL[n.curb]}</p></div>{closeBtn}</div>
        <p className="small">{n.curb === 'missing' ? 'A missing curb ramp is a critical barrier: paths through here are rated not accessible.' : n.curb === 'steep' ? 'Steeper than 1:12. Paths through here get a lower ramp rating.' : n.curb === 'unknown' ? 'Not surveyed, so it is never counted as accessible.' : 'A curb ramp is recorded here.'} Simulated value.</p>
      </div>
    );
  }

  function tabbar() {
    const t = (s: Screen, icon: string, label: string) => <button className={'tab' + (screen === s ? ' on' : '')} onClick={() => { setSelected(null); go(s); }} aria-current={screen === s ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></button>;
    return <nav className="tabbar" aria-label="Main">{t('home', 'map', 'Map')}{t('reports', 'alert', 'Reports')}{t('prefs', 'sliders', 'Preferences')}</nav>;
  }

  function routeSheet(): ReactNode {
    if (!plan || !R || !dest) return null;
    const verdict = R.cls === 'accessible' ? { h: 'Accessible path found', p: 'Based on the recorded data, this path meets the accessibility criteria. Conditions can change, so check on site.' }
      : R.cls === 'partial' ? { h: 'Partially accessible path', p: R.unknownLen > 0 ? 'Some stretches have no data, so this path can’t be fully rated.' : 'This path has some cautions. Review them before you go.' }
      : R.cls === 'limited' ? { h: 'Not enough data to rate this path', p: 'More than half of it has no accessibility data.' }
      : { h: 'No fully accessible path found', p: 'This path has a critical barrier. As recorded, it is not suitable for wheelchair use.' };
    const crit = R.barriers.filter((b) => b.kind === 'critical'), caution = R.barriers.filter((b) => b.kind === 'caution');
    const opts = plan.routes.length > 1 && <div className="opts" role="radiogroup" aria-label="Paths">{plan.routes.map((r, i) => (
      <button key={r.id} role="radio" aria-checked={i === sel} className={'opt' + (i === sel ? ' on' : '')} onClick={() => { setSel(i); setWarnStart(false); }}>
        <b>{r.label}</b><span>{fmt.mins(r.time)} · {fmt.dist(r.length)}</span><span>{CLS_LABEL[r.cls]}{r.ratings ? ` · ${fmt.n1(r.ratings.avg)}★` : ''}{r.criticalCount ? ` · ${r.criticalCount} critical` : ''}</span>
      </button>))}</div>;
    if (!routeDetails) return (
      <div className="sheet">
        <div className={'verdict v-' + R.cls}><h2>{verdict.h}</h2><p>{verdict.p}</p><div className="row gap wrap"><ClsTag cls={R.cls} /><b>{fmt.mins(R.time)} · {fmt.dist(R.length)}</b>{R.ratings && <span className="row gap"><Stars value={R.ratings.avg} size={14} /> {fmt.n1(R.ratings.avg)}</span>}</div></div>
        {opts}
        <button className="btn line sm" onClick={() => setRouteDetails(true)}>Ratings and barriers{crit.length + caution.length ? ` (${crit.length + caution.length})` : ''}</button>
      </div>
    );
    return (
      <div className="details">
        <div className={'verdict v-' + R.cls}><h2>{verdict.h}</h2><p>{verdict.p}</p><div className="row gap wrap"><ClsTag cls={R.cls} /><b>{fmt.mins(R.time)} · {fmt.dist(R.length)}</b></div></div>
        {opts}
        <h3>{R.label}</h3>
        {R.ratings && (
          <div className="ratings">
            <div className="row"><div className="grow"><small>Average rating</small><div className="big">{fmt.n1(R.ratings.avg)}<span> / 5</span></div></div><Stars value={R.ratings.avg} size={22} /></div>
            {([['Hazards', R.ratings.hazards], ['Ramp inclination', R.ratings.ramp], ['Sidewalk width', R.ratings.width], ['Surface condition', R.ratings.surface]] as const).map(([k, v]) => (
              <div key={k} className="rat"><div className="row"><span className="grow">{k}</span><b>{fmt.n1(v)}/5</b> <Stars value={v} size={13} /></div><div className="bar"><i style={{ width: (v / 5) * 100 + '%' }} /></div></div>))}
            <p className="small">{Math.round((R.knownLen / Math.max(1, R.length)) * 100)}% of this path has data, all of it simulated for this prototype.</p>
          </div>
        )}
        {(crit.length > 0 || caution.length > 0) && <div className="barriers"><h3>Along this path</h3><ul>{[...crit, ...caution].slice(0, 10).map((b, i) => (
          <li key={i} className={'b-' + b.kind}><button onClick={() => { setRouteDetails(false); if (b.hazardId) setSelected({ type: 'hazard', id: b.hazardId }); setTimeout(() => mapH.current?.flyTo(b.ll, 18), 80); }}><b>{b.label}</b><span>{b.where} · {fmt.dist(b.s)} along{b.sEnd ? `, for about ${Math.round(b.sEnd - b.s)} m` : ''}</span></button></li>))}</ul></div>}
        {R.hazardsNear.length > 0 && <p className="small">{R.hazardsNear.length} more hazard report{R.hazardsNear.length > 1 ? 's' : ''} within {RULES.hazardBuffer} m of this path.</p>}
        <p className="small">Ratings can’t guarantee safety. Please check conditions on site.</p>
      </div>
    );
  }
  function startActions() {
    if (!R) return null;
    return (<div className="actions">
      {!origin ? originChoice : warnStart ? <><div className="warn"><Icon name="alert" /> <span><b>This path has {R.criticalCount} critical barrier{R.criticalCount > 1 ? 's' : ''}.</b> It may not be passable in a wheelchair. Start anyway?</span></div>
        <div className="row gap"><button className="btn line grow" onClick={() => setWarnStart(false)}>Go back</button><button className="btn grow" onClick={() => startNav(true)}>Start anyway</button></div></>
        : <button className="btn" onClick={() => startNav()}>Start navigation{mode === 'demo' ? ' (simulated walk)' : ''}</button>}</div>);
  }

  /* ================= screens ================= */
  const isMapScreen = screen === 'home' || (screen === 'route' && !routeDetails) || screen === 'nav' || screen === 'arrive' || (screen === 'report' && pickMode);
  const navState = screen === 'nav' && R && dest && nav ? engine.navState(R, navS, dest.name) : null;
  const topPad = screen === 'nav' ? 130 : 110;
  const locChip = (
    <button className={'loc-chip ' + (mode === 'gps' ? (gpsUsable ? 'live ' + accTone : 'warn') : 'demo')} onClick={() => go('prefs')} aria-label="Location settings">
      <Icon name="locate" size={14} /> {mode === 'demo' ? 'Demo position' : gpsUsable ? `Live · ±${Math.round(acc!)} m` : geo.status === 'requesting' ? 'Locating…' : 'No live location'}
    </button>
  );
  const fabs = (
    <div className="fabs">
      <button className={'fab' + (following ? ' on' : '')} aria-label="Recenter on my position" aria-pressed={following} onClick={recenter}><Icon name="locate" /></button>
      <button className="fab" aria-label="Map layers" onClick={() => setLayersOpen(true)}><Icon name="layers" /></button>
      {Math.abs(bearing) > 1 && <button className="fab" aria-label="Point the map north" onClick={() => mapH.current?.resetNorth()}><span className="compass" style={{ transform: `rotate(${-bearing}deg)` }}>N</span></button>}
    </div>
  );

  let overlay: ReactNode = null, bottom: ReactNode = null;
  if (screen === 'home') {
    overlay = (<><div className="top"><button className="searchbar" onClick={() => go('search')}><Icon name="search" /><span>Where would you like to go?</span></button><div className="row gap wrap"><button className="sim-pill" onClick={() => go('about')}><Icon name="info" size={14} /> Simulated accessibility data</button>{locChip}</div></div>{fabs}</>);
    bottom = (<>{featureCard() || (
      <div className="card hint"><p className="small"><b>{locNote}</b></p>
        <div className="row gap wrap">
          {mode === 'demo' ? <button className="btn sm" onClick={startGps}><Icon name="locate" size={16} /> Use my live location</button>
            : <>{(geo.status === 'denied' || geo.status === 'unavailable') && <button className="btn sm" onClick={geo.retry}>Try again</button>}<button className="btn line sm" onClick={useDemo}>Use the demo position</button></>}
          <button className="btn report sm" onClick={() => openReport(null)}><Icon name="plus" size={16} /> Report a hazard</button>
        </div></div>)}{tabbar()}</>);
  } else if (screen === 'route') {
    overlay = (<><div className="top"><div className="row gap"><button className="icon-btn solid" aria-label="Back" onClick={() => { setPlan(null); setDest(null); go('home'); }}><Icon name="back" /></button><div className="tobar grow"><small>To</small> <b>{dest?.name}</b></div></div></div>{fabs}</>);
    bottom = (<div className="routewrap">{routeSheet()}{startActions()}</div>);
  } else if (screen === 'nav' && navState && R && nav) {
    overlay = (<><div className="top"><div className="instr"><span className="instr-ic"><Icon name={navState.icon} size={30} /></span><div><b>{nav.off ? 'Off the path. Finding a new one…' : navState.text}</b><small>on {navState.street}</small></div></div></div>{fabs}</>);
    bottom = (<div className="sheet navsheet">
      <div className="bar"><i style={{ width: (navS / Math.max(1, R.length)) * 100 + '%' }} /></div>
      <div className="stats"><div><b>{fmt.mins(navState.timeLeft)}</b><small>Time left</small></div><div><b>{fmt.dist(navState.remTotal)}</b><small>Distance left</small></div><div><b>{new Date(Date.now() + navState.timeLeft * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><small>Arrive at</small></div></div>
      {nav.kind === 'gps' ? <p className="small">{locNote} If you leave the path by more than {OFF_ROUTE_M} m, WheelPath finds a new one.{nav.reroutes ? ` Re-routed ${nav.reroutes}×.` : ''}</p> : (<>
        <div className="row gap"><button className="icon-btn solid dark" aria-label={nav.playing ? 'Pause' : 'Resume'} onClick={() => setNav((n) => (n ? { ...n, playing: !n.playing } : n))} disabled={!!nav.off}><Icon name={nav.playing ? 'pause' : 'play'} /></button>
          <div className="seg grow" role="radiogroup" aria-label="Simulation speed">{[1, 4, 8, 16].map((v) => <button key={v} role="radio" aria-checked={nav.speed === v} className={nav.speed === v ? 'on' : ''} onClick={() => setNav((n) => (n ? { ...n, speed: v } : n))}>{v}×</button>)}</div></div>
        <div className="row gap"><button className="btn line sm grow" onClick={wrongTurn} disabled={!!nav.off}>Simulate a wrong turn</button></div>
        <p className="small">Simulated walk along the route at wheelchair pace ({nav.speed}× speed).{nav.reroutes ? ` Re-routed ${nav.reroutes}×.` : ''} You can also drag the dark dot off the path.</p></>)}
      <button className="btn line" onClick={() => endNav(false)}>Stop navigation</button>
    </div>);
  } else if (screen === 'arrive' && dest) {
    bottom = (<div className="sheet"><h2>You’ve arrived at {dest.name}</h2><p className="small">How accessible was this path?</p>
      <div className="rate" role="radiogroup" aria-label="Your rating">{[1, 2, 3, 4, 5].map((v) => <button key={v} role="radio" aria-checked={arrivalRating === v} aria-label={v + ' stars'} className={arrivalRating >= v ? 'on' : ''} onClick={() => setArrivalRating(v)}>★</button>)}</div>
      <div className="row gap"><button className="btn report grow" onClick={() => openReport(null)}>Report a problem</button><button className="btn grow" onClick={() => { if (arrivalRating) say('Thanks for rating this path.'); setPlan(null); setDest(null); go('home'); }}>Done</button></div></div>);
  } else if (screen === 'report' && pickMode) {
    overlay = <div className="top"><div className="card row gap"><b className="grow">Tap the map where the problem is</b><button className="btn line sm" onClick={() => setPickMode(false)}>Cancel</button></div></div>;
  }

  let page: ReactNode = null;
  if (screen === 'route' && routeDetails) {
    page = (<div className="page"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back to the map" onClick={() => setRouteDetails(false)}><Icon name="back" /></button><h1 className="grow h-sm">To {dest?.name}</h1></div>{routeSheet()}<div className="page-actions">{startActions()}</div></div>);
  } else if (screen === 'search') {
    const res = engine.searchPlaces(query, shownPos || net.defaultYou, CATS);
    page = (<div className="page"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('home')}><Icon name="back" /></button><input autoFocus className="input grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search places" aria-label="Search places" /></div>
      <div className="chips">{Object.entries(CATS).map(([k, c]) => <button key={k} className={'chip' + (query === c.label ? ' on' : '')} onClick={() => setQuery(query === c.label ? '' : c.label)}>{c.label}</button>)}</div>
      <p className="small">{net.places.length} places from OpenStreetMap, at their mapped positions. Distances are from {mode === 'gps' && gpsLL ? 'your live location' : 'the demo position'}.</p>
      <ul className="list">{res.slice(0, 40).map(({ p, d, inCov }) => (
        <li key={p.id}><button onClick={() => { setQuery(''); setScreen('home'); select({ type: 'place', id: p.id }); }}><span className="dot" style={{ background: CATS[p.cat].color }} /><span className="grow"><b>{p.name}</b><small>{CATS[p.cat].label} · {fmt.dist(d)} away</small></span>{inCov ? <Tag kind="info">Data</Tag> : <Tag kind="limited">No data</Tag>}</button></li>))}
        {!res.length && <li className="small empty">No places match.</li>}</ul></div>);
  } else if (screen === 'reports') {
    const from = shownPos || net.defaultYou;
    const list = reports.map((r) => ({ r, h: hazardById(r.hazardId) })).filter((x): x is { r: Report; h: Hazard } => !!x.h)
      .map((x) => ({ ...x, d: haversine(from, hzAnchor(x.h)) }))
      .filter((x) => (rfilter === 'near' ? x.d <= 500 : rfilter === 'crit' ? x.h.sev === 3 : true)).sort((a, b) => a.d - b.d);
    page = (<div className="page"><div className="pagehead"><h1>Reports</h1><p className="lead">Simulated hazard reports placed on real streets, plus any you add. Closest first.</p></div>
      <div className="chips">{([['all', 'All'], ['near', 'Within 500 m'], ['crit', 'Critical']] as const).map(([k, l]) => <button key={k} className={'chip' + (rfilter === k ? ' on' : '')} onClick={() => setRfilter(k)}>{l}</button>)}</div>
      <ul className="list">{list.map(({ r, h, d }) => {
        const street = h.spans?.[0] ? engine.byId[h.spans[0].edgeId]?.name : 'No mapped pathway';
        return (<li key={r.id}><button onClick={() => { setScreen('home'); select({ type: 'hazard', id: h.id }); }}>
          <span className={'hz-ic sev' + h.sev}>!</span><span className="grow"><b>{r.title}</b><small>{street} · {fmt.dist(d)} away · {h.geometry.type === 'Point' ? 'point' : h.geometry.type === 'LineString' ? 'blocked stretch' : 'area'} · {r.comments.length} comment{r.comments.length === 1 ? '' : 's'}</small><SevTag sev={h.sev} /></span></button></li>);
      })}</ul>
      <button className="btn report floating" onClick={() => openReport(null)}><Icon name="plus" size={18} /> Report a hazard</button>
      {tabbar()}</div>);
  } else if (screen === 'report' && !pickMode) {
    const sp = reportSpans[0], e = sp ? engine.byId[sp.edgeId] : null;
    const gap = reportLL && e ? Math.round(haversine(reportLL, engine.edgeAt(e, sp.t0))) : null;
    page = (<div className="page"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('home')}><Icon name="back" /></button><h1 className="grow">Report a hazard</h1></div>
      <form className="form" onSubmit={(ev) => { ev.preventDefault(); submitReport(); }}>
        <fieldset><legend>What is the problem?</legend><div className="chips">{(Object.keys(HAZARD_TYPES) as HazardType[]).map((k) => <button type="button" key={k} className={'chip' + (form.type === k ? ' on' : '')} aria-pressed={form.type === k} onClick={() => setForm((f) => ({ ...f, type: k, sev: HAZARD_TYPES[k].sev }))}>{HAZARD_TYPES[k].label}</button>)}</div></fieldset>
        <fieldset><legend>How bad is it?</legend><div className="seg">{([1, 2, 3] as Severity[]).map((v) => <button type="button" key={v} className={form.sev === v ? 'on' : ''} aria-pressed={form.sev === v} onClick={() => setForm((f) => ({ ...f, sev: v }))}>{SEV[v].label}</button>)}</div><p className="small">“Blocks wheelchair” makes paths through this spot rate as not accessible.</p></fieldset>
        <fieldset><legend>Where?</legend>
          {reportLL ? <p><b>{e ? e.name : 'Not on a pathway'}</b> <span className="small">{form.ll ? 'picked on the map' : mode === 'gps' ? 'at your live location' : 'at the demo position'} · {ll5(reportLL)}{e && gap != null ? ` · ${gap} m from the pathway` : ''}</span></p> : <p className="small">Turn on your live location or pick the spot on the map.</p>}
          {reportLL && !e && <p className="small warn-text">No pathway within {RULES.attachPoint} m. Pick a spot on a pathway so the report can affect routes.</p>}
          <button type="button" className="btn line sm" onClick={() => setPickMode(true)}><Icon name="pin" size={16} /> Pick on the map</button></fieldset>
        <label className="field"><span>Details (optional)</span><textarea className="input" rows={3} value={form.note} onChange={(e2) => setForm((f) => ({ ...f, note: e2.target.value }))} /></label>
        <p className="small">The report keeps the exact map position you chose. Goes to {HAZARD_TYPES[form.type].agency}. In this prototype reports are saved in this browser only; sharing them with other users comes next.</p>
        <button className="btn report" type="submit" disabled={!reportLL || !e}>Submit report</button>
      </form></div>);
  } else if (screen === 'prefs') {
    const t = (k: keyof Prefs, title: string, desc: string) => (<label className="toggle" key={k}><span className="grow"><b>{title}</b><small>{desc}</small></span><input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))} /><i aria-hidden="true" /></label>);
    page = (<div className="page"><div className="pagehead"><h1>Preferences</h1><p className="lead">These change which path WheelPath recommends.</p></div>
      <div className="group">{t('stairs', 'Avoid stairs', 'Never route over steps unless there is no other way.')}{t('steep', 'Avoid steep ramps', 'Adds cost to slopes steeper than 1:12.')}{t('ramps', 'Prioritize curb ramps', 'Prefers crossings with a recorded curb ramp.')}{t('shortest', 'Prioritize shortest path', 'Lets distance count for more than the ratings.')}</div>
      <h2 className="sec">Your location</h2>
      <div className="group">
        <label className="radio"><input type="radio" name="mode" checked={mode === 'demo'} onChange={useDemo} /><span><b>Demo position</b><small>A position near the school that you can drag. Use this away from Valenzuela.</small></span></label>
        <label className="radio"><input type="radio" name="mode" checked={mode === 'gps'} onChange={startGps} /><span><b>My live location</b><small>Uses your device’s GPS while the app is open. It stays on your device and is never shared.</small></span></label>
        <p className="small status">{locNote}{mode === 'gps' && (geo.status === 'denied' || geo.status === 'unavailable') && <> <button className="linkbtn" onClick={geo.retry}>Try again</button></>}</p>
      </div>
      <button className="btn line" onClick={() => go('about')}>About the data and scoring</button>
      {tabbar()}</div>);
  } else if (screen === 'about') {
    page = (<div className="page prose"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('prefs')}><Icon name="back" /></button><h1 className="grow">About the data</h1></div>
      <h2>What is real</h2><p>Streets, paths and place names come from OpenStreetMap: {net.meta.ways} ways, {net.meta.edges} pathway segments and {net.places.length} places, each at its mapped position. Source: {net.meta.source}{net.meta.osmTimestamp ? `, OpenStreetMap data as of ${new Date(net.meta.osmTimestamp).toLocaleDateString()}` : ''}. © OpenStreetMap contributors (ODbL). Your live location, if you turn it on, comes from your device.</p>
      <h2>What is simulated</h2><p>Every accessibility value is simulated for this prototype inside a {net.covRadius} m circle around {net.areaName}: widths, slopes, surfaces, curb ramps, and the hazard reports with their comments. None of it is a field survey. Each hazard has a fixed map geometry (a point, a blocked stretch or an area), and the engine attaches it to the pathway stretches it touches. Outside the circle there is no data, and stretches with no data are never rated accessible.</p>
      <h2>How a path is rated</h2><p>Each pathway gets 1 to 5 stars for width, slope, surface and reported hazards. A critical barrier (narrower than 0.90 m, steeper than 10 %, a broken surface, stairs, a missing curb ramp or a hazard that blocks a wheelchair) makes a path “Not accessible”. If more than half of it has no data it is “Limited data”. WheelPath recommends the highest-rated path with no critical barrier.</p>
      <table className="rules"><thead><tr><th>Width</th><th>Stars</th></tr></thead><tbody>{RULES.stars.width.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <table className="rules"><thead><tr><th>Slope</th><th>Stars</th></tr></thead><tbody>{RULES.stars.grade.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="small">These thresholds are prototype defaults and must be confirmed against the NCDA 2024 Revised IRR checklist (BP 344). Ratings can’t guarantee safety.</p></div>);
  }

  const LAYER_ROWS = [['access', 'Accessibility colours', 'Colour each pathway by its average stars'], ['hazards', 'Hazard reports', 'Points, blocked stretches and areas'], ['curbs', 'Curb ramps', 'Crossings with a ramp, a steep ramp or none'], ['places', 'Places', 'Schools, pharmacies, markets and more'], ['coverage', 'Area with data', 'Dims everything outside the simulated data'], ['buffers', `Hazard buffers (${RULES.hazardBuffer} m)`, 'Circles used to find nearby hazards']] as const;

  return (
    <div className={'app' + (isMapScreen ? '' : ' paged')}>
      <MapView engine={engine} hazardRev={hazardRev} hazards={hazards} places={net.places} layers={layers}
        you={shownPos} youKind={mode} youAccuracy={mode === 'gps' && gpsLL ? acc : null} snapped={snapped?.ll ?? null}
        youDraggable={mode === 'demo' && !(screen === 'nav' && nav?.off)} onYouDrag={onYouDrag} dest={dest ? { name: dest.name, ll: dest.ll } : null} routes={screen === 'route' || screen === 'nav' ? plan?.routes ?? [] : []}
        sel={sel} doneS={screen === 'nav' ? navS : null} selected={selected} onSelect={select}
        onMapClick={pickMode ? (ll) => { setForm((f) => ({ ...f, ll })); setPickMode(false); } : undefined}
        onUserMove={() => setFollowing(false)} onBearing={setBearing}
        padding={wide ? { top: 0, bottom: 0, left: isMapScreen ? 460 : 0 } : { top: isMapScreen ? topPad : 0, bottom: isMapScreen ? padBottom : 0 }} handle={mapH} />
      {isMapScreen && <>{overlay}<div className="bottom" ref={bottomRef}>{bottom}</div></>}
      {page}
      {layersOpen && (
        <div className="backdrop" onClick={() => setLayersOpen(false)}><div className="sheet layers" role="dialog" aria-label="Map layers" onClick={(e) => e.stopPropagation()}>
          <div className="row"><h2 className="grow">Map layers</h2><button className="icon-btn" aria-label="Close" onClick={() => setLayersOpen(false)}><Icon name="close" /></button></div>
          {LAYER_ROWS.map(([k, t, d]) => (
            <label className="toggle" key={k}><span className="grow"><b>{t}</b><small>{d}</small></span><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} /><i aria-hidden="true" /></label>))}
          <div className="legend"><span><i style={{ background: '#2E9E63' }} />4 stars or more</span><span><i style={{ background: '#F2A900' }} />3 to 4</span><span><i style={{ background: '#F27A1A' }} />2 to 3</span><span><i style={{ background: '#E0312F' }} />Under 2, or a critical barrier</span><span><i className="dash" />No data</span><span><i className="hzline" />Blocked stretch</span></div>
        </div></div>
      )}
      {toast && <div className={'toast' + (screen === 'nav' ? ' low' : '')} role="status">{toast}</div>}
    </div>
  );
}
