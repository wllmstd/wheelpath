/* SERVER ONLY. Sign-in with two fixed accounts; every other email is refused.
     admin@wheelpath.com  -> admin  (password in WHEELPATH_ADMIN_PASSWORD)
     user@wheelpath.com   -> user   (password in WHEELPATH_USER_PASSWORD)
   Passwords live in environment variables (Vercel settings / .env.local), never in the code on GitHub.
   The session is a cookie signed with SESSION_SECRET, so it cannot be edited in the browser. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_EMAIL = 'admin@wheelpath.com';
const ACCOUNTS = [
  { email: ADMIN_EMAIL, name: 'Admin', role: 'admin' as const, passwordVar: 'WHEELPATH_ADMIN_PASSWORD' },
  { email: 'user@wheelpath.com', name: 'WheelPath User', role: 'user' as const, passwordVar: 'WHEELPATH_USER_PASSWORD' },
];
const account = (email: string) => ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());
export const COOKIE = 'wp_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Session { email: string; name: string; role: 'admin' | 'user' }

function secret() {
  return process.env.SESSION_SECRET || 'wheelpath-dev-secret-change-me';
}
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');

/** the session for a known account, or null for any other email */
export function makeSession(email: string): Session | null {
  const a = account(email);
  return a ? { email: a.email, name: a.name, role: a.role } : null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
/** 'ok' | 'wrong' (unknown email or wrong password) | 'unset' (the password variable is missing on the server) */
export function checkPassword(email: string, password: string): 'ok' | 'wrong' | 'unset' {
  const a = account(email);
  const want = a ? process.env[a.passwordVar] : undefined;
  if (a && !want) { console.error(`[wheelpath] ${a.passwordVar} is not set, so ${a.email} cannot sign in.`); return 'unset'; }
  // compare fixed-length digests so the check takes the same time whatever is typed
  const same = timingSafeEqual(digest(password), digest(want ?? '\u0000no-account'));
  return a && same ? 'ok' : 'wrong';
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
    return s && typeof s.email === 'string' ? makeSession(s.email) : null; // only the two accounts; role comes from the server list
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  return decode((await cookies()).get(COOKIE)?.value);
}
export const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE };
/** secure cookies only over https, so testing on a phone over the local network (http) still works */
export const isHttps = (req: Request) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

export const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
