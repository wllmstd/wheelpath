'use client';
/* MapLibre map: OpenFreeMap vector basemap + WheelPath GIS overlays.
   Every WheelPath feature (pathways, hazards, places, routes) is a GeoJSON source in [lng, lat],
   drawn by MapLibre layers, so zooming, panning and rotating can never move it off its location. */
import maplibregl, { type GeoJSONSource, type Map as MLMap, type MapGeoJSONFeature, type Marker, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { FALLBACK_RASTER_STYLE, MAP_STYLE_URL } from '@/lib/config';
import type { Engine } from '@/lib/engine/engine';
import { circle } from '@/lib/engine/geo';
import { CATS, RULES } from '@/lib/engine/rules';
import type { EdgeEval, Hazard, LngLat, Place, Route } from '@/lib/engine/types';

export const COL = { teal: '#1C747C', navy: '#2C344C', good: '#2E9E63', fair: '#F2A900', poor: '#F27A1A', bad: '#E0312F', unknown: '#7D8791', gps: '#2563EB' };
const SEV_COL: Record<number, string> = { 1: '#F5D547', 2: '#F2A900', 3: '#FC3434' };
export function accessColor(ev: EdgeEval) {
  if (!ev.known) return COL.unknown;
  if (ev.crit.length) return COL.bad;
  const a = ev.avg!; return a >= 4 ? COL.good : a >= 3 ? COL.fair : a >= 2 ? COL.poor : COL.bad;
}

export interface Layers { access: boolean; hazards: boolean; curbs: boolean; places: boolean; coverage: boolean; buffers: boolean }
export type Feature = { type: 'place' | 'edge' | 'hazard' | 'node'; id: string } | null;
export interface MapHandle {
  fit(lls: LngLat[], maxZoom?: number): void;
  flyTo(ll: LngLat, zoom?: number): void;
  follow(ll: LngLat): void;
  resetNorth(): void;
}

interface Props {
  engine: Engine;
  hazardRev: number;
  hazards: Hazard[];
  places: Place[];
  layers: Layers;
  /** the position marker: demo position, or the raw GPS fix */
  you: LngLat | null;
  youKind: 'demo' | 'gps';
  /** GPS accuracy radius (m) */
  youAccuracy?: number | null;
  /** where the position is matched onto the pedestrian network (shown separately from the raw GPS fix) */
  snapped?: LngLat | null;
  youDraggable: boolean;
  onYouDrag(ll: LngLat): void;
  dest: { name: string; ll: LngLat } | null;
  routes: Route[];
  sel: number;
  doneS: number | null;
  selected: Feature;
  onSelect(f: Feature): void;
  onMapClick?(ll: LngLat): void;
  onUserMove?(): void;
  onBearing?(b: number): void;
  padding: { top: number; bottom: number; left?: number };
  handle: Ref<MapHandle>;
}

const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });
async function pickStyle(): Promise<string | StyleSpecification> {
  try {
    const r = await fetch(MAP_STYLE_URL, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return MAP_STYLE_URL;
  } catch { /* fall through */ }
  return FALLBACK_RASTER_STYLE as unknown as StyleSpecification;
}

/* ---------- map icons drawn once on a canvas (no extra image files or fonts needed) ---------- */
function icon(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const r = 2, cv = document.createElement('canvas'); cv.width = cv.height = size * r;
  const c = cv.getContext('2d')!; c.scale(r, r); draw(c, size);
  return { width: size * r, height: size * r, data: new Uint8Array(c.getImageData(0, 0, size * r, size * r).data.buffer) };
}
function addIcons(m: MLMap) {
  for (const sev of [1, 2, 3]) for (const on of [false, true]) {
    const S = on ? 40 : 32;
    m.addImage(`hz-${sev}${on ? '-on' : ''}`, icon(S, (c, s) => {
      const R = s / 2 - (on ? 4 : 2);
      if (on) { c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 1, 0, 7); c.fillStyle = 'rgba(148,68,220,.45)'; c.fill(); }
      c.beginPath(); c.arc(s / 2, s / 2, R, 0, 7); c.fillStyle = SEV_COL[sev]; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke();
      c.fillStyle = sev === 3 ? '#fff' : COL.navy; c.font = `800 ${Math.round(R * 1.15)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', s / 2, s / 2 + 1);
    }), { pixelRatio: 2 });
  }
  for (const [cat, v] of Object.entries(CATS)) for (const on of [false, true]) {
    const S = on ? 30 : 22;
    m.addImage(`pl-${cat}${on ? '-on' : ''}`, icon(S, (c, s) => {
      if (on) { c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 1, 0, 7); c.fillStyle = 'rgba(148,68,220,.35)'; c.fill(); }
      const h = on ? 8 : 7; c.save(); c.translate(s / 2, s / 2); c.rotate(Math.PI / 4);
      c.fillStyle = '#fff'; c.fillRect(-h - 1.5, -h - 1.5, 2 * h + 3, 2 * h + 3);
      c.fillStyle = on ? v.color : '#fff'; c.strokeStyle = v.color; c.lineWidth = 3.5; c.fillRect(-h + 1.75, -h + 1.75, 2 * h - 3.5, 2 * h - 3.5); c.strokeRect(-h + 1.75, -h + 1.75, 2 * h - 3.5, 2 * h - 3.5);
      c.restore();
    }), { pixelRatio: 2 });
  }
}

export default function MapView(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const youM = useRef<Marker | null>(null), destM = useRef<Marker | null>(null);
  const props = useRef(p); props.current = p;

  useImperativeHandle(p.handle, () => ({
    fit(lls, maxZoom = 18) {
      const m = mapRef.current; if (!m || !lls.length) return;
      const b = new maplibregl.LngLatBounds(lls[0], lls[0]); lls.forEach((l) => b.extend(l));
      // the map's own padding already reserves the top bar and the bottom sheet; this is extra margin
      m.fitBounds(b, { padding: 36, maxZoom, duration: 600, bearing: m.getBearing() });
    },
    flyTo(ll, zoom) { mapRef.current?.easeTo({ center: ll, zoom: zoom ?? Math.max(mapRef.current.getZoom(), 17), duration: 600 }); },
    follow(ll) { mapRef.current?.easeTo({ center: ll, duration: 400 }); },
    resetNorth() { mapRef.current?.easeTo({ bearing: 0, duration: 400 }); },
  }), []);

  /* ---------- create the map once ---------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      const style = await pickStyle();
      if (dead || !box.current) return;
      const start = props.current.you || props.current.engine.net.defaultYou;
      const m = new maplibregl.Map({ container: box.current, style, center: start, zoom: 16.4, attributionControl: { compact: true }, pitchWithRotate: false, maxPitch: 0 });
      mapRef.current = m;
      (window as unknown as { wheelpathMap: MLMap }).wheelpathMap = m;
      m.on('load', () => {
        addIcons(m);
        const before = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
        for (const id of ['wp-cov', 'wp-edges', 'wp-buffers', 'wp-routes', 'wp-done', 'wp-curbs', 'wp-acc', 'wp-snap', 'wp-hazards', 'wp-hazard-pins', 'wp-places']) m.addSource(id, { type: 'geojson', data: empty() });
        const sevColor = ['match', ['get', 'sev'], 3, SEV_COL[3], 2, SEV_COL[2], SEV_COL[1]] as unknown as string;
        m.addLayer({ id: 'wp-cov', type: 'fill', source: 'wp-cov', paint: { 'fill-color': COL.navy, 'fill-opacity': 0.14 } }, before);
        m.addLayer({ id: 'wp-edges-case', type: 'line', source: 'wp-edges', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 9] } }, before);
        m.addLayer({ id: 'wp-edges', type: 'line', source: 'wp-edges', filter: ['==', ['get', 'known'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 5.5] } }, before);
        m.addLayer({ id: 'wp-edges-unk', type: 'line', source: 'wp-edges', filter: ['==', ['get', 'known'], false], paint: { 'line-color': COL.unknown, 'line-dasharray': [1.4, 1.2], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.4, 18, 4] } }, before);
        m.addLayer({ id: 'wp-edges-hit', type: 'line', source: 'wp-edges', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
        m.addLayer({ id: 'wp-buffers', type: 'fill', source: 'wp-buffers', paint: { 'fill-color': COL.bad, 'fill-opacity': 0.1, 'fill-outline-color': COL.bad } });
        /* extended hazards: blocked stretches (lines) and areas (polygons), drawn in real map units */
        m.addLayer({ id: 'wp-hz-area', type: 'fill', source: 'wp-hazards', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': sevColor, 'fill-opacity': ['case', ['get', 'on'], 0.5, 0.32] } });
        m.addLayer({ id: 'wp-hz-area-line', type: 'line', source: 'wp-hazards', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': sevColor, 'line-width': 1.5, 'line-dasharray': [2, 1.5] } });
        m.addLayer({ id: 'wp-hz-line-case', type: 'line', source: 'wp-hazards', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 13] } });
        m.addLayer({ id: 'wp-hz-line', type: 'line', source: 'wp-hazards', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': sevColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 9], 'line-dasharray': [1, 0.6] } });
        m.addLayer({ id: 'wp-routes-case', type: 'line', source: 'wp-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'sel'], 12, 9] } });
        m.addLayer({ id: 'wp-routes', type: 'line', source: 'wp-routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'sel'], 2, 1] }, paint: { 'line-color': ['case', ['get', 'sel'], COL.teal, '#86BCC1'], 'line-width': ['case', ['get', 'sel'], 7, 5] } });
        m.addLayer({ id: 'wp-done', type: 'line', source: 'wp-done', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#9AA5AE', 'line-width': 7 } });
        m.addLayer({ id: 'wp-curbs', type: 'circle', source: 'wp-curbs', minzoom: 15.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 3, 18, 6], 'circle-color': ['match', ['get', 'curb'], 'ok', COL.good, 'steep', COL.poor, 'missing', COL.bad, COL.unknown], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
        m.addLayer({ id: 'wp-acc', type: 'fill', source: 'wp-acc', paint: { 'fill-color': COL.gps, 'fill-opacity': 0.12, 'fill-outline-color': COL.gps } });
        m.addLayer({ id: 'wp-snap', type: 'circle', source: 'wp-snap', paint: { 'circle-radius': 5, 'circle-color': COL.teal, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'wp-places', type: 'symbol', source: 'wp-places', layout: { 'icon-image': ['concat', 'pl-', ['get', 'cat'], ['case', ['get', 'on'], '-on', '']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 16.5, 0.7, 18, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'on'], 2, 1] } });
        m.addLayer({ id: 'wp-hz-pins', type: 'symbol', source: 'wp-hazard-pins', layout: { 'icon-image': ['concat', 'hz-', ['to-string', ['get', 'sev']], ['case', ['get', 'on'], '-on', '']], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'on'], 2, 1] } });
        ready.current = true;
        syncAll();
      });
      const HIT = ['wp-hz-pins', 'wp-places', 'wp-hz-line', 'wp-hz-area', 'wp-curbs', 'wp-edges-hit'];
      m.on('click', (ev) => {
        const P = props.current;
        if (P.onMapClick) { P.onMapClick([ev.lngLat.lng, ev.lngLat.lat]); return; }
        const fs: MapGeoJSONFeature[] = m.queryRenderedFeatures([[ev.point.x - 8, ev.point.y - 8], [ev.point.x + 8, ev.point.y + 8]], { layers: HIT.filter((l) => m.getLayer(l)) });
        fs.sort((a, b) => HIT.indexOf(a.layer.id) - HIT.indexOf(b.layer.id));
        const f = fs[0];
        if (!f) return P.onSelect(null);
        const id = String(f.properties.id), L = f.layer.id;
        P.onSelect(L.startsWith('wp-hz') ? { type: 'hazard', id } : L === 'wp-places' ? { type: 'place', id } : L === 'wp-curbs' ? { type: 'node', id } : { type: 'edge', id });
      });
      for (const l of HIT) {
        m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', l, () => { m.getCanvas().style.cursor = props.current.onMapClick ? 'crosshair' : ''; });
      }
      m.on('dragstart', () => props.current.onUserMove?.());
      m.on('rotate', () => props.current.onBearing?.(m.getBearing()));
    })();
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; ready.current = false; youM.current = destM.current = null; };
  }, []);

  /* ---------- data sync ---------- */
  function setData(id: string, d: GeoJSON.FeatureCollection) { (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(d); }
  function vis(ids: string[], on: boolean) { const m = mapRef.current; for (const id of ids) if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }

  function syncNetwork() {
    const { engine, layers } = props.current;
    setData('wp-edges', { type: 'FeatureCollection', features: engine.edges.filter((e) => e.kind !== 'path' || e.surveyed).map((e) => {
      const ev = engine.evalEdge(e);
      return { type: 'Feature', properties: { id: e.id, known: ev.known, color: accessColor(ev) }, geometry: { type: 'LineString', coordinates: engine.edgeCoords(e) } };
    }) });
    setData('wp-curbs', { type: 'FeatureCollection', features: Object.values(engine.nodes).filter((n) => n.curb).map((n) => ({ type: 'Feature', properties: { id: n.id, curb: n.curb }, geometry: { type: 'Point', coordinates: n.ll } })) });
    const world: GeoJSON.Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    setData('wp-cov', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, engine.net.coverage.slice().reverse()] } }] });
    vis(['wp-edges', 'wp-edges-unk', 'wp-edges-case'], layers.access); vis(['wp-curbs'], layers.curbs); vis(['wp-cov'], layers.coverage); vis(['wp-buffers'], layers.buffers);
  }
  function syncFeatures() {
    const P = props.current, selHz = P.selected?.type === 'hazard' ? P.selected.id : null, selPl = P.selected?.type === 'place' ? P.selected.id : null;
    const hz = P.layers.hazards ? P.hazards : [], anchor = (h: Hazard) => h.anchor || P.engine.anchorOf(h.geometry);
    setData('wp-hazards', { type: 'FeatureCollection', features: hz.filter((h) => h.geometry.type !== 'Point').map((h) => ({ type: 'Feature', properties: { id: h.id, sev: h.sev, on: h.id === selHz }, geometry: h.geometry as GeoJSON.Geometry })) });
    /* one pin per hazard: its own point, or the representative point of a line or area */
    setData('wp-hazard-pins', { type: 'FeatureCollection', features: hz.map((h) => ({ type: 'Feature', properties: { id: h.id, sev: h.sev, on: h.id === selHz }, geometry: { type: 'Point', coordinates: h.geometry.type === 'Point' ? h.geometry.coordinates : anchor(h) } })) });
    setData('wp-buffers', { type: 'FeatureCollection', features: P.hazards.map((h) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(anchor(h), RULES.hazardBuffer, 32)] } })) });
    setData('wp-places', { type: 'FeatureCollection', features: (P.layers.places ? P.places : []).map((pl) => ({ type: 'Feature', properties: { id: pl.id, cat: pl.cat, on: pl.id === selPl }, geometry: { type: 'Point', coordinates: pl.ll } })) });
  }
  function syncRoutes() {
    const P = props.current, R = P.routes[P.sel];
    setData('wp-routes', { type: 'FeatureCollection', features: P.routes.map((r, i) => ({ type: 'Feature', properties: { i, sel: i === P.sel }, geometry: { type: 'LineString', coordinates: r.coords } })) });
    const done = R && P.doneS != null && P.doneS > 0.5 ? P.engine.slice(R, 0, P.doneS) : [];
    setData('wp-done', { type: 'FeatureCollection', features: done.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } }] : [] });
  }
  function syncYou() {
    const P = props.current, m = mapRef.current; if (!m) return;
    if (P.you) {
      if (!youM.current) {
        const el = document.createElement('div'); el.classList.add('mk-you'); el.setAttribute('aria-label', 'Your position');
        youM.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(P.you).addTo(m);
        youM.current.on('dragend', () => { const l = youM.current!.getLngLat(); props.current.onYouDrag([l.lng, l.lat]); });
      }
      youM.current.setLngLat(P.you).setDraggable(P.youDraggable);
      const el = youM.current.getElement();
      el.classList.toggle('drag', P.youDraggable); el.classList.toggle('gps', P.youKind === 'gps');
    } else if (youM.current) { youM.current.remove(); youM.current = null; }
    setData('wp-acc', { type: 'FeatureCollection', features: P.you && P.youAccuracy ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(P.you, Math.min(P.youAccuracy, 500), 48)] } }] : [] });
    setData('wp-snap', { type: 'FeatureCollection', features: P.snapped ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: P.snapped } }] : [] });
    if (P.dest) {
      if (!destM.current) { const el = document.createElement('div'); el.classList.add('mk-dest'); el.setAttribute('aria-label', 'Destination'); destM.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(P.dest.ll).addTo(m); }
      destM.current.setLngLat(P.dest.ll);
    } else if (destM.current) { destM.current.remove(); destM.current = null; }
  }
  function syncAll() { if (!ready.current) return; syncNetwork(); syncFeatures(); syncRoutes(); syncYou(); }

  useEffect(() => { if (ready.current) syncNetwork(); }, [p.engine, p.hazardRev, p.layers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready.current) syncFeatures(); }, [p.engine, p.hazardRev, p.layers, p.hazards, p.places, p.selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready.current) syncRoutes(); }, [p.routes, p.sel, p.doneS]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready.current) syncYou(); }, [p.you, p.youDraggable, p.youAccuracy, p.youKind, p.snapped, p.dest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mapRef.current?.setPadding({ top: p.padding.top, bottom: p.padding.bottom, left: p.padding.left ?? 0, right: 0 }); }, [p.padding.top, p.padding.bottom, p.padding.left]);
  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = p.onMapClick ? 'crosshair' : ''; }, [p.onMapClick]);

  return <div className="map" role="region" aria-label="Map"><div ref={box} className="map-inner" /></div>;
}
