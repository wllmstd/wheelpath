'use client';
import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '@/lib/engine/types';

export type GeoStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'unsupported';
export interface GeoFix { ll: LngLat; accuracy: number; heading: number | null; speed: number | null; timestamp: number }

/** Browser location (W3C Geolocation API). Watches only while `enabled` is true; nothing is sent anywhere. */
export function useGeolocation(enabled: boolean) {
  const [status, setStatus] = useState<GeoStatus>('off');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setStatus('unsupported'); return; }
    if (!window.isSecureContext) { setStatus('unavailable'); setError('Location needs a secure (https) page.'); return; }
    setStatus('requesting'); setError(null);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus('active');
        setFix({ ll: [p.coords.longitude, p.coords.latitude], accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, timestamp: p.timestamp });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) { setStatus('denied'); setError('Location permission was denied.'); }
        else { setStatus('unavailable'); setError(e.code === e.TIMEOUT ? 'Location timed out.' : 'Location is unavailable.'); }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; };
  }, [enabled]);

  /** a fix older than 30 s is treated as stale */
  const stale = !!fix && Date.now() - fix.timestamp > 30000;
  return { status, fix: enabled ? fix : null, error, stale };
}
