import type { ReactNode } from 'react';
import { CLS_LABEL, SEV } from '@/lib/engine/rules';
import type { AccessClass, Severity } from '@/lib/engine/types';

const IC: Record<string, ReactNode> = {
  back: <path d="M19 12H5M12 19l-7-7 7-7" />, search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  map: <><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" /><path d="M8 2v16M16 6v16" /></>,
  alert: <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />,
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  layers: <path d="M12 2l10 6-10 6L2 8l10-6zM2 16l10 6 10-6M2 12l10 6 10-6" />,
  locate: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  check: <path d="M20 6L9 17l-5-5" />, close: <path d="M18 6L6 18M6 6l12 12" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  left: <><path d="M18 21V10a3 3 0 0 0-3-3H6" /><path d="M10 3L6 7l4 4" /></>, right: <><path d="M6 21V10a3 3 0 0 1 3-3h9" /><path d="M14 3l4 4-4 4" /></>,
  sharpleft: <><path d="M18 21V11L8 7" /><path d="M12 3L8 7l4 4" /></>, sharpright: <><path d="M6 21V11l10-4" /><path d="M12 3l4 4-4 4" /></>,
  straight: <path d="M12 21V4M6 10l6-6 6 6" />, arrive: <><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  plus: <path d="M12 5v14M5 12h14" />, play: <path d="M7 4l13 8-13 8z" />, pause: <path d="M7 4h4v16H7zM14 4h4v16h-4z" />,
  pin: <><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  flag: <path d="M4 22V4M4 4h13l-2 4 2 4H4" />,
  wheel: <><circle cx="12" cy="4" r="2" /><path d="M12 7v6h5l2.5 6" /><path d="M8.5 10.5a5.5 5.5 0 1 0 7 7.5" /></>,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  refresh: <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  wrench: <path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" />,
  inbox: <path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />,
};
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{IC[name]}</svg>;
}

let starUid = 0;
export function Stars({ value, size = 16, label }: { value: number | null; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(5, value || 0)), id = 'st' + starUid++, w = ((v / 5) * 120).toFixed(2);
  const d = 'M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.3 6.3 20.4l1.1-6.4L2.8 9.5l6.4-.9z';
  const five = (fill: string, stroke: string) => [0, 1, 2, 3, 4].map((i) => <path key={i} transform={`translate(${i * 24} 0)`} d={d} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />);
  return (
    <svg className="stars" width={size * 5} height={size} viewBox="0 0 120 24" role="img" aria-label={label || `${Math.round(v * 10) / 10} out of 5 stars`}>
      <defs><clipPath id={id}><rect x="0" y="0" width={w} height="24" /></clipPath></defs>
      <g>{five('none', '#7D8791')}</g><g clipPath={`url(#${id})`}>{five('#FFB800', '#B77B00')}</g>
    </svg>
  );
}
export const ClsTag = ({ cls }: { cls: AccessClass }) => <span className={`tag t-${cls}`}><i />{CLS_LABEL[cls]}</span>;
export const SevTag = ({ sev }: { sev: Severity }) => <span className={`tag t-s${sev}`}><i />{SEV[sev].label}</span>;
export const Tag = ({ kind, children }: { kind: string; children: ReactNode }) => <span className={`tag t-${kind}`}><i />{children}</span>;
