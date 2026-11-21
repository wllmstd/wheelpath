import { NextResponse } from 'next/server';
import { COOKIE, checkPassword, cookieOptions, encode, isHttps, makeSession, validEmail } from '@/lib/server/session';

/** POST { email, password } -> signs in one of the two WheelPath accounts. Every other email is refused. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!validEmail(b.email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (typeof b.password !== 'string' || !b.password) return NextResponse.json({ error: 'Enter your password.' }, { status: 400 });
  const check = checkPassword(b.email, b.password.slice(0, 200));
  if (check === 'unset') return NextResponse.json({ error: 'Sign-in is not set up on the server yet. Please contact the WheelPath team.' }, { status: 503 });
  if (check !== 'ok') {
    await new Promise((r) => setTimeout(r, 600)); // slows down password guessing
    return NextResponse.json({ error: 'The email or password is not correct.' }, { status: 401 });
  }
  const s = makeSession(b.email)!;
  const res = NextResponse.json({ session: s });
  res.cookies.set(COOKIE, encode(s), { ...cookieOptions, secure: isHttps(req) });
  return res;
}
