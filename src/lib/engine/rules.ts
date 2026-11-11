/* Accessibility rules: PROTOTYPE DEFAULTS.
   Thresholds follow figures cited from BP 344 in public accessibility guides.
   CONFIRM against the NCDA 2024 Revised IRR checklist before any real use. */
import type { HazardType, PlaceCat, Severity, Surface } from './types';

export const RULES = {
  minWidth: 1.2,
  critWidth: 0.9,
  runningGrade: 5,
  rampGrade: 8.33,
  critGrade: 10,
  walkSpeed: 1.2, // m/s
  hazardBuffer: 25, // m
  /** a point hazard is attached to the nearest pathway within this distance (m) */
  attachPoint: 20,
  /** a line hazard affects pathway stretches within this distance of the line (m) */
  attachLine: 6,
  stars: {
    width: [['≥ 1.50 m', 5], ['1.20 – 1.49 m', 4], ['1.00 – 1.19 m', 3], ['0.90 – 0.99 m', 2], ['< 0.90 m', 1]],
    grade: [['≤ 2 %', 5], ['2 – 5 % (up to 1:20)', 4], ['5 – 8.33 % (up to 1:12)', 3], ['8.33 – 10 %', 2], ['> 10 %', 1]],
    surface: [['Smooth', 5], ['Fair (minor wear)', 4], ['Rough', 2], ['Broken or uneven', 1]],
  } as Record<string, [string, number][]>,
} as const;

export const HZ_PTS: Record<Severity, number> = { 1: 0.5, 2: 1.0, 3: 3.0 };
export const starsWidth = (w: number) => (w >= 1.5 ? 5 : w >= 1.2 ? 4 : w >= 1.0 ? 3 : w >= 0.9 ? 2 : 1);
export const starsSlope = (p: number) => { p = Math.abs(p); return p <= 2 ? 5 : p <= 5 ? 4 : p <= 8.33 ? 3 : p <= 10 ? 2 : 1; };
export const SURF_STARS: Record<Surface, number> = { smooth: 5, fair: 4, rough: 2, broken: 1 };
export const SURF_LABEL: Record<Surface, string> = { smooth: 'Smooth', fair: 'Fair', rough: 'Rough', broken: 'Broken or uneven' };
export const CURB_STARS: Record<string, number> = { ok: 5, steep: 2, missing: 1 };
export const CURB_LABEL: Record<string, string> = { ok: 'Curb ramp recorded', steep: 'Curb ramp too steep', missing: 'No curb ramp recorded', unknown: 'Curb ramp not surveyed' };
export const hazardStars = (pts: number) => Math.max(1, Math.min(5, 5 - pts));

export const HAZARD_TYPES: Record<HazardType, { label: string; sev: Severity; agency: string; desc: string }> = {
  pavement: { label: 'Broken pavement', sev: 2, agency: 'City Engineering Office (sample)', desc: 'Cracks or holes that can catch small wheels.' },
  ramp: { label: 'Steep or missing ramp', sev: 3, agency: 'City Engineering Office (sample)', desc: 'No ramp, or one that is too steep to climb.' },
  obstruction: { label: 'Blocked walkway', sev: 2, agency: 'Barangay Hall (sample)', desc: 'Stalls, vehicles or goods in the way.' },
  drain: { label: 'Open drain', sev: 3, agency: 'City Engineering Office (sample)', desc: 'Missing cover or gap in the walkway.' },
  narrow: { label: 'Walkway too narrow', sev: 2, agency: 'PDAO (sample)', desc: 'Poles or walls leave less room than a wheelchair needs.' },
  flood: { label: 'Standing water', sev: 1, agency: 'Barangay Hall (sample)', desc: 'Puddles or flooding after rain.' },
  works: { label: 'Construction or excavation', sev: 3, agency: 'City Engineering Office (sample)', desc: 'The walkway is dug up or closed for works.' },
  other: { label: 'Something else', sev: 1, agency: 'Barangay Hall (sample)', desc: 'Another problem on the pathway.' },
};
export const SEV: Record<Severity, { label: string; short: string }> = {
  1: { label: 'Minor', short: 'Minor' },
  2: { label: 'Needs attention', short: 'Caution' },
  3: { label: 'Blocks wheelchair', short: 'Critical' },
};
export const CATS: Record<PlaceCat, { label: string; color: string }> = {
  health: { label: 'Health', color: '#B3261E' }, gov: { label: 'Government', color: '#2C344C' },
  market: { label: 'Market', color: '#1C747C' }, school: { label: 'School', color: '#9444DC' },
  worship: { label: 'Worship', color: '#6B4FA0' }, transport: { label: 'Transport', color: '#1C747C' },
  food: { label: 'Food', color: '#B77B00' }, bank: { label: 'Bank', color: '#2C344C' },
};
export const CLS_LABEL = { accessible: 'Accessible', partial: 'Partially accessible', not: 'Not accessible', limited: 'Limited data' } as const;

export const SOURCE_LABEL = { survey: 'Surveyed', user: 'User report', simulated: 'Simulated' } as const;

export const fmt = {
  dist(m: number) { if (m < 100) return Math.max(5, Math.round(m / 5) * 5) + ' m'; if (m < 1000) return Math.round(m / 10) * 10 + ' m'; return (m / 1000).toFixed(1) + ' km'; },
  mins(s: number) { const m = Math.max(1, Math.round(s / 60)); return m + (m === 1 ? ' min' : ' mins'); },
  n1(v: number | null | undefined) { return v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1); },
};
