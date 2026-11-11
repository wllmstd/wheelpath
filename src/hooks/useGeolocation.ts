'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LngLat } from '@/lib/engine/types';

export type GeoStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'unsupported';
/** a raw device fix: never snapped or altered */
export interface GeoFix { ll: LngLat; accuracy: number; heading: number | null; speed: number | null; timestamp: number }

/** Browser location (W3C Geolocation API). Watches only while `enabled` is true and stops on unmount.
    Nothing is sent anywhere: the position stays in this browser. */
export function useGeolocation(enabled: boolean) {
  const [status, setStatus] = useState<GeoStatus>('off');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) { setStatus('off'); setFix(null); setError(null); return; }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setStatus('unsupported'); setError('This browser has no location support.'); return; }
    if (!window.isSecureContext) { setStatus('unavailable'); setError('Location only works on a secure (https) page.'); return; }
    setStatus('requesting'); setError(null);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus('active'); setError(null);
        setFix({ ll: [p.coords.longitude, p.coords.latitude], accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, timestamp: p.timestamp });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) { setStatus('denied'); setError('Location permission was denied.'); setFix(null); }
        else { setStatus((s) => (s === 'active' ? 'active' : 'unavailable')); setError(e.code === e.TIMEOUT ? 'Location timed out.' : 'Location is unavailable.'); }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; };
  }, [enabled, attempt]);

  /* re-evaluate staleness every 5 s even if no new fix arrives */
  useEffect(() => { if (!enabled) return; const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id); }, [enabled]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  /** a fix older than 30 s is treated as stale */
  const stale = !!fix && now - fix.timestamp > 30000;
  return { status, fix: enabled ? fix : null, error, stale, retry };
}
