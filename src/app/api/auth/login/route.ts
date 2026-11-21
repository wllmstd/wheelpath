import { NextResponse } from 'next/server';
import { COOKIE, cookieOptions, encode, isHttps, makeSession, validEmail } from '@/lib/server/session';

/** POST { email, password, name? } -> signs in. Any password is accepted (prototype). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!validEmail(b.email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (typeof b.password !== 'string' || !b.password) return NextResponse.json({ error: 'Enter a password.' }, { status: 400 });
  const s = makeSession(b.email, typeof b.name === 'string' ? b.name : undefined);
  const res = NextResponse.json({ session: s });
  res.cookies.set(COOKIE, encode(s), { ...cookieOptions, secure: isHttps(req) });
  return res;
}
