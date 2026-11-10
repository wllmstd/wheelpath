'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
interface NavRun { s: number; playing: boolean; speed: number; off: number }

const DEFAULT_PREFS: Prefs = { stairs: true, steep: true, ramps: true, shortest: false };
const DEFAULT_LAYERS: Layers = { access: true, hazards: true, curbs: true, places: true, coverage: false, buffers: false };
const LS = 'wheelpath:v1';
function load<T extends object>(k: string, d: T): T { try { const v = localStorage.getItem(LS + ':' + k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } }
function loadArr<T>(k: string): T[] { try { const v = localStorage.getItem(LS + ':' + k); return v ? JSON.parse(v) : []; } catch { return []; } }
function save(k: string, v: unknown) { try { localStorage.setItem(LS + ':' + k, JSON.stringify(v)); } catch { /* storage blocked */ } }

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
  // inspection handle for research and testing (window.wheelpath.engine in the browser console)
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
  const mapH = useRef<MapHandle>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [padBottom, setPadBottom] = useState(120);
  const [wide, setWide] = useState(false);
  useEffect(() => { const mq = window.matchMedia('(min-width: 900px)'); const f = () => setWide(mq.matches); f(); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);

  /* restore per-browser settings and this browser's own reports */
  useEffect(() => {
    setPrefs(load('prefs', DEFAULT_PREFS)); setLayers(load('layers', DEFAULT_LAYERS));
    try { const m = localStorage.getItem(LS + ':mode'); if (m === 'gps' || m === 'demo') setMode(m); } catch { /* */ }
    const mine = loadArr<{ h: Hazard; r: Report }>('myReports').filter((x) => engine.byId[x.h.edgeId]);
    if (mine.length) { setHazardList((l) => [...l, ...mine.map((x) => ({ ...x.h, ll: engine.edgeAt(engine.byId[x.h.edgeId], x.h.t) }))]); setReports((l) => [...mine.map((x) => x.r), ...l]); }
  }, [engine]);
  useEffect(() => save('prefs', prefs), [prefs]);
  useEffect(() => save('layers', layers), [layers]);
  useEffect(() => { try { localStorage.setItem(LS + ':mode', mode); } catch { /* */ } }, [mode]);
  useEffect(() => { engine.setHazards(hazards); setHazardRev((r) => r + 1); }, [engine, hazards]);

  const say = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? null : c)), 4000); }, []);

  /* ---------- location ---------- */
  const geo = useGeolocation(mode === 'gps');
  const gpsDist = geo.fix ? haversine(geo.fix.ll, [net.anchor.lng, net.anchor.lat]) : null;
  const gpsUsable = !!geo.fix && !geo.stale && gpsDist != null && gpsDist <= AREA.roadRadius;
  const you: LngLat = mode === 'gps' && gpsUsable ? geo.fix!.ll : demoYou;
  const locNote = mode !== 'gps' ? 'Demo position. Drag the dark dot to move.'
    : geo.status === 'requesting' ? 'Asking for your location…'
    : geo.status === 'denied' ? 'Location permission denied. Using the demo position.'
    : geo.status === 'unavailable' || geo.status === 'unsupported' ? (geo.error || 'Location unavailable.') + ' Using the demo position.'
    : geo.fix && !gpsUsable ? (geo.stale ? 'Your location is out of date. Using the demo position.' : `You are ${fmt.dist(gpsDist!)} from the area with data. Using the demo position.`)
    : geo.fix ? `Using your location (±${Math.round(geo.fix.accuracy)} m)` : 'Waiting for your location…';

  /* ---------- measured bottom panel -> map padding ---------- */
  useEffect(() => {
    const el = bottomRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setPadBottom(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el); return () => ro.disconnect();
  });

  /* ---------- routing ---------- */
  const R = plan?.routes[sel] ?? null;
  const replan = useCallback((from: LngLat, keepSel = true) => {
    if (!dest) return null;
    const p = engine.findRoutes(from, dest.ll, prefs);
    setPlan(p); setSel((s) => (keepSel ? Math.min(s, p.routes.length - 1) : 0));
    return p;
  }, [dest, engine, prefs]);
  // re-rate when preferences or hazards change while a plan is open
  useEffect(() => { if (plan && screen === 'route') replan(you); }, [prefs, hazardRev]); // eslint-disable-line react-hooks/exhaustive-deps

  function findPath(p: Place) {
    setDest(p); setSelected(null); setWarnStart(false);
    const pl = engine.findRoutes(you, p.ll, prefs);
    setPlan(pl); setSel(0); setRouteDetails(false); setScreen('route');
    setTimeout(() => mapH.current?.fit([...pl.routes[0].coords, you, p.ll]), 80);
  }
  function startNav(force = false) {
    if (!R) return;
    if (R.criticalCount > 0 && !force) { setWarnStart(true); return; }
    setWarnStart(false);
    setNav({ s: 0, playing: !(mode === 'gps' && gpsUsable), speed: 8, off: 0 });
    setScreen('nav');
    mapH.current?.flyTo(you, 18);
  }
  function endNav(arrived: boolean) {
    setNav(null);
    if (arrived) { setArrivalRating(0); setScreen('arrive'); } else setScreen('route');
  }

  /* demo walk */
  useEffect(() => {
    if (screen !== 'nav' || !nav?.playing || !R) return;
    const id = window.setInterval(() => {
      setNav((n) => {
        if (!n || !n.playing) return n;
        const s = Math.min(R.length, n.s + RULES.walkSpeed * n.speed * 0.1);
        setDemoYou(engine.pointAt(R, s).ll);
        if (R.length - s < 3) { window.setTimeout(() => endNav(true), 0); return { ...n, s, playing: false }; }
        return { ...n, s };
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [screen, nav?.playing, R, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  /* real GPS: follow, detect leaving the path, re-route */
  useEffect(() => {
    if (screen !== 'nav' || !nav || nav.playing || !R || mode !== 'gps' || !gpsUsable) return;
    const pr = engine.project(R, you);
    if (pr.d > 30) {
      if (nav.off + 1 >= 2) { const p = replan(you, false); setNav({ ...nav, s: 0, off: 0 }); if (p) say('You left the path. Found a new one.'); }
      else setNav({ ...nav, off: nav.off + 1 });
    } else {
      setNav({ ...nav, s: Math.max(nav.s, pr.s), off: 0 });
      if (R.length - pr.s < 8) endNav(true);
    }
    mapH.current?.follow(you);
  }, [geo.fix?.timestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const followTick = Math.round((nav?.s ?? 0) / 8);
  useEffect(() => { if (screen === 'nav' && nav?.playing) mapH.current?.follow(you); }, [followTick]); // eslint-disable-line react-hooks/exhaustive-deps

  function onYouDrag(ll: LngLat) {
    const sn = engine.snap(ll);
    const at = sn.dist < 60 ? sn.ll : ll;
    setDemoYou(at);
    if (!sn.inCoverage) say('Outside the area with data. No accessibility data here.');
    if (screen === 'route' && dest) { const p = engine.findRoutes(at, dest.ll, prefs); setPlan(p); setSel(0); }
    if (screen === 'nav' && R) {
      const pr = engine.project(R, at);
      if (pr.d > 25) { const p = replan(at, false); setNav((n) => (n ? { ...n, s: 0 } : n)); if (p) say('You left the path. Found a new one.'); }
      else setNav((n) => (n ? { ...n, s: pr.s } : n));
    }
  }

  /* ---------- reports ---------- */
  function submitReport() {
    const ll = form.ll || you, sn = engine.snap(ll);
    if (sn.dist > 40) { say('Pick a spot closer to a pathway.'); return; }
    const id = 'u' + Date.now().toString(36);
    const h: Hazard = { id: 'h' + id, edgeId: sn.edgeId, t: sn.t, type: form.type, sev: form.sev, ll: engine.edgeAt(engine.byId[sn.edgeId], sn.t) };
    const r: Report = { id: 'r' + id, hazardId: h.id, title: HAZARD_TYPES[form.type].label, author: 'You', daysAgo: 0, ratings: [], contact: HAZARD_TYPES[form.type].agency, comments: [], note: form.note.trim() || undefined, simulated: false };
    setHazardList((l) => [...l, h]); setReports((l) => [r, ...l]);
    save('myReports', [...loadArr<{ h: Hazard; r: Report }>('myReports'), { h, r }]);
    setForm({ type: 'pavement', sev: 2, note: '', ll: null }); setPickMode(false);
    setScreen('home'); setSelected({ type: 'hazard', id: h.id });
    say('Report added. Paths near it are re-rated. Saved in this browser only for now.');
  }
  const reportFor = (hid: string) => reports.find((r) => r.hazardId === hid);
  const hazardById = (hid: string) => hazards.find((h) => h.id === hid);

  function select(f: Feature) {
    setSelected(f);
    if (f?.type === 'place') { const pl = net.places.find((x) => x.id === f.id); if (pl) mapH.current?.flyTo(pl.ll); }
  }
  const go = (s: Screen) => { setLayersOpen(false); setScreen(s); };
  const openReport = (ll: LngLat | null) => { setForm((f) => ({ ...f, ll })); setSelected(null); go('report'); };

  /* ================= render pieces ================= */
  const pill = <button className="sim-pill" onClick={() => go('about')}><Icon name="info" size={14} /> Simulated accessibility data</button>;
  const closeBtn = <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}><Icon name="close" /></button>;

  function featureCard(): ReactNode {
    if (!selected) return null;
    if (selected.type === 'place') {
      const pl = net.places.find((x) => x.id === selected.id); if (!pl) return null;
      const cov = engine.inCoverage(pl.ll);
      return (
        <div className="card" role="dialog" aria-label={pl.name}>
          <div className="row"><div className="grow"><h2>{pl.name}</h2><p className="meta"><span className="dot" style={{ background: CATS[pl.cat].color }} />{CATS[pl.cat].label} · {fmt.dist(haversine(you, pl.ll))} away</p></div>{closeBtn}</div>
          <div>{cov ? <Tag kind="info">In the area with data</Tag> : <Tag kind="limited">Outside the area with data</Tag>}</div>
          <p className="small">{pl.hours}. {pl.note}</p>
          <button className="btn" onClick={() => findPath(pl)}>Find the most accessible path</button>
        </div>
      );
    }
    if (selected.type === 'edge') {
      const e = engine.byId[selected.id]; if (!e) return null;
      const ev = engine.evalEdge(e);
      return (
        <div className="card" role="dialog" aria-label="Pathway details">
          <div className="row"><div className="grow"><h2>{e.name}</h2><p className="meta">{e.kind === 'stairs' ? 'Steps' : e.kind === 'path' ? 'Footpath' : 'Street pathway'} · {fmt.dist(e.len)} long</p></div>{closeBtn}</div>
          {!ev.known ? <p className="small"><Tag kind="limited">No accessibility data</Tag> {e.gap ? 'This stretch is inside the data area but has no values.' : 'This stretch is outside the data area.'} It can’t be rated.</p> : (<>
            <dl className="kv">
              <dt>Average rating</dt><dd>{fmt.n1(ev.avg)} <Stars value={ev.avg} size={14} /></dd>
              <dt>Clear width</dt><dd>{e.width!.toFixed(2)} m <span className="small">(min. 1.20 m)</span></dd>
              <dt>Slope</dt><dd>{Math.abs(e.slope!).toFixed(1)} %</dd>
              <dt>Surface</dt><dd>{SURF_LABEL[e.surface!]}</dd>
              <dt>Hazard reports</dt><dd>{ev.hz.length || 'None'}</dd>
            </dl>
            <p className="small">Simulated values for the prototype, not a field survey.</p></>)}
          <div className="row gap">
            {mode === 'demo' && <button className="btn line sm grow" onClick={() => { setDemoYou(engine.snap(engine.edgeAt(e, 0.5)).ll); setSelected(null); }}>Move me here</button>}
            <button className="btn report sm grow" onClick={() => openReport(engine.edgeAt(e, 0.5))}>Report a problem</button>
          </div>
        </div>
      );
    }
    if (selected.type === 'node') {
      const n = engine.nodes[selected.id]; if (!n || !n.curb) return null;
      return (
        <div className="card" role="dialog" aria-label="Crossing">
          <div className="row"><div className="grow"><h2>Crossing</h2><p className="meta">{CURB_LABEL[n.curb]}</p></div>{closeBtn}</div>
          <p className="small">{n.curb === 'missing' ? 'A missing curb ramp is a critical barrier: paths through here are rated not accessible.' : n.curb === 'steep' ? 'Steeper than 1:12. Paths through here get a lower ramp rating.' : n.curb === 'unknown' ? 'Not surveyed, so it is never counted as accessible.' : 'A curb ramp is recorded here.'} Simulated value.</p>
        </div>
      );
    }
    const h = hazardById(selected.id); if (!h) return null;
    const r = reportFor(h.id), ty = HAZARD_TYPES[h.type], e = engine.byId[h.edgeId];
    const avg = r && r.ratings.length ? r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length : null;
    return (
      <div className="card" role="dialog" aria-label="Hazard report">
        <div className="row"><div className="grow"><h2>{r?.title || ty.label}</h2><p className="meta">{e?.name} · {fmt.dist(haversine(you, h.ll!))} away</p></div>{closeBtn}</div>
        <div className="row gap wrap"><SevTag sev={h.sev} />{r && !r.simulated ? <Tag kind="info">Your report</Tag> : <Tag kind="limited">Simulated report</Tag>}</div>
        <p className="small">{ty.desc}{r?.note ? ` “${r.note}”` : ''}</p>
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
    if (!routeDetails) return (
      <div className="sheet">
        <div className={'verdict v-' + R.cls}><h2>{verdict.h}</h2><p>{verdict.p}</p><div className="row gap wrap"><ClsTag cls={R.cls} /><b>{fmt.mins(R.time)} · {fmt.dist(R.length)}</b>{R.ratings && <span className="row gap"><Stars value={R.ratings.avg} size={14} /> {fmt.n1(R.ratings.avg)}</span>}</div></div>
        {plan.routes.length > 1 && <div className="opts" role="radiogroup" aria-label="Paths">{plan.routes.map((r, i) => (
          <button key={r.id} role="radio" aria-checked={i === sel} className={'opt' + (i === sel ? ' on' : '')} onClick={() => { setSel(i); setWarnStart(false); }}>
            <b>{r.label}</b><span>{fmt.mins(r.time)} · {fmt.dist(r.length)}</span><span>{CLS_LABEL[r.cls]}{r.criticalCount ? ` · ${r.criticalCount} critical` : ''}</span>
          </button>))}</div>}
        <button className="btn line sm" onClick={() => setRouteDetails(true)}>Ratings and barriers{crit.length + caution.length ? ` (${crit.length + caution.length})` : ''}</button>
      </div>
    );
    return (
      <div className="details">
        <div className={'verdict v-' + R.cls}><h2>{verdict.h}</h2><p>{verdict.p}</p><div className="row gap wrap"><ClsTag cls={R.cls} /><b>{fmt.mins(R.time)} · {fmt.dist(R.length)}</b></div></div>
        <h3>{R.label}</h3>
        {R.ratings && (
          <div className="ratings">
            <div className="row"><div className="grow"><small>Average rating</small><div className="big">{fmt.n1(R.ratings.avg)}<span> / 5</span></div></div><Stars value={R.ratings.avg} size={22} /></div>
            {([['Hazards', R.ratings.hazards], ['Ramp inclination', R.ratings.ramp], ['Sidewalk width', R.ratings.width], ['Surface condition', R.ratings.surface]] as const).map(([k, v]) => (
              <div key={k} className="rat"><div className="row"><span className="grow">{k}</span><b>{fmt.n1(v)}/5</b> <Stars value={v} size={13} /></div><div className="bar"><i style={{ width: (v / 5) * 100 + '%' }} /></div></div>))}
            <p className="small">{Math.round((R.knownLen / Math.max(1, R.length)) * 100)}% of this path has (simulated) data.</p>
          </div>
        )}
        {(crit.length > 0 || caution.length > 0) && <div className="barriers"><h3>Along this path</h3><ul>{[...crit, ...caution].slice(0, 8).map((b, i) => (
          <li key={i} className={'b-' + b.kind}><button onClick={() => { setRouteDetails(false); setTimeout(() => mapH.current?.flyTo(b.ll, 18), 80); }}><b>{b.label}</b><span>{b.where} · {fmt.dist(b.s)} along</span></button></li>))}</ul></div>}
        {R.hazardsNear.length > 0 && <p className="small">{R.hazardsNear.length} more hazard report{R.hazardsNear.length > 1 ? 's' : ''} within {RULES.hazardBuffer} m of this path.</p>}
        <p className="small">Ratings can’t guarantee safety. Please check conditions on site.</p>
      </div>
    );
  }

  function startActions() {
    if (!R) return null;
    return (<div className="actions">
      {warnStart ? <><div className="warn"><Icon name="alert" /> <span><b>This path has {R.criticalCount} critical barrier{R.criticalCount > 1 ? 's' : ''}.</b> It may not be passable in a wheelchair. Start anyway?</span></div>
        <div className="row gap"><button className="btn line grow" onClick={() => setWarnStart(false)}>Go back</button><button className="btn grow" onClick={() => { setRouteDetails(false); startNav(true); }}>Start anyway</button></div></>
        : <button className="btn" onClick={() => { setRouteDetails(false); startNav(); }}>Start navigation</button>}</div>);
  }

  /* ================= screens ================= */
  const isMapScreen = screen === 'home' || (screen === 'route' && !routeDetails) || screen === 'nav' || screen === 'arrive' || (screen === 'report' && pickMode);
  const navState = screen === 'nav' && R && dest && nav ? engine.navState(R, nav.s, dest.name) : null;
  const topPad = screen === 'nav' ? 130 : 110;

  let overlay: ReactNode = null, bottom: ReactNode = null;
  if (screen === 'home') {
    overlay = (<>
      <div className="top"><button className="searchbar" onClick={() => go('search')}><Icon name="search" /><span>Where would you like to go?</span></button>{pill}</div>
      <div className="fabs"><button className="fab" aria-label="Center on me" onClick={() => mapH.current?.flyTo(you, 17.5)}><Icon name="locate" /></button><button className="fab" aria-label="Map layers" onClick={() => setLayersOpen(true)}><Icon name="layers" /></button></div>
    </>);
    bottom = (<>{featureCard() || <div className="card hint"><p className="small"><b>{locNote}</b></p><button className="btn report sm" onClick={() => openReport(null)}><Icon name="plus" size={16} /> Report a hazard</button></div>}{tabbar()}</>);
  } else if (screen === 'route') {
    overlay = (<div className="top"><div className="row gap"><button className="icon-btn solid" aria-label="Back" onClick={() => { setPlan(null); setDest(null); go('home'); }}><Icon name="back" /></button><div className="tobar grow"><small>To</small> <b>{dest?.name}</b></div><button className="icon-btn solid" aria-label="Map layers" onClick={() => setLayersOpen(true)}><Icon name="layers" /></button></div></div>);
    bottom = (<div className="routewrap">{routeSheet()}{startActions()}</div>);
  } else if (screen === 'nav' && navState && R && nav) {
    const following = mode === 'gps' && gpsUsable && !nav.playing;
    overlay = (<div className="top"><div className="instr"><span className="instr-ic"><Icon name={navState.icon} size={30} /></span><div><b>{navState.text}</b><small>on {navState.street}</small></div></div></div>);
    bottom = (<div className="sheet navsheet">
      <div className="bar"><i style={{ width: (nav.s / Math.max(1, R.length)) * 100 + '%' }} /></div>
      <div className="stats"><div><b>{fmt.mins(navState.timeLeft)}</b><small>Time left</small></div><div><b>{fmt.dist(navState.remTotal)}</b><small>Distance left</small></div><div><b>{new Date(Date.now() + navState.timeLeft * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><small>Arrive at</small></div></div>
      {following ? <p className="small">{locNote}. If you leave the path by more than 30 m, WheelPath finds a new one.</p> : (<>
        <div className="row gap"><button className="icon-btn solid dark" aria-label={nav.playing ? 'Pause' : 'Play'} onClick={() => setNav((n) => (n ? { ...n, playing: !n.playing } : n))}><Icon name={nav.playing ? 'pause' : 'play'} /></button>
          <div className="seg grow" role="radiogroup" aria-label="Simulation speed">{[4, 8, 16].map((v) => <button key={v} role="radio" aria-checked={nav.speed === v} className={nav.speed === v ? 'on' : ''} onClick={() => setNav((n) => (n ? { ...n, speed: v } : n))}>{v}×</button>)}</div></div>
        <p className="small">Simulated walk. Drag the dark dot off the path to try a re-route.</p></>)}
      <button className="btn line" onClick={() => endNav(false)}>End navigation</button>
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
    const res = engine.searchPlaces(query, you, CATS);
    page = (<div className="page"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('home')}><Icon name="back" /></button><input autoFocus className="input grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search places" aria-label="Search places" /></div>
      <div className="chips">{Object.entries(CATS).map(([k, c]) => <button key={k} className={'chip' + (query === c.label ? ' on' : '')} onClick={() => setQuery(query === c.label ? '' : c.label)}>{c.label}</button>)}</div>
      <ul className="list">{res.slice(0, 40).map(({ p, d, inCov }) => (
        <li key={p.id}><button onClick={() => { setQuery(''); setScreen('home'); select({ type: 'place', id: p.id }); }}><span className="dot" style={{ background: CATS[p.cat].color }} /><span className="grow"><b>{p.name}</b><small>{CATS[p.cat].label} · {fmt.dist(d)} away</small></span>{inCov ? <Tag kind="info">Data</Tag> : <Tag kind="limited">No data</Tag>}</button></li>))}
        {!res.length && <li className="small empty">No places match.</li>}</ul></div>);
  } else if (screen === 'reports') {
    const list = reports.map((r) => ({ r, h: hazardById(r.hazardId) })).filter((x): x is { r: Report; h: Hazard } => !!x.h && !!x.h.ll)
      .map((x) => ({ ...x, d: haversine(you, x.h.ll!) }))
      .filter((x) => (rfilter === 'near' ? x.d <= 500 : rfilter === 'crit' ? x.h.sev === 3 : true)).sort((a, b) => a.d - b.d);
    page = (<div className="page"><div className="pagehead"><h1>Reports</h1><p className="lead">Simulated hazard reports placed on real streets, plus any you add. Closest first.</p></div>
      <div className="chips">{([['all', 'All'], ['near', 'Within 500 m'], ['crit', 'Critical']] as const).map(([k, l]) => <button key={k} className={'chip' + (rfilter === k ? ' on' : '')} onClick={() => setRfilter(k)}>{l}</button>)}</div>
      <ul className="list">{list.map(({ r, h, d }) => (
        <li key={r.id}><button onClick={() => { setScreen('home'); setSelected({ type: 'hazard', id: h.id }); setTimeout(() => mapH.current?.flyTo(h.ll!, 18), 80); }}>
          <span className={'hz-ic sev' + h.sev}>!</span><span className="grow"><b>{r.title}</b><small>{engine.byId[h.edgeId]?.name} · {fmt.dist(d)} from you · {r.comments.length} comment{r.comments.length === 1 ? '' : 's'}</small><SevTag sev={h.sev} /></span></button></li>))}</ul>
      <button className="btn report floating" onClick={() => openReport(null)}><Icon name="plus" size={18} /> Report a hazard</button>
      {tabbar()}</div>);
  } else if (screen === 'report' && !pickMode) {
    const where = engine.snap(form.ll || you);
    page = (<div className="page"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('home')}><Icon name="back" /></button><h1 className="grow">Report a hazard</h1></div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submitReport(); }}>
        <fieldset><legend>What is the problem?</legend><div className="chips">{(Object.keys(HAZARD_TYPES) as HazardType[]).map((k) => <button type="button" key={k} className={'chip' + (form.type === k ? ' on' : '')} aria-pressed={form.type === k} onClick={() => setForm((f) => ({ ...f, type: k, sev: HAZARD_TYPES[k].sev }))}>{HAZARD_TYPES[k].label}</button>)}</div></fieldset>
        <fieldset><legend>How bad is it?</legend><div className="seg">{([1, 2, 3] as Severity[]).map((v) => <button type="button" key={v} className={form.sev === v ? 'on' : ''} aria-pressed={form.sev === v} onClick={() => setForm((f) => ({ ...f, sev: v }))}>{SEV[v].label}</button>)}</div><p className="small">“Blocks wheelchair” makes paths through this spot rate as not accessible.</p></fieldset>
        <fieldset><legend>Where?</legend><p><b>{engine.byId[where.edgeId].name}</b> <span className="small">{form.ll ? 'picked on the map' : 'at your position'}</span></p><button type="button" className="btn line sm" onClick={() => setPickMode(true)}><Icon name="pin" size={16} /> Pick on the map</button></fieldset>
        <label className="field"><span>Details (optional)</span><textarea className="input" rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>
        <p className="small">Goes to {HAZARD_TYPES[form.type].agency}. In this prototype reports are saved in this browser only; sharing them with other users comes next.</p>
        <button className="btn report" type="submit">Submit report</button>
      </form></div>);
  } else if (screen === 'prefs') {
    const t = (k: keyof Prefs, title: string, desc: string) => (<label className="toggle" key={k}><span className="grow"><b>{title}</b><small>{desc}</small></span><input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))} /><i aria-hidden="true" /></label>);
    page = (<div className="page"><div className="pagehead"><h1>Preferences</h1><p className="lead">These change which path WheelPath recommends.</p></div>
      <div className="group">{t('stairs', 'Avoid stairs', 'Never route over steps unless there is no other way.')}{t('steep', 'Avoid steep ramps', 'Adds cost to slopes steeper than 1:12.')}{t('ramps', 'Prioritize curb ramps', 'Prefers crossings with a recorded curb ramp.')}{t('shortest', 'Prioritize shortest path', 'Lets distance count for more than the ratings.')}</div>
      <h2 className="sec">Your location</h2>
      <div className="group">
        <label className="radio"><input type="radio" name="mode" checked={mode === 'demo'} onChange={() => setMode('demo')} /><span><b>Demo position</b><small>A position near the school that you can drag. Use this away from Valenzuela.</small></span></label>
        <label className="radio"><input type="radio" name="mode" checked={mode === 'gps'} onChange={() => setMode('gps')} /><span><b>My phone’s location</b><small>Uses GPS while the app is open. Your location stays on your phone.</small></span></label>
        <p className="small status">{locNote}</p>
      </div>
      <button className="btn line" onClick={() => go('about')}>About the data and scoring</button>
      {tabbar()}</div>);
  } else if (screen === 'about') {
    page = (<div className="page prose"><div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={() => go('prefs')}><Icon name="back" /></button><h1 className="grow">About the data</h1></div>
      <h2>What is real</h2><p>Streets, paths and place names come from OpenStreetMap: {net.meta.ways} ways, {net.meta.edges} pathway segments and {net.places.length} places. Source: {net.meta.source}{net.meta.osmTimestamp ? `, OpenStreetMap data as of ${new Date(net.meta.osmTimestamp).toLocaleDateString()}` : ''}. © OpenStreetMap contributors (ODbL).</p>
      <h2>What is simulated</h2><p>Every accessibility value is simulated for this prototype inside a {net.covRadius} m circle around {net.areaName}: widths, slopes, surfaces, curb ramps, the hazard reports and their comments. None of it is a field survey. Outside the circle there is no data, and stretches with no data are never rated accessible.</p>
      <h2>How a path is rated</h2><p>Each pathway gets 1 to 5 stars for width, slope, surface and reported hazards. A critical barrier (narrower than 0.90 m, steeper than 10 %, a broken surface, stairs, a missing curb ramp or a hazard that blocks a wheelchair) makes a path “Not accessible”. If more than half of it has no data it is “Limited data”. WheelPath recommends the highest-rated path with no critical barrier.</p>
      <table className="rules"><thead><tr><th>Width</th><th>Stars</th></tr></thead><tbody>{RULES.stars.width.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <table className="rules"><thead><tr><th>Slope</th><th>Stars</th></tr></thead><tbody>{RULES.stars.grade.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="small">These thresholds are prototype defaults and must be confirmed against the NCDA 2024 Revised IRR checklist (BP 344). Ratings can’t guarantee safety.</p></div>);
  }

  const LAYER_ROWS = [['access', 'Accessibility colours', 'Colour each pathway by its average stars'], ['hazards', 'Hazard reports', 'Pins for reported obstacles'], ['curbs', 'Curb ramps', 'Crossings with a ramp, a steep ramp or none'], ['places', 'Places', 'Schools, pharmacies, markets and more'], ['coverage', 'Area with data', 'Dims everything outside the simulated data'], ['buffers', `Hazard buffers (${RULES.hazardBuffer} m)`, 'Circles used to find nearby hazards']] as const;

  return (
    <div className={'app' + (isMapScreen ? '' : ' paged')}>
      <MapView engine={engine} hazardRev={hazardRev} hazards={hazards} places={net.places} layers={layers} you={you} youAccuracy={mode === 'gps' && gpsUsable ? geo.fix!.accuracy : null}
        youDraggable={mode === 'demo' || !gpsUsable} onYouDrag={onYouDrag} dest={dest ? { name: dest.name, ll: dest.ll } : null} routes={screen === 'route' || screen === 'nav' ? plan?.routes ?? [] : []}
        sel={sel} doneS={screen === 'nav' ? nav?.s ?? null : null} selected={selected} onSelect={select}
        onMapClick={pickMode ? (ll) => { setForm((f) => ({ ...f, ll })); setPickMode(false); } : undefined}
        padding={wide ? { top: 0, bottom: 0, left: isMapScreen ? 460 : 0 } : { top: isMapScreen ? topPad : 0, bottom: isMapScreen ? padBottom : 0 }} handle={mapH} />
      {isMapScreen && <>{overlay}<div className="bottom" ref={bottomRef}>{bottom}</div></>}
      {page}
      {layersOpen && (
        <div className="backdrop" onClick={() => setLayersOpen(false)}><div className="sheet layers" role="dialog" aria-label="Map layers" onClick={(e) => e.stopPropagation()}>
          <div className="row"><h2 className="grow">Map layers</h2><button className="icon-btn" aria-label="Close" onClick={() => setLayersOpen(false)}><Icon name="close" /></button></div>
          {LAYER_ROWS.map(([k, t, d]) => (
            <label className="toggle" key={k}><span className="grow"><b>{t}</b><small>{d}</small></span><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} /><i aria-hidden="true" /></label>))}
          <div className="legend"><span><i style={{ background: '#2E9E63' }} />4 stars or more</span><span><i style={{ background: '#F2A900' }} />3 to 4</span><span><i style={{ background: '#F27A1A' }} />2 to 3</span><span><i style={{ background: '#E0312F' }} />Under 2, or a critical barrier</span><span><i className="dash" />No data</span></div>
        </div></div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
