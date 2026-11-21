'use client';
/* A small map that shows where a report is. In edit mode the pin can be dragged to a new spot. */
import maplibregl, { type Map as MLMap, type Marker, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { FALLBACK_RASTER_STYLE, MAP_STYLE_URL } from '@/lib/config';
import type { LngLat, Severity } from '@/lib/engine/types';

const SEV_COL: Record<Severity, string> = { 1: '#F5D547', 2: '#F2A900', 3: '#FC3434' };

export default function MiniMap({ ll, sev, draggable = false, onMove, label }: { ll: LngLat; sev: Severity; draggable?: boolean; onMove?: (ll: LngLat) => void; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const moveRef = useRef(onMove); moveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: MAP_STYLE_URL, center: ll, zoom: 17, attributionControl: { compact: true }, cooperativeGestures: true });
    let fellBack = false;
    m.on('error', () => { if (!fellBack && !m.isStyleLoaded()) { fellBack = true; m.setStyle(FALLBACK_RASTER_STYLE as StyleSpecification); } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const dot = document.createElement('div');
    dot.className = 'mk-report';
    pin.current = new maplibregl.Marker({ element: dot, draggable: false }).setLngLat(ll).addTo(m);
    pin.current.on('dragend', () => { const p = pin.current!.getLngLat(); moveRef.current?.([p.lng, p.lat]); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    pin.current?.setLngLat(ll);
    const c = map.current?.getCenter();
    if (c && Math.abs(c.lng - ll[0]) + Math.abs(c.lat - ll[1]) > 1e-6) map.current?.easeTo({ center: ll, duration: 400 });
  }, [ll[0], ll[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pin.current?.setDraggable(draggable); pin.current?.getElement().classList.toggle('drag', draggable); }, [draggable]);
  useEffect(() => { pin.current?.getElement().style.setProperty('--pin', SEV_COL[sev]); }, [sev]);

  return <div className="minimap" ref={el} role="img" aria-label={label} />;
}
