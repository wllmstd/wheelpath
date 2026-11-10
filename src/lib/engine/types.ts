/* Core GIS types. Coordinates are GeoJSON order: [longitude, latitude]. */
export type LngLat = [number, number];
export type Surface = 'smooth' | 'fair' | 'rough' | 'broken';
export type Curb = 'ok' | 'steep' | 'missing' | 'unknown' | null;
export type EdgeKind = 'sidewalk' | 'stairs' | 'path';
export type Severity = 1 | 2 | 3;
export type HazardType = 'pavement' | 'ramp' | 'obstruction' | 'drain' | 'narrow' | 'flood' | 'other';
export type PlaceCat = 'health' | 'gov' | 'market' | 'school' | 'worship' | 'transport' | 'food' | 'bank';
export type AccessClass = 'accessible' | 'partial' | 'not' | 'limited';

export interface Anchor { lng: number; lat: number }

export interface GNode {
  id: string;
  /** local metres east / north of the anchor */
  x: number;
  y: number;
  ll: LngLat;
  curb: Curb;
  deg: number;
}

export interface GEdge {
  id: string;
  a: string;
  b: string;
  name: string;
  kind: EdgeKind;
  hw: string;
  way: number;
  legKey: string;
  len: number;
  chunk: number;
  mx: number;
  my: number;
  /** true when the edge has (simulated or surveyed) accessibility values */
  surveyed: boolean;
  /** inside the data area but deliberately left without values */
  gap?: boolean;
  width?: number;
  slope?: number;
  surface?: Surface;
}

export interface Hazard {
  id: string;
  edgeId: string;
  /** position along the edge, 0 = node a, 1 = node b */
  t: number;
  type: HazardType;
  sev: Severity;
  seed?: boolean;
  ll?: LngLat;
}

export interface Comment { who: string; text: string; ago: string }

export interface Report {
  id: string;
  hazardId: string;
  title: string;
  author: string;
  daysAgo: number;
  ratings: number[];
  contact: string;
  comments: Comment[];
  note?: string;
  simulated: boolean;
}

export interface Place {
  id: string;
  name: string;
  cat: PlaceCat;
  ll: LngLat;
  hours: string;
  note: string;
}

export interface NetworkMeta {
  ways: number;
  edges: number;
  nodes: number;
  pois: number;
  source: string;
  osmTimestamp: string | null;
  builtAt: string;
}

/** Everything the client needs; produced on the server from OpenStreetMap data. */
export interface Network {
  anchor: Anchor;
  areaName: string;
  covRadius: number;
  coverage: LngLat[];
  nodes: Record<string, GNode>;
  edges: GEdge[];
  places: Place[];
  hazards: Hazard[];
  reports: Report[];
  defaultYou: LngLat;
  meta: NetworkMeta;
}

export interface Prefs { stairs: boolean; steep: boolean; ramps: boolean; shortest: boolean }

export interface Snap { edgeId: string; t: number; dist: number; ll: LngLat; inCoverage: boolean; surveyed: boolean }

export interface Issue { code: string; kind: 'edge' | 'hazard'; label: string; hazard?: Hazard }

export interface EdgeEval {
  known: boolean;
  hz: Hazard[];
  pts: number;
  hazard: number;
  crit: Issue[];
  warn: Issue[];
  width: number | null;
  slope: number | null;
  surface: number | null;
  avg: number | null;
}

export interface Seg { e: GEdge; t0: number; t1: number; len: number; p0: LngLat; p1: LngLat; s0: number; s1: number; endNode?: string }

export type BarrierKind = 'critical' | 'caution' | 'unverified';
export interface Barrier {
  kind: BarrierKind;
  code: string;
  label: string;
  where: string;
  s: number;
  s2?: number;
  ll: LngLat;
  edgeId: string;
  hazardId?: string;
  nodeId?: string;
  sev?: Severity;
}

export interface Ratings { hazards: number; width: number; surface: number; ramp: number; avg: number }

export type Turn = 'start' | 'straight' | 'left' | 'right';
export interface Leg {
  name: string;
  key: string;
  bearing: number;
  outBearing: number;
  startS: number;
  endS: number;
  dist: number;
  ll: LngLat;
  turn: Turn;
  verb: string;
}

export interface Route {
  id: string;
  rank: number;
  label: string;
  tag: 'prefs' | 'hazards' | 'shortest' | 'detour';
  cost: number;
  segs: Seg[];
  coords: LngLat[];
  cum: number[];
  length: number;
  ratings: Ratings | null;
  barriers: Barrier[];
  criticalCount: number;
  cls: AccessClass;
  knownLen: number;
  unknownLen: number;
  unknownShare: number;
  hazardsOn: { h: Hazard; s: number }[];
  hazardsNear: { h: Hazard; d: number }[];
  time: number;
  cumT: number[];
  climb: number;
  descent: number;
  minWidth: number | null;
  maxGrade: number;
  legs: Leg[];
}

export interface Plan { routes: Route[]; from: Snap; to: Snap; explored: number; ms: number; prefs: Prefs }

export type NavIcon = 'straight' | 'left' | 'right' | 'sharpleft' | 'sharpright' | 'arrive';
export interface NavState {
  legIndex: number;
  text: string;
  icon: NavIcon;
  now: boolean;
  street: string;
  rem: number;
  remTotal: number;
  timeLeft: number;
}
