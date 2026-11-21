/* SERVER ONLY. Simple sign-in for the prototype.
   Any email and password are accepted. The email admin@wheelpath.com gets the admin role.
   The session is a signed cookie, so it cannot be edited in the browser, but there is
   NO real password check: replace this with proper accounts (e.g. Supabase Auth) before a public launch. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_EMAIL = 'admin@wheelpath.com';
export const COOKIE = 'wp_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Session { email: string; name: string; role: 'admin' | 'user' }

function secret() {
  return process.env.SESSION_SECRET || 'wheelpath-dev-secret-change-me';
}
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');

export function makeSession(email: string, name?: string): Session {
  const e = email.trim().toLowerCase();
  const fallback = e.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { email: e, name: (name || '').trim().slice(0, 60) || fallback, role: e === ADMIN_EMAIL ? 'admin' : 'user' };
}

export function encode(s: Session) {
  const data = b64(JSON.stringify(s));
  return data + '.' + sign(data);
}
export function decode(token: string | undefined): Session | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const want = Buffer.from(sign(data)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString()) as Session;
    return s && typeof s.email === 'string' ? makeSession(s.email, s.name) : null; // role is always re-derived from the email
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  return decode((await cookies()).get(COOKIE)?.value);
}
export const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE };
/** secure cookies only over https, so testing on a phone over the local network (http) still works */
export const isHttps = (req: Request) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

export const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
