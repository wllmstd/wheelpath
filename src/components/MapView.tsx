'use client';
/* MapLibre map: OpenFreeMap vector basemap + WheelPath GIS overlays. */
import maplibregl, { type GeoJSONSource, type Map as MLMap, type Marker, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { FALLBACK_RASTER_STYLE, MAP_STYLE_URL } from '@/lib/config';
import type { Engine } from '@/lib/engine/engine';
import { circle } from '@/lib/engine/geo';
import { CATS, RULES } from '@/lib/engine/rules';
import type { EdgeEval, Hazard, LngLat, Place, Route } from '@/lib/engine/types';

export const COL = { teal: '#1C747C', navy: '#2C344C', good: '#2E9E63', fair: '#F2A900', poor: '#F27A1A', bad: '#E0312F', unknown: '#7D8791' };
export function accessColor(ev: EdgeEval) {
  if (!ev.known) return COL.unknown;
  if (ev.crit.length) return COL.bad;
  const a = ev.avg!; return a >= 4 ? COL.good : a >= 3 ? COL.fair : a >= 2 ? COL.poor : COL.bad;
}

export interface Layers { access: boolean; hazards: boolean; curbs: boolean; places: boolean; coverage: boolean; buffers: boolean }
export type Feature = { type: 'place' | 'edge' | 'hazard' | 'node'; id: string } | null;
export interface MapHandle { fit(lls: LngLat[], maxZoom?: number): void; flyTo(ll: LngLat, zoom?: number): void; follow(ll: LngLat): void }

interface Props {
  engine: Engine;
  hazardRev: number;
  hazards: Hazard[];
  places: Place[];
  layers: Layers;
  you: LngLat;
  youAccuracy?: number | null;
  youDraggable: boolean;
  onYouDrag(ll: LngLat): void;
  dest: { name: string; ll: LngLat } | null;
  routes: Route[];
  sel: number;
  doneS: number | null;
  selected: Feature;
  onSelect(f: Feature): void;
  onMapClick?(ll: LngLat): void;
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

export default function MapView(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<Record<string, Marker>>({});
  const youM = useRef<Marker | null>(null), destM = useRef<Marker | null>(null);
  const props = useRef(p); props.current = p;

  useImperativeHandle(p.handle, () => ({
    fit(lls, maxZoom = 18) {
      const m = mapRef.current; if (!m || !lls.length) return;
      const b = new maplibregl.LngLatBounds(lls[0], lls[0]); lls.forEach((l) => b.extend(l));
      // the map's own padding already reserves the top bar and the bottom sheet; this is extra margin
      m.fitBounds(b, { padding: 36, maxZoom, duration: 600 });
    },
    flyTo(ll, zoom) { mapRef.current?.easeTo({ center: ll, zoom: zoom ?? Math.max(mapRef.current.getZoom(), 17), duration: 600 }); },
    follow(ll) { mapRef.current?.easeTo({ center: ll, duration: 400 }); },
  }), []);

  /* ---------- create the map once ---------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      const style = await pickStyle();
      if (dead || !box.current) return;
      const m = new maplibregl.Map({ container: box.current, style, center: props.current.you, zoom: 16.4, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
      m.touchZoomRotate.disableRotation();
      mapRef.current = m;
      (window as unknown as { wheelpathMap: MLMap }).wheelpathMap = m;
      m.on('load', () => {
        const before = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
        const src = (id: string) => m.addSource(id, { type: 'geojson', data: empty() });
        ['wp-cov', 'wp-edges', 'wp-buffers', 'wp-routes', 'wp-done', 'wp-curbs', 'wp-acc'].forEach(src);
        m.addLayer({ id: 'wp-cov', type: 'fill', source: 'wp-cov', paint: { 'fill-color': COL.navy, 'fill-opacity': 0.14 } }, before);
        m.addLayer({ id: 'wp-edges-case', type: 'line', source: 'wp-edges', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 9] } }, before);
        m.addLayer({ id: 'wp-edges', type: 'line', source: 'wp-edges', filter: ['==', ['get', 'known'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 5.5] } }, before);
        m.addLayer({ id: 'wp-edges-unk', type: 'line', source: 'wp-edges', filter: ['==', ['get', 'known'], false], paint: { 'line-color': COL.unknown, 'line-dasharray': [1.4, 1.2], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.4, 18, 4] } }, before);
        m.addLayer({ id: 'wp-edges-hit', type: 'line', source: 'wp-edges', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
        m.addLayer({ id: 'wp-buffers', type: 'fill', source: 'wp-buffers', paint: { 'fill-color': COL.bad, 'fill-opacity': 0.1, 'fill-outline-color': COL.bad } });
        m.addLayer({ id: 'wp-routes-case', type: 'line', source: 'wp-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'sel'], 12, 9] } });
        m.addLayer({ id: 'wp-routes', type: 'line', source: 'wp-routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'sel'], 2, 1] }, paint: { 'line-color': ['case', ['get', 'sel'], COL.teal, '#86BCC1'], 'line-width': ['case', ['get', 'sel'], 7, 5] } });
        m.addLayer({ id: 'wp-done', type: 'line', source: 'wp-done', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#9AA5AE', 'line-width': 7 } });
        m.addLayer({ id: 'wp-curbs', type: 'circle', source: 'wp-curbs', minzoom: 15.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 3, 18, 6], 'circle-color': ['match', ['get', 'curb'], 'ok', COL.good, 'steep', COL.poor, 'missing', COL.bad, COL.unknown], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
        m.addLayer({ id: 'wp-acc', type: 'fill', source: 'wp-acc', paint: { 'fill-color': '#3B82F6', 'fill-opacity': 0.12, 'fill-outline-color': '#3B82F6' } });
        ready.current = true;
        syncAll();
      });
      m.on('click', (ev) => {
        const P = props.current;
        if (P.onMapClick) { P.onMapClick([ev.lngLat.lng, ev.lngLat.lat]); return; }
        const fs = m.queryRenderedFeatures([[ev.point.x - 6, ev.point.y - 6], [ev.point.x + 6, ev.point.y + 6]], { layers: ['wp-curbs', 'wp-edges-hit'].filter((l) => m.getLayer(l)) });
        const f = fs[0];
        if (!f) return P.onSelect(null);
        P.onSelect(f.layer.id === 'wp-curbs' ? { type: 'node', id: String(f.properties.id) } : { type: 'edge', id: String(f.properties.id) });
      });
      m.on('mouseenter', 'wp-edges-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'wp-edges-hit', () => { m.getCanvas().style.cursor = ''; });
    })();
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; ready.current = false; markers.current = {}; youM.current = destM.current = null; };
  }, []);

  /* ---------- data sync ---------- */
  function setData(id: string, d: GeoJSON.FeatureCollection) { (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(d); }
  function vis(id: string, on: boolean) { const m = mapRef.current; if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }

  function syncNetwork() {
    const { engine, layers } = props.current;
    setData('wp-edges', { type: 'FeatureCollection', features: engine.edges.filter((e) => e.kind !== 'path' || e.surveyed).map((e) => {
      const ev = engine.evalEdge(e);
      return { type: 'Feature', properties: { id: e.id, known: ev.known, color: accessColor(ev) }, geometry: { type: 'LineString', coordinates: engine.edgeCoords(e) } };
    }) });
    setData('wp-curbs', { type: 'FeatureCollection', features: Object.values(engine.nodes).filter((n) => n.curb).map((n) => ({ type: 'Feature', properties: { id: n.id, curb: n.curb }, geometry: { type: 'Point', coordinates: n.ll } })) });
    const world: GeoJSON.Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    setData('wp-cov', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, engine.net.coverage.slice().reverse()] } }] });
    vis('wp-edges', layers.access); vis('wp-edges-unk', layers.access); vis('wp-edges-case', layers.access); vis('wp-curbs', layers.curbs); vis('wp-cov', layers.coverage); vis('wp-buffers', layers.buffers);
  }
  function syncHazards() {
    const P = props.current, m = mapRef.current; if (!m) return;
    setData('wp-buffers', { type: 'FeatureCollection', features: P.hazards.map((h) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(h.ll!, RULES.hazardBuffer, 32)] } })) });
    const want: Record<string, true> = {};
    if (P.layers.hazards) for (const h of P.hazards) want['h:' + h.id] = true;
    if (P.layers.places) for (const pl of P.places) want['p:' + pl.id] = true;
    for (const k of Object.keys(markers.current)) if (!want[k]) { markers.current[k].remove(); delete markers.current[k]; }
    const mk = (k: string, ll: LngLat, build: () => HTMLElement) => {
      let mm = markers.current[k];
      if (!mm) { mm = new maplibregl.Marker({ element: build(), anchor: 'center' }).setLngLat(ll).addTo(m); markers.current[k] = mm; }
      else mm.setLngLat(ll);
      return mm.getElement();
    };
    for (const h of P.hazards) if (want['h:' + h.id]) {
      const el = mk('h:' + h.id, h.ll!, () => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mk-hz'; b.textContent = '!';
        b.addEventListener('click', (e) => { e.stopPropagation(); props.current.onSelect({ type: 'hazard', id: h.id }); });
        return b;
      });
      el.className = `mk-hz sev${h.sev}${P.selected?.type === 'hazard' && P.selected.id === h.id ? ' on' : ''}`;
      el.setAttribute('aria-label', 'Hazard report');
    }
    for (const pl of P.places) if (want['p:' + pl.id]) {
      const el = mk('p:' + pl.id, pl.ll, () => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mk-pl';
        b.addEventListener('click', (e) => { e.stopPropagation(); props.current.onSelect({ type: 'place', id: pl.id }); });
        return b;
      });
      el.className = `mk-pl${P.selected?.type === 'place' && P.selected.id === pl.id ? ' on' : ''}`;
      el.style.setProperty('--c', CATS[pl.cat].color);
      el.setAttribute('aria-label', pl.name);
      el.title = pl.name;
    }
  }
  function syncRoutes() {
    const P = props.current, R = P.routes[P.sel];
    setData('wp-routes', { type: 'FeatureCollection', features: P.routes.map((r, i) => ({ type: 'Feature', properties: { i, sel: i === P.sel }, geometry: { type: 'LineString', coordinates: r.coords } })) });
    const done = R && P.doneS != null && P.doneS > 0.5 ? P.engine.slice(R, 0, P.doneS) : [];
    setData('wp-done', { type: 'FeatureCollection', features: done.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } }] : [] });
  }
  function syncYou() {
    const P = props.current, m = mapRef.current; if (!m) return;
    if (!youM.current) {
      const el = document.createElement('div'); el.className = 'mk-you'; el.setAttribute('aria-label', 'You');
      youM.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(P.you).addTo(m);
      youM.current.on('dragend', () => { const l = youM.current!.getLngLat(); props.current.onYouDrag([l.lng, l.lat]); });
    }
    youM.current.setLngLat(P.you).setDraggable(P.youDraggable);
    youM.current.getElement().classList.toggle('drag', P.youDraggable);
    setData('wp-acc', { type: 'FeatureCollection', features: P.youAccuracy ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(P.you, Math.min(P.youAccuracy, 300), 40)] } }] : [] });
    if (P.dest) {
      if (!destM.current) { const el = document.createElement('div'); el.className = 'mk-dest'; destM.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(P.dest.ll).addTo(m); }
      destM.current.setLngLat(P.dest.ll);
    } else if (destM.current) { destM.current.remove(); destM.current = null; }
  }
  function syncAll() { if (!ready.current) return; syncNetwork(); syncHazards(); syncRoutes(); syncYou(); }

  useEffect(() => { if (ready.current) { syncNetwork(); syncHazards(); } }, [p.engine, p.hazardRev, p.layers, p.hazards, p.places, p.selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready.current) syncRoutes(); }, [p.routes, p.sel, p.doneS]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready.current) syncYou(); }, [p.you, p.youDraggable, p.youAccuracy, p.dest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mapRef.current?.setPadding({ top: p.padding.top, bottom: p.padding.bottom, left: p.padding.left ?? 0, right: 0 }); }, [p.padding.top, p.padding.bottom, p.padding.left]);
  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = p.onMapClick ? 'crosshair' : ''; }, [p.onMapClick]);

  return <div className="map" role="region" aria-label="Map"><div ref={box} className="map-inner" /></div>;
}
