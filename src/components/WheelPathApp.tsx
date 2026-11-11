'use client';
import dynamic from 'next/dynamic';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AREA } from '@/lib/config';
import { Engine } from '@/lib/engine/engine';
import { haversine } from '@/lib/engine/geo';
import { CATS, CLS_LABEL, CURB_LABEL, HAZARD_TYPES, RULES, SEV, SURF_LABEL, fmt } from '@/lib/engine/rules';
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
const DEFAULT_LAYERS: Layers = { access: true, hazards: true, curbs: false, places: true, coverage: false, buffers: false };
const LS = 'wheelpath:v3';
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
  const locNote = mode === 'demo' ? 'Using a sample location near the school.'
    : geo.status === 'requesting' ? 'Asking for your location… Allow it when your browser asks.'
    : geo.status === 'denied' ? 'Location is blocked. Allow it in your browser settings, or use the sample location.'
    : geo.status === 'unsupported' || (geo.status === 'unavailable' && !gpsLL) ? (geo.error || 'Location is unavailable.') + ' You can use the sample location instead.'
    : geo.stale ? 'Waiting for a new location…'
    : gpsLL && !gpsInArea ? `You are ${fmt.dist(gpsDist!)} away from the mapped area. Use the sample location to try routes.`
    : gpsLL ? `Using your location (±${Math.round(acc!)} m)${snapped ? ` on ${engine.byId[snapped.edgeId].name}` : ''}` : 'Finding your location…';

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
  const go = (s: Screen) => setScreen(s);
  const openReport = (ll: LngLat | null) => { setForm((f) => ({ ...f, ll })); setSelected(null); go('report'); };

  /* ================= render pieces (kept deliberately simple) ================= */
  const [more, setMore] = useState(false);
  const [showAlts, setShowAlts] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => { setMore(false); }, [selected]);
  useEffect(() => { setShowAlts(false); }, [plan]);

  const closeBtn = <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}><Icon name="close" /></button>;
  const originChoice = (
    <div className="notice"><p><b>Where are you starting from?</b></p>{mode === 'gps' && <p className="small">{locNote}</p>}
      <div className="stack"><button className="btn" onClick={startGps}><Icon name="locate" size={18} /> Use my location</button><button className="btn line" onClick={useDemo}>Use the sample location</button></div></div>
  );
  const CLS_ICON = { accessible: 'check', partial: 'alert', not: 'close', limited: 'info' } as const;
  const VERDICT = {
    accessible: ['Accessible route', 'Based on the recorded data, this route meets the accessibility criteria.'],
    partial: ['Partially accessible', 'Some parts are difficult or have no data.'],
    not: ['Not accessible', 'This route has a barrier that may block a wheelchair.'],
    limited: ['Not enough data', 'Most of this route has no accessibility data.'],
  } as const;

  function placeCard(pl: Place) {
    const cov = engine.inCoverage(pl.ll), i = pl.info;
    return (
      <div className="card" role="dialog" aria-label={pl.name}>
        <div className="row"><div className="grow"><h2>{pl.name}</h2><p className="meta">{CATS[pl.cat].label}{distFrom(pl.ll) && ' · ' + distFrom(pl.ll)}</p></div>{closeBtn}</div>
        {!cov && <p className="small">This place is outside the mapped area, so the route can’t be fully rated.</p>}
        {needOrigin ? originChoice : <button className="btn big" onClick={() => setDestination(pl)}><Icon name="flag" size={20} /> Go here</button>}
        {(i.address || i.hours || i.phone || i.website || i.wheelchair) && <button className="linkbtn" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Less info' : 'More info'}</button>}
        {more && <dl className="kv">
          {i.address && <><dt>Address</dt><dd>{i.address}</dd></>}
          {i.hours && <><dt>Hours</dt><dd>{i.hours}</dd></>}
          {i.phone && <><dt>Phone</dt><dd>{i.phone}</dd></>}
          {i.website && <><dt>Website</dt><dd><a href={i.website} target="_blank" rel="noopener noreferrer">{i.website.replace(/^https?:\/\//, '').slice(0, 36)}</a></dd></>}
          {i.wheelchair && <><dt>Wheelchair</dt><dd>OpenStreetMap says “{i.wheelchair}” (not checked)</dd></>}
        </dl>}
      </div>
    );
  }

  function hazardCard(h: Hazard) {
    const r = reportFor(h.id), ty = HAZARD_TYPES[h.type], spans = h.spans || [];
    const street = spans[0] ? engine.byId[spans[0].edgeId]?.name : null;
    const g = h.geometry, size = g.type === 'LineString' ? `About ${Math.round(engine.measure(g))} m of path` : g.type === 'Polygon' ? `An area of about ${Math.round(engine.measure(g))} m²` : null;
    return (
      <div className="card" role="dialog" aria-label="Reported problem">
        <div className="row"><div className="grow"><h2>{r?.title || ty.label}</h2><p className="meta">{street || 'Not on a mapped path'}{distFrom(hzAnchor(h)) && ' · ' + distFrom(hzAnchor(h))}</p></div>{closeBtn}</div>
        <div className="row gap wrap"><SevTag sev={h.sev} />{h.source === 'user' ? <Tag kind="info">Your report</Tag> : <span className="small">Sample report</span>}</div>
        <p className="small">{ty.desc}{size ? ` ${size}.` : ''}{r?.note ? ` “${r.note}”` : ''}</p>
        <button className="linkbtn" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Hide details' : `Details${r && r.comments.length ? ` and ${r.comments.length} comment${r.comments.length > 1 ? 's' : ''}` : ''}`}</button>
        {more && <>
          {r && <p className="small">Reported by {r.author} {r.daysAgo === 0 ? 'today' : r.daysAgo + (r.daysAgo === 1 ? ' day ago' : ' days ago')}. Sent to {r.contact}.</p>}
          <p className="small mono">{ll5(hzAnchor(h))}</p>
          {r && r.comments.length > 0 && <ul className="comments">{r.comments.map((c, i) => <li key={i}><b>{c.who}</b> {c.text}</li>)}</ul>}
          {r && <form className="row gap" onSubmit={(ev) => { ev.preventDefault(); const t = comment.trim(); if (!t) return; setReports((l) => l.map((x) => (x.id === r.id ? { ...x, comments: [...x.comments, { who: 'You', text: t, ago: 'just now' }] } : x))); setComment(''); }}>
            <input className="input grow" value={comment} onChange={(e2) => setComment(e2.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
            <button className="btn sm" type="submit">Post</button></form>}
        </>}
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
        <div className="card" role="dialog" aria-label="Path details">
          <div className="row"><div className="grow"><h2>{e.name}</h2><p className="meta">{ev.known ? <><Stars value={ev.avg} size={14} /> {fmt.n1(ev.avg)}</> : 'No accessibility data'}</p></div>{closeBtn}</div>
          {ev.known ? <p className="small">Width {e.width!.toFixed(2)} m · Slope {Math.abs(e.slope!).toFixed(1)} % · {SURF_LABEL[e.surface!]} surface{ev.hz.length ? ` · ${ev.hz.length} reported problem${ev.hz.length > 1 ? 's' : ''}` : ''}. Sample values.</p>
            : <p className="small">This part has no data, so it is never counted as accessible.</p>}
          <button className="btn line" onClick={() => openReport(engine.edgeAt(e, 0.5))}>Report a problem here</button>
        </div>
      );
    }
    const n = engine.nodes[selected.id]; if (!n || !n.curb) return null;
    return (<div className="card" role="dialog" aria-label="Crossing"><div className="row"><div className="grow"><h2>Crossing</h2><p className="meta">{CURB_LABEL[n.curb]}</p></div>{closeBtn}</div></div>);
  }

  function tabbar() {
    const t = (s: Screen, icon: string, label: string) => <button className={'tab' + (screen === s ? ' on' : '')} onClick={() => { setSelected(null); go(s); }} aria-current={screen === s ? 'page' : undefined}><Icon name={icon} size={24} /><span>{label}</span></button>;
    return <nav className="tabbar" aria-label="Main">{t('home', 'map', 'Map')}{t('reports', 'alert', 'Problems')}{t('prefs', 'sliders', 'Settings')}</nav>;
  }

  /** the one route card: verdict, time, start */
  function routeCard(): ReactNode {
    if (!plan || !R || !dest) return null;
    const [title, sub] = VERDICT[R.cls], issues = R.barriers.filter((b) => b.kind !== 'unverified');
    return (
      <div className="sheet">
        <div className={'verdict v-' + R.cls}>
          <span className={'v-ic c-' + R.cls}><Icon name={CLS_ICON[R.cls]} size={22} /></span>
          <div className="grow"><h2>{title}</h2><p className="v-meta"><b>{fmt.mins(R.time)}</b> · {fmt.dist(R.length)}{R.ratings && <> · <Stars value={R.ratings.avg} size={14} /></>}</p><p className="small">{sub}</p></div>
        </div>
        {!origin ? originChoice : warnStart
          ? <div className="warn-box"><p><b>This route may not be passable in a wheelchair.</b></p><div className="row gap"><button className="btn line grow" onClick={() => setWarnStart(false)}>Go back</button><button className="btn grow" onClick={() => startNav(true)}>Start anyway</button></div></div>
          : <button className="btn big" onClick={() => startNav()}>Start</button>}
        <div className="links">
          <button className="linkbtn" onClick={() => setRouteDetails(true)}>What’s on the way{issues.length ? ` (${issues.length})` : ''}</button>
          {plan.routes.length > 1 && <button className="linkbtn" onClick={() => setShowAlts((v) => !v)} aria-expanded={showAlts}>{showAlts ? 'Hide other routes' : `Other routes (${plan.routes.length - 1})`}</button>}
        </div>
        {showAlts && <div className="alts" role="radiogroup" aria-label="Routes">{plan.routes.map((r, i) => (
          <button key={r.id} role="radio" aria-checked={i === sel} className={'alt' + (i === sel ? ' on' : '')} onClick={() => { setSel(i); setWarnStart(false); }}>
            <span className={'dot c-' + r.cls} /><span className="grow"><b>{CLS_LABEL[r.cls]}</b><small>{fmt.mins(r.time)} · {fmt.dist(r.length)}{r.tag === 'shortest' && i > 0 ? ' · shortest' : ''}</small></span>{i === sel && <Icon name="check" size={18} />}
          </button>))}</div>}
      </div>
    );
  }

  /** "What's on the way": plain list, then the four ratings */
  function routeDetailsPage(): ReactNode {
    if (!R) return null;
    const issues = R.barriers.filter((b) => b.kind !== 'unverified');
    const noData = Math.round(R.unknownShare * 100);
    return (
      <div className="details">
        {issues.length ? <ul className="ways">{issues.map((b, i) => (
          <li key={i}><button onClick={() => { setRouteDetails(false); if (b.hazardId) setSelected({ type: 'hazard', id: b.hazardId }); setTimeout(() => mapH.current?.flyTo(b.ll, 18), 80); }}>
            <span className={'dot ' + (b.kind === 'critical' ? 'c-not' : 'c-partial')} /><span className="grow"><b>{b.label}</b><small>{b.where} · after {fmt.dist(b.s)}</small></span></button></li>))}</ul>
          : <p>Nothing reported on this route.</p>}
        {noData > 0 && <p className="small">{noData}% of this route has no data.</p>}
        {R.ratings && <div className="ratings">
          {([['Hazards', R.ratings.hazards], ['Ramps and slopes', R.ratings.ramp], ['Sidewalk width', R.ratings.width], ['Surface', R.ratings.surface]] as const).map(([k, v]) => (
            <div key={k} className="rat"><div className="row"><span className="grow">{k}</span><b>{fmt.n1(v)}</b></div><div className="bar"><i style={{ width: (v / 5) * 100 + '%' }} /></div></div>))}
        </div>}
        <p className="small">Accessibility data here is simulated for this prototype. Always check conditions on site.</p>
      </div>
    );
  }

  /* ================= screens ================= */
  const isMapScreen = screen === 'home' || (screen === 'route' && !routeDetails) || screen === 'nav' || screen === 'arrive' || (screen === 'report' && pickMode);
  const navState = screen === 'nav' && R && dest && nav ? engine.navState(R, navS, dest.name) : null;
  const topPad = screen === 'nav' ? 130 : 90;
  const locOk = mode === 'demo' || gpsInArea;
  const fabs = (
    <div className="fabs">
      <button className={'fab' + (following ? ' on' : '')} aria-label="Show my position" onClick={recenter}><Icon name="locate" size={24} /></button>
      {Math.abs(bearing) > 1 && <button className="fab" aria-label="Point the map north" onClick={() => mapH.current?.resetNorth()}><span className="compass" style={{ transform: `rotate(${-bearing}deg)` }}>N</span></button>}
    </div>
  );

  let overlay: ReactNode = null, bottom: ReactNode = null;
  if (screen === 'home') {
    overlay = (<><div className="top"><div className="searchrow"><button className="searchbar" onClick={() => go('search')}><Icon name="search" /><span>Where do you want to go?</span></button><button className="icon-btn solid" aria-label="About this app" onClick={() => go('about')}><Icon name="info" /></button></div></div>{fabs}</>);
    bottom = (<>
      {featureCard() || <>
        <button className="fab-report" onClick={() => openReport(null)}><Icon name="plus" size={20} /> Report a problem</button>
        <div className={'loc-card' + (locOk ? '' : ' warn')}>
          <span className="grow small">{locNote}</span>
          {mode === 'demo' ? <button className="linkbtn" onClick={startGps}>Use my location</button>
            : !locOk && <button className="linkbtn" onClick={geo.status === 'denied' || geo.status === 'unavailable' ? geo.retry : useDemo}>{geo.status === 'denied' || geo.status === 'unavailable' ? 'Try again' : 'Use sample'}</button>}
        </div></>}
      {tabbar()}</>);
  } else if (screen === 'route') {
    overlay = (<><div className="top"><div className="row gap"><button className="icon-btn solid" aria-label="Back" onClick={() => { setPlan(null); setDest(null); go('home'); }}><Icon name="back" /></button><div className="tobar grow"><small>To</small> <b>{dest?.name}</b></div></div></div>{fabs}</>);
    bottom = routeCard();
  } else if (screen === 'nav' && navState && R && nav) {
    overlay = (<><div className="top"><div className="instr"><span className="instr-ic"><Icon name={navState.icon} size={30} /></span><div><b>{nav.off ? 'Off the route. Finding a new one…' : navState.text}</b><small>{navState.street}</small></div></div></div>{fabs}</>);
    bottom = (<div className="sheet navsheet">
      <div className="row"><p className="big-stat grow"><b>{fmt.mins(navState.timeLeft)}</b> · {fmt.dist(navState.remTotal)} left</p></div>
      <div className="bar"><i style={{ width: (navS / Math.max(1, R.length)) * 100 + '%' }} /></div>
      <div className="row gap">
        {nav.kind === 'demo' && <button className="btn line grow" onClick={() => setNav((n) => (n ? { ...n, playing: !n.playing } : n))} disabled={!!nav.off}><Icon name={nav.playing ? 'pause' : 'play'} size={18} /> {nav.playing ? 'Pause' : 'Resume'}</button>}
        <button className="btn stop grow" onClick={() => endNav(false)}>Stop</button>
      </div>
      {nav.kind === 'demo' && <>
        <button className="linkbtn" onClick={() => setDemoOpen((v) => !v)} aria-expanded={demoOpen}>{demoOpen ? 'Hide demo controls' : 'Demo controls'}</button>
        {demoOpen && <div className="demo">
          <div className="seg" role="radiogroup" aria-label="Speed">{[1, 4, 8, 16].map((v) => <button key={v} role="radio" aria-checked={nav.speed === v} className={nav.speed === v ? 'on' : ''} onClick={() => setNav((n) => (n ? { ...n, speed: v } : n))}>{v}×</button>)}</div>
          <button className="btn line sm" onClick={wrongTurn} disabled={!!nav.off}>Take a wrong turn</button>
          <p className="small">This is a simulated walk. You can also drag the dark dot off the route.</p>
        </div>}</>}
    </div>);
  } else if (screen === 'arrive' && dest) {
    bottom = (<div className="sheet center"><span className="v-ic c-accessible big-ic"><Icon name="check" size={30} /></span><h2>You’ve arrived</h2><p className="small">{dest.name}</p>
      <p>How was this route?</p>
      <div className="rate" role="radiogroup" aria-label="Your rating">{[1, 2, 3, 4, 5].map((v) => <button key={v} role="radio" aria-checked={arrivalRating === v} aria-label={v + ' stars'} className={arrivalRating >= v ? 'on' : ''} onClick={() => setArrivalRating(v)}>★</button>)}</div>
      <button className="btn big" onClick={() => { if (arrivalRating) say('Thank you for rating this route.'); setPlan(null); setDest(null); go('home'); }}>Done</button>
      <button className="linkbtn" onClick={() => openReport(null)}>Report a problem on the way</button></div>);
  } else if (screen === 'report' && pickMode) {
    overlay = <div className="top"><div className="card row gap"><b className="grow">Tap the spot on the map</b><button className="btn line sm" onClick={() => setPickMode(false)}>Cancel</button></div></div>;
  }

  let page: ReactNode = null;
  const back = (to: () => void, label = 'Back') => <button className="icon-btn" aria-label={label} onClick={to}><Icon name="back" /></button>;
  if (screen === 'route' && routeDetails) {
    page = (<div className="page"><div className="pagehead row gap">{back(() => setRouteDetails(false), 'Back to the map')}<h1 className="grow h-sm">What’s on the way</h1></div>{routeDetailsPage()}</div>);
  } else if (screen === 'search') {
    const res = engine.searchPlaces(query, shownPos || net.defaultYou, CATS);
    page = (<div className="page"><div className="pagehead row gap">{back(() => go('home'))}<input autoFocus className="input grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search places" aria-label="Search places" /></div>
      <div className="chips">{(['health', 'school', 'market', 'gov', 'food', 'bank'] as const).map((k) => <button key={k} className={'chip' + (query === CATS[k].label ? ' on' : '')} onClick={() => setQuery(query === CATS[k].label ? '' : CATS[k].label)}>{CATS[k].label}</button>)}</div>
      <ul className="list">{res.slice(0, 40).map(({ p, d }) => (
        <li key={p.id}><button onClick={() => { setQuery(''); setScreen('home'); select({ type: 'place', id: p.id }); }}><span className="dot" style={{ background: CATS[p.cat].color }} /><span className="grow"><b>{p.name}</b><small>{CATS[p.cat].label} · {fmt.dist(d)}</small></span></button></li>))}
        {!res.length && <li className="small empty">No places match.</li>}</ul></div>);
  } else if (screen === 'reports') {
    const from = shownPos || net.defaultYou;
    const list = reports.map((r) => ({ r, h: hazardById(r.hazardId) })).filter((x): x is { r: Report; h: Hazard } => !!x.h)
      .map((x) => ({ ...x, d: haversine(from, hzAnchor(x.h)) }))
      .filter((x) => (rfilter === 'near' ? x.d <= 500 : rfilter === 'crit' ? x.h.sev === 3 : true)).sort((a, b) => a.d - b.d);
    page = (<div className="page"><div className="pagehead"><h1>Problems</h1><p className="lead">Reported problems on the paths nearby.</p></div>
      <div className="chips">{([['all', 'All'], ['near', 'Near me'], ['crit', 'Blocking']] as const).map(([k, l]) => <button key={k} className={'chip' + (rfilter === k ? ' on' : '')} onClick={() => setRfilter(k)}>{l}</button>)}</div>
      <ul className="list">{list.map(({ r, h, d }) => (
        <li key={r.id}><button onClick={() => { setScreen('home'); select({ type: 'hazard', id: h.id }); }}>
          <span className={'hz-ic sev' + h.sev}>!</span><span className="grow"><b>{r.title}</b><small>{h.spans?.[0] ? engine.byId[h.spans[0].edgeId]?.name : 'Not on a path'} · {fmt.dist(d)}</small></span></button></li>))}</ul>
      <button className="btn report floating" onClick={() => openReport(null)}><Icon name="plus" size={18} /> Report a problem</button>
      {tabbar()}</div>);
  } else if (screen === 'report' && !pickMode) {
    const sp = reportSpans[0], e = sp ? engine.byId[sp.edgeId] : null;
    page = (<div className="page"><div className="pagehead row gap">{back(() => go('home'))}<h1 className="grow h-sm">Report a problem</h1></div>
      <form className="form" onSubmit={(ev) => { ev.preventDefault(); submitReport(); }}>
        <fieldset><legend>1. What is the problem?</legend><div className="tiles">{(Object.keys(HAZARD_TYPES) as HazardType[]).map((k) => <button type="button" key={k} className={'tile' + (form.type === k ? ' on' : '')} aria-pressed={form.type === k} onClick={() => setForm((f) => ({ ...f, type: k, sev: HAZARD_TYPES[k].sev }))}>{HAZARD_TYPES[k].label}</button>)}</div></fieldset>
        <fieldset><legend>2. How bad is it?</legend><div className="stack">{([1, 2, 3] as Severity[]).map((v) => <button type="button" key={v} className={'choice' + (form.sev === v ? ' on' : '')} aria-pressed={form.sev === v} onClick={() => setForm((f) => ({ ...f, sev: v }))}><span className={'dot sev' + v} />{SEV[v].label}</button>)}</div></fieldset>
        <fieldset><legend>3. Where is it?</legend>
          <div className="where"><span className="grow">{!reportLL ? 'Choose the spot on the map.' : e ? <><b>{e.name}</b><small>{form.ll ? 'Spot you chose' : 'At your location'}</small></> : <span className="warn-text">That spot is not on a path. Choose a spot on a path.</span>}</span>
            <button type="button" className="btn line sm" onClick={() => setPickMode(true)}><Icon name="pin" size={16} /> Choose on map</button></div></fieldset>
        {noteOpen ? <label className="field"><span>Note (optional)</span><textarea className="input" rows={3} value={form.note} onChange={(e2) => setForm((f) => ({ ...f, note: e2.target.value }))} /></label>
          : <button type="button" className="linkbtn" onClick={() => setNoteOpen(true)}>Add a note</button>}
        <button className="btn big report" type="submit" disabled={!reportLL || !e}>Send report</button>
        <p className="small">For now, reports are saved on this device only.</p>
      </form></div>);
  } else if (screen === 'prefs') {
    const t = (on: boolean, set: (v: boolean) => void, title: string, desc?: string) => (<label className="toggle" key={title}><span className="grow"><b>{title}</b>{desc && <small>{desc}</small>}</span><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><i aria-hidden="true" /></label>);
    const pf = (k: keyof Prefs) => (v: boolean) => setPrefs((p) => ({ ...p, [k]: v }));
    const ly = (k: keyof Layers) => (v: boolean) => setLayers((l) => ({ ...l, [k]: v }));
    page = (<div className="page"><div className="pagehead"><h1>Settings</h1></div>
      <h2 className="sec">My routes</h2>
      <div className="group">{t(prefs.stairs, pf('stairs'), 'Avoid stairs')}{t(prefs.steep, pf('steep'), 'Avoid steep slopes')}{t(prefs.ramps, pf('ramps'), 'Prefer curb ramps')}{t(prefs.shortest, pf('shortest'), 'Prefer shorter routes', 'Distance counts more than comfort')}</div>
      <h2 className="sec">Location</h2>
      <div className="group">{t(mode === 'gps', (v) => (v ? startGps() : useDemo()), 'Use my real location', 'Your location stays on this device.')}<p className="small status">{locNote}</p></div>
      <h2 className="sec">Map</h2>
      <div className="group">{t(layers.hazards, ly('hazards'), 'Show problems')}{t(layers.places, ly('places'), 'Show places')}{t(layers.access, ly('access'), 'Colour paths by accessibility')}{t(layers.curbs, ly('curbs'), 'Show curb ramps')}</div>
      <div className="legend"><span><i style={{ background: '#2E9E63' }} />Good</span><span><i style={{ background: '#F2A900' }} />Fair</span><span><i style={{ background: '#E0312F' }} />Difficult or blocked</span><span><i className="dash" />No data</span></div>
      <button className="btn line" onClick={() => go('about')}>About this app</button>
      {tabbar()}</div>);
  } else if (screen === 'about') {
    page = (<div className="page prose"><div className="pagehead row gap">{back(() => go('home'))}<h1 className="grow h-sm">About WheelPath</h1></div>
      <p>WheelPath helps wheelchair users find the most accessible route. It checks each path for width, slope, surface, curb ramps and reported problems.</p>
      <h2>Please note</h2><p>This is a research prototype. The streets and places are real (OpenStreetMap). The accessibility information is <b>sample data</b>, not a field survey, so always check conditions on site. Paths with no data are never called accessible.</p>
      <h2>Route ratings</h2><ul className="plain"><li><b>Accessible</b>: no barriers found in the data.</li><li><b>Partially accessible</b>: some difficult parts, or parts with no data.</li><li><b>Not accessible</b>: a barrier that may block a wheelchair, such as stairs, a missing curb ramp, a very narrow or steep path, or a blocking problem.</li><li><b>Not enough data</b>: most of the route has no data.</li></ul>
      <p className="small">Area: {net.covRadius} m around {net.areaName}. Map data © OpenStreetMap contributors. Thresholds are prototype defaults to be confirmed against the NCDA 2024 Revised IRR checklist (BP 344).</p></div>);
  }

  return (
    <div className={'app' + (isMapScreen ? '' : ' paged')}>
      <MapView engine={engine} hazardRev={hazardRev} hazards={hazards} places={net.places} layers={layers}
        you={shownPos} youKind={mode} youAccuracy={mode === 'gps' && gpsLL ? acc : null} snapped={snapped?.ll ?? null}
        youDraggable={mode === 'demo' && !(screen === 'nav' && nav?.off)} onYouDrag={onYouDrag} dest={dest ? { name: dest.name, ll: dest.ll } : null} routes={screen === 'route' ? (plan?.routes ?? []).filter((_, i) => showAlts || i === sel) : screen === 'nav' && R ? [R] : []}
        sel={screen === 'route' && !showAlts ? 0 : screen === 'nav' ? 0 : sel} doneS={screen === 'nav' ? navS : null} selected={selected} onSelect={select}
        onMapClick={pickMode ? (ll) => { setForm((f) => ({ ...f, ll })); setPickMode(false); } : undefined}
        onUserMove={() => setFollowing(false)} onBearing={setBearing}
        padding={wide ? { top: 0, bottom: 0, left: isMapScreen ? 460 : 0 } : { top: isMapScreen ? topPad : 0, bottom: isMapScreen ? padBottom : 0 }} handle={mapH} />
      {isMapScreen && <>{overlay}<div className="bottom" ref={bottomRef}>{bottom}</div></>}
      {page}
      {toast && <div className={'toast' + (screen === 'nav' ? ' low' : '')} role="status">{toast}</div>}
    </div>
  );
}
