'use client';
/* WheelPath admin: review reported problems. Approve them onto the map, reject them, mark them fixed,
   edit them or delete them. Works on phones (list, then details) and on wide screens (side by side). */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HAZARD_TYPES, SEV } from '@/lib/engine/rules';
import type { HazardType, LngLat, Severity } from '@/lib/engine/types';
import { STATUS_LABEL, STATUS_SHORT, agoText, type ReportStatus, type StoredReport } from '@/lib/reports';
import { useSession } from '@/hooks/useSession';
import { SignIn } from '../SignIn';
import { Icon, SevTag } from '../ui';

const MiniMap = dynamic(() => import('./MiniMap'), { ssr: false, loading: () => <div className="minimap" /> });

type Filter = ReportStatus | 'all';
const TAG: Record<ReportStatus, string> = { pending: 'pending', approved: 'accessible', rejected: 'not', fixed: 'limited' };
const StatusTag = ({ s }: { s: ReportStatus }) => <span className={'tag t-' + TAG[s]}><i />{STATUS_SHORT[s]}</span>;
const fullDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminApp() {
  const { session, ready, signIn, signOut } = useSession();
  if (!ready) return <div className="boot"><div className="spin" aria-hidden="true" /><p className="boot-msg">Loading…</p></div>;
  if (session?.role !== 'admin') {
    return (
      <div className="admin-gate">
        {session && <div className="form-err gate-msg" role="alert">You are signed in as {session.email}, which is not an admin account. <button className="linkbtn" onClick={signOut}>Sign out</button></div>}
        <SignIn admin title="WheelPath admin" onSignIn={async (e, p) => { const s = await signIn(e, p); if (s.role !== 'admin') throw new Error('This email is not an admin account. Use admin@wheelpath.com.'); }} />
        <a className="linkbtn center gate-back" href="/">Back to the map</a>
      </div>
    );
  }
  return <Dashboard name={session.name} onSignOut={signOut} />;
}

