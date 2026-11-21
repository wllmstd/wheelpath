/* Community reports: shared by the user app, the admin dashboard and the API.
   A report starts as "pending". Only "approved" reports are shown on the map and used for routing. */
import { HAZARD_TYPES } from '@/lib/engine/rules';
import type { Hazard, HazardType, LngLat, Report, Severity } from '@/lib/engine/types';

export type ReportStatus = 'pending' | 'approved' | 'rejected' | 'fixed';
export const STATUSES: ReportStatus[] = ['pending', 'approved', 'rejected', 'fixed'];

export const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Approved, on the map',
  rejected: 'Not approved',
  fixed: 'Fixed',
};
export const STATUS_SHORT: Record<ReportStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', fixed: 'Fixed' };

/** one row in the reports table (Supabase) or the local file store */
export interface StoredReport {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: ReportStatus;
  type: HazardType;
  sev: Severity;
  title: string;
  note: string | null;
  lng: number;
  lat: number;
  photo_url: string | null;
  photo_path: string | null;
  reporter_name: string | null;
  reporter_email: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** what a member of the public may see about a report (no reporter email) */
export type PublicReport = Omit<StoredReport, 'reporter_email' | 'photo_path' | 'reviewed_by'>;
export function toPublic(r: StoredReport): PublicReport {
  const { reporter_email: _e, photo_path: _p, reviewed_by: _b, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export const isHazardType = (t: unknown): t is HazardType => typeof t === 'string' && t in HAZARD_TYPES;
export const isSeverity = (s: unknown): s is Severity => s === 1 || s === 2 || s === 3;
export const isStatus = (s: unknown): s is ReportStatus => typeof s === 'string' && (STATUSES as string[]).includes(s);

export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
}
export function agoText(iso: string) {
  const d = daysSince(iso);
  if (d === 0) { const h = Math.floor((Date.now() - new Date(iso).getTime()) / 36e5); return h < 1 ? 'just now' : h === 1 ? '1 hour ago' : `${h} hours ago`; }
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** an approved report becomes a map hazard + its report card */
export function toHazard(r: PublicReport): { h: Hazard; r: Report } {
  const hid = 'hc-' + r.id;
  const ll: LngLat = [r.lng, r.lat];
  return {
    h: { id: hid, type: r.type, sev: r.sev, source: 'user', geometry: { type: 'Point', coordinates: ll } },
    r: {
      id: 'rc-' + r.id, hazardId: hid, title: r.title || HAZARD_TYPES[r.type].label, author: r.reporter_name || 'A WheelPath user',
      daysAgo: daysSince(r.created_at), ratings: [], contact: HAZARD_TYPES[r.type].agency, comments: [],
      note: r.note || undefined, simulated: false, photo: r.photo_url || undefined, approved: true,
    },
  };
}
