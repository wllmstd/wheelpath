'use client';
import { useCallback, useEffect, useState } from 'react';

export interface Session { email: string; name: string; role: 'admin' | 'user' }

/** the signed-in person (admin@wheelpath.com is the admin) */
export function useSession(initial?: Session | null) {
  const [session, setSession] = useState<Session | null>(initial ?? null);
  const [ready, setReady] = useState(initial !== undefined);
  useEffect(() => {
    if (initial !== undefined) return;
    fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).then((j) => setSession(j.session)).catch(() => null).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const signIn = useCallback(async (email: string, password: string, name?: string) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Sign-in did not work. Try again.');
    setSession(j.session); return j.session as Session;
  }, []);
  const signOut = useCallback(async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null); setSession(null); }, []);
  return { session, ready, signIn, signOut };
}
