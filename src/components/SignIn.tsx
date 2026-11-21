'use client';
import { useState } from 'react';
import { Icon } from './ui';

/** admin sign-in form (only the WheelPath accounts can sign in) */
export function SignIn({ onSignIn, onBack, title = 'Sign in', admin = false }: { onSignIn: (email: string, password: string) => Promise<void>; onBack?: () => void; title?: string; admin?: boolean }) {
  const [email, setEmail] = useState(admin ? 'admin@wheelpath.com' : '');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page signin">
      {onBack && <div className="pagehead row gap"><button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="back" /></button></div>}
      <div className="signin-card">
        <div className="brand static"><span className="brand-mark"><Icon name="wheel" size={22} /></span><span className="wm-sm">WHEELPATH</span></div>
        <h1>{title}</h1>
        <p className="lead">{admin ? 'Review and manage reported problems.' : 'Your name will be shown on the problems you report.'}</p>
        <form className="form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await onSignIn(email, password); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); } }}>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <p className="form-err" role="alert">{err}</p>}
          <button className="btn big" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {onBack && !admin && <button type="button" className="linkbtn center" onClick={onBack}>Continue without signing in</button>}
        </form>
      </div>
    </div>
  );
}
