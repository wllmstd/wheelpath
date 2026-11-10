import type { Anchor, LngLat } from './types';

const R_EARTH = 6371008.8;
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(a: LngLat, b: LngLat): number {
  const p1 = rad(a[1]), p2 = rad(b[1]), dl = rad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export const cardinal = (b: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8];
export const angDiff = (b1: number, b2: number) => ((b2 - b1 + 540) % 360) - 180;
export const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function pointInPolygon(pt: LngLat, poly: LngLat[]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** nearest point on segment a-b to p, all in local metres */
export function segProject(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t, y = ay + dy * t;
  return { t, x, y, d: Math.hypot(px - x, py - y) };
}

/** Local equirectangular plane (metres) around an anchor; accurate to a few cm over ~2 km. */
export interface Projection { toLocal(p: LngLat): [number, number]; fromLocal(x: number, y: number): LngLat }
export function makeProjection(a: Anchor): Projection {
  const MLAT = 111320, COS = Math.cos(rad(a.lat));
  return {
    toLocal: (p) => [(p[0] - a.lng) * MLAT * COS, (p[1] - a.lat) * MLAT],
    fromLocal: (x, y) => [a.lng + x / (MLAT * COS), a.lat + y / MLAT],
  };
}

/** circle polygon (for buffers and the data-area outline) */
export function circle(center: LngLat, radiusM: number, steps = 48): LngLat[] {
  const P = makeProjection({ lng: center[0], lat: center[1] }), out: LngLat[] = [];
  for (let k = 0; k <= steps; k++) { const a = (k / steps) * Math.PI * 2; out.push(P.fromLocal(Math.cos(a) * radiusM, Math.sin(a) * radiusM)); }
  return out;
}
