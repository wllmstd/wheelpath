'use client';
/* The front door: people sign in before they can use the map.
   Only the WheelPath accounts can sign in; admin@wheelpath.com opens the admin dashboard. */
import { useState } from 'react';
import { Icon } from './ui';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work. Try again.');
      window.location.assign(j.session?.role === 'admin' ? '/admin' : '/');
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  }

  return (
    <div className="auth">
      <aside className="auth-hero" aria-hidden="true">
        <div className="brand static light"><span className="brand-mark"><Icon name="wheel" size={22} /></span><span className="wm-sm">WHEELPATH</span></div>
        <div className="hero-copy">
          <h2>Find routes that work for your wheelchair.</h2>
          <ul>
            <li><span><Icon name="map" size={20} /></span>See which paths are easy, difficult or blocked</li>
            <li><span><Icon name="flag" size={20} /></span>Get the most accessible route, not just the shortest</li>
            <li><span><Icon name="camera" size={20} /></span>Report problems with a photo to help others</li>
          </ul>
        </div>
        <p className="hero-foot">Streets around Valenzuela City School of Mathematics and Science</p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="brand static auth-brand-sm"><span className="brand-mark"><Icon name="wheel" size={22} /></span><span className="wm-sm">WHEELPATH</span></div>
          <h1>Welcome back</h1>
          <p className="lead">Sign in to see the map and plan your route.</p>

          <form className="form" onSubmit={submit}>
            <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {err && <p className="form-err" role="alert">{err}</p>}
            <button className="btn big" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="small proto-note">Need an account? Ask the WheelPath team for your sign-in details.</p>
        </div>
      </main>
    </div>
  );
}