function Dashboard({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [rows, setRows] = useState<StoredReport[] | null>(null);
  const [storage, setStorage] = useState<string>('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => { const mq = window.matchMedia('(min-width: 900px)'); const f = () => setWide(mq.matches); f(); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  const say = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? null : c)), 3500); }, []);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch('/api/admin/reports', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Reports did not load.');
      setRows(j.reports); setStorage(j.storage);
    } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 30_000); return () => window.clearInterval(t); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, pending: 0, approved: 0, rejected: 0, fixed: 0 };
    for (const r of rows || []) { c[r.status]++; c.all++; }
    return c;
  }, [rows]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => (filter === 'all' || r.status === filter) &&
      (!t || [r.title, r.note, r.reporter_name, r.reporter_email, r.admin_note].some((v) => v?.toLowerCase().includes(t))));
  }, [rows, filter, q]);
  const open = rows?.find((r) => r.id === openId) || null;
  useEffect(() => { if (wide && !open && list.length) setOpenId(list[0].id); }, [wide, list, open]);

  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    const r = await fetch('/api/admin/reports/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { say(j.error || 'That did not work. Try again.'); return false; }
    setRows((l) => (l || []).map((x) => (x.id === id ? j.report : x))); say(msg); return true;
  }
  async function remove(id: string) {
    const r = await fetch('/api/admin/reports/' + id, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { say(j.error || 'That did not work. Try again.'); return; }
    setRows((l) => (l || []).filter((x) => x.id !== id)); setOpenId(null); say('Report deleted.');
  }

  const showDetail = !!open && (wide || openId);
  return (
    <div className={'admin' + (wide ? ' wide' : '') + (!wide && showDetail ? ' detail-open' : '')}>
      <header className="admin-nav">
        <a className="brand" href="/" aria-label="WheelPath map"><span className="brand-mark"><Icon name="wheel" size={20} /></span><span className="wm-sm">WHEELPATH</span></a>
        <span className="admin-badge">Admin</span>
        <span className="grow" />
        <a className="btn line sm" href="/"><Icon name="map" size={18} /><span className="hide-sm">Open map</span></a>
        <span className="avatar" title={name} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={onSignOut}><Icon name="logout" size={20} /></button>
      </header>

      <main className="admin-main">
        <section className="admin-list" aria-label="Reports">
          <div className="admin-head">
            <h1>Reported problems</h1>
            <p className="lead">Approve a report to show it on the map. Only approved reports affect routes.</p>
          </div>
          <div className="stat-row" role="tablist" aria-label="Filter by status">
            {(['pending', 'approved', 'rejected', 'fixed', 'all'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={'stat s-' + f + (filter === f ? ' on' : '')} onClick={() => { setFilter(f); setOpenId(null); }}>
                <b>{counts[f]}</b><span>{f === 'all' ? 'All' : STATUS_SHORT[f]}</span></button>))}
          </div>
          <div className="admin-tools">
            <label className="admin-search"><Icon name="search" size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports" aria-label="Search reports" /></label>
            <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => { load(); say('Updated.'); }}><Icon name="refresh" size={20} /></button>
          </div>
          {storage === 'local' && <p className="small store-note">Development storage: reports are saved in the .wheelpath-data folder on this computer. Connect Supabase to share them online.</p>}
          {loadErr && <div className="form-err" role="alert">{loadErr} <button className="linkbtn" onClick={load}>Try again</button></div>}
          {!rows && !loadErr && <div className="spin center-spin" aria-label="Loading reports" />}
          {rows && <ul className="list admin-items">
            {list.map((r) => (
              <li key={r.id}><button className={openId === r.id ? 'on' : ''} aria-current={openId === r.id ? 'true' : undefined} onClick={() => setOpenId(r.id)}>
                {r.photo_url ? <img className="thumb" src={r.photo_url} alt="" /> : <span className={'hz-ic sev' + r.sev}>!</span>}
                <span className="grow"><b>{r.title}</b><small>{r.reporter_name || 'Guest'} · {agoText(r.created_at)}</small>
                  <span className="row gap wrap tags"><StatusTag s={r.status} /><SevTag sev={r.sev} /></span></span>
              </button></li>))}
            {!list.length && <li className="empty-state"><Icon name="inbox" size={34} /><b>{filter === 'pending' && !q ? 'All caught up' : 'No reports here'}</b><span className="small">{filter === 'pending' && !q ? 'There are no reports waiting for review.' : 'Try another filter or search.'}</span></li>}
          </ul>}
        </section>

        {showDetail && open ? <Detail key={open.id} r={open} wide={wide} onBack={() => setOpenId(null)} onPatch={patch} onDelete={remove} />
          : wide && <section className="admin-detail empty"><Icon name="inbox" size={40} /><p className="small">Choose a report to see its details.</p></section>}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Detail({ r, wide, onBack, onPatch, onDelete }: { r: StoredReport; wide: boolean; onBack: () => void; onPatch: (id: string, b: Record<string, unknown>, msg: string) => Promise<boolean>; onDelete: (id: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [draft, setDraft] = useState({ type: r.type, sev: r.sev, note: r.note || '', admin_note: r.admin_note || '', ll: [r.lng, r.lat] as LngLat });
  const [reason, setReason] = useState(r.admin_note || '');
  const ll: LngLat = editing ? draft.ll : [r.lng, r.lat];
  const act = async (b: Record<string, unknown>, msg: string) => { setBusy(true); const ok = await onPatch(r.id, b, msg); setBusy(false); return ok; };
  const moved = draft.ll[0] !== r.lng || draft.ll[1] !== r.lat;

  return (
    <section className="admin-detail" aria-label="Report details">
      <div className="detail-head">
        {!wide && <button className="icon-btn" aria-label="Back to the list" onClick={onBack}><Icon name="back" /></button>}
        <div className="grow"><h2>{r.title}</h2><p className="small">Sent {agoText(r.created_at)} · {fullDate(r.created_at)}</p></div>
        <StatusTag s={r.status} />
      </div>

      <div className="detail-body">
        <div className="media">
          {r.photo_url ? <a className="detail-photo" href={r.photo_url} target="_blank" rel="noopener noreferrer"><img src={r.photo_url} alt={`Photo of the problem: ${r.title}`} /></a>
            : <div className="detail-photo none"><Icon name="image" size={30} /><span className="small">No photo</span></div>}
          <div className="map-wrap">
            <MiniMap ll={ll} sev={editing ? draft.sev : r.sev} draggable={editing} onMove={(p) => setDraft((d) => ({ ...d, ll: p }))} label={`Map showing where ${r.title} was reported`} />
            {editing && <p className="map-hint">Drag the pin to move the report.</p>}
          </div>
        </div>

        {!editing ? <>
          <dl className="kv detail-kv">
            <dt>Status</dt><dd>{STATUS_LABEL[r.status]}</dd>
            <dt>How bad</dt><dd><SevTag sev={r.sev} /></dd>
            <dt>Reported by</dt><dd>{r.reporter_name || 'Guest (not signed in)'}{r.reporter_email && <small>{r.reporter_email}</small>}</dd>
            <dt>Note</dt><dd>{r.note ? `“${r.note}”` : <span className="muted">No note</span>}</dd>
            <dt>Location</dt><dd className="mono">{r.lat.toFixed(5)}° N, {r.lng.toFixed(5)}° E</dd>
            {r.reviewed_at && <><dt>Last review</dt><dd>{fullDate(r.reviewed_at)}{r.reviewed_by && <small>by {r.reviewed_by}</small>}</dd></>}
            {r.admin_note && <><dt>Admin note</dt><dd>{r.admin_note}</dd></>}
          </dl>

          {rejecting ? <div className="reject-box">
            <label className="field"><span>Reason (optional, the reporter can see it)</span><textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="row gap"><button className="btn line grow" onClick={() => setRejecting(false)}>Cancel</button><button className="btn danger grow" disabled={busy} onClick={async () => { if (await act({ status: 'rejected', admin_note: reason }, 'Report rejected.')) setRejecting(false); }}>Reject report</button></div>
          </div> : <div className="detail-actions">
            {r.status === 'pending' && <><button className="btn" disabled={busy} onClick={() => act({ status: 'approved' }, 'Approved. It is now on the map.')}><Icon name="check" size={18} /> Approve</button>
              <button className="btn line danger-text" disabled={busy} onClick={() => setRejecting(true)}><Icon name="close" size={18} /> Reject</button></>}
            {r.status === 'approved' && <><button className="btn" disabled={busy} onClick={() => act({ status: 'fixed' }, 'Marked as fixed. It is off the map.')}><Icon name="wrench" size={18} /> Mark as fixed</button>
              <button className="btn line" disabled={busy} onClick={() => act({ status: 'pending' }, 'Moved back to pending. It is off the map.')}>Hide from map</button></>}
            {r.status === 'rejected' && <><button className="btn" disabled={busy} onClick={() => act({ status: 'approved' }, 'Approved. It is now on the map.')}><Icon name="check" size={18} /> Approve</button>
              <button className="btn line" disabled={busy} onClick={() => act({ status: 'pending' }, 'Moved back to pending.')}>Back to pending</button></>}
            {r.status === 'fixed' && <button className="btn line" disabled={busy} onClick={() => act({ status: 'approved' }, 'Reopened. It is back on the map.')}>Reopen, still a problem</button>}
            <span className="grow" />
            <button className="btn line sm" onClick={() => { setDraft({ type: r.type, sev: r.sev, note: r.note || '', admin_note: r.admin_note || '', ll: [r.lng, r.lat] }); setEditing(true); }}><Icon name="edit" size={16} /> Edit</button>
            <button className="btn line sm danger-text" onClick={() => setConfirmDel(true)}><Icon name="trash" size={16} /> Delete</button>
          </div>}
        </> : <form className="form edit-form" onSubmit={async (e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { type: draft.type, sev: draft.sev, note: draft.note, admin_note: draft.admin_note };
          if (moved) { body.lng = draft.ll[0]; body.lat = draft.ll[1]; }
          if (await act(body, 'Changes saved.')) setEditing(false);
        }}>
          <label className="field"><span>Problem</span>
            <select className="input" value={draft.type} onChange={(e) => { const t = e.target.value as HazardType; setDraft((d) => ({ ...d, type: t })); }}>
              {(Object.keys(HAZARD_TYPES) as HazardType[]).map((k) => <option key={k} value={k}>{HAZARD_TYPES[k].label}</option>)}
            </select></label>
          <fieldset><legend>How bad is it?</legend><div className="sev-row">{([1, 2, 3] as Severity[]).map((v) => <button type="button" key={v} className={'choice' + (draft.sev === v ? ' on' : '')} aria-pressed={draft.sev === v} onClick={() => setDraft((d) => ({ ...d, sev: v }))}><span className={'dot sev' + v} />{SEV[v].label}</button>)}</div></fieldset>
          <label className="field"><span>Reporter’s note</span><textarea className="input" rows={2} maxLength={500} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} /></label>
          <label className="field"><span>Admin note</span><textarea className="input" rows={2} maxLength={500} value={draft.admin_note} onChange={(e) => setDraft((d) => ({ ...d, admin_note: e.target.value }))} placeholder="For example: checked on site on 20 Nov" /></label>
          {moved && <p className="small">New location: {draft.ll[1].toFixed(5)}° N, {draft.ll[0].toFixed(5)}° E</p>}
          <div className="row gap"><button type="button" className="btn line grow" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="btn grow" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </form>}
      </div>

      {confirmDel && <div className="modal-backdrop" onClick={() => setConfirmDel(false)}>
        <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
          <span className="v-ic c-not big-ic"><Icon name="trash" size={28} /></span>
          <h2 id="del-title">Delete this report?</h2>
          <p>“{r.title}” and its photo will be removed for good. To keep a record, mark it as fixed or reject it instead.</p>
          <div className="row gap full"><button className="btn line grow" autoFocus onClick={() => setConfirmDel(false)}>Cancel</button><button className="btn danger grow" disabled={busy} onClick={async () => { setBusy(true); await onDelete(r.id); setBusy(false); }}>Delete</button></div>
        </div>
      </div>}
    </section>
  );
}

