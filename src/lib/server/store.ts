/* SERVER ONLY. Where community reports and their photos are kept.
   - Supabase (Postgres + Storage) when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Use this on Vercel.
   - Otherwise a local folder (.wheelpath-data/), handy for `npm run dev`. Vercel's disk is read-only and
     temporary, so the local store is refused there with a clear message. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReportStatus, StoredReport } from '@/lib/reports';

export type NewReport = Pick<StoredReport, 'type' | 'sev' | 'title' | 'note' | 'lng' | 'lat' | 'reporter_name' | 'reporter_email'>;
export type ReportPatch = Partial<Pick<StoredReport, 'status' | 'type' | 'sev' | 'title' | 'note' | 'lng' | 'lat' | 'admin_note' | 'reviewed_at' | 'reviewed_by'>>;
export interface Photo { data: Buffer; contentType: string; ext: string }

export interface Store {
  kind: 'supabase' | 'local';
  list(opts?: { status?: ReportStatus; ids?: string[] }): Promise<StoredReport[]>;
  get(id: string): Promise<StoredReport | null>;
  create(r: NewReport, photo?: Photo | null): Promise<StoredReport>;
  update(id: string, patch: ReportPatch): Promise<StoredReport | null>;
  remove(id: string): Promise<boolean>;
}

export class StoreError extends Error { constructor(msg: string, public status = 500) { super(msg); } }

/* ---------------- Supabase (REST + Storage, no extra package) ---------------- */
const BUCKET = process.env.SUPABASE_BUCKET || 'report-photos';
function supabase(): Store {
  const url = process.env.SUPABASE_URL!.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth: Record<string, string> = { apikey: key };
  if (key.startsWith('eyJ')) auth.Authorization = `Bearer ${key}`; // legacy JWT service_role key
  const rest = async (q: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/reports${q}`, { ...init, cache: 'no-store', headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
    if (!r.ok) {
      console.error(`[wheelpath] database request failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
      throw new StoreError('The report service is not available right now. Please try again in a moment.', 502);
    }
    return r.status === 204 ? [] : ((await r.json()) as StoredReport[]);
  };
  const enc = encodeURIComponent;
  return {
    kind: 'supabase',
    async list(o = {}) {
      let q = '?select=*&order=created_at.desc&limit=1000';
      if (o.status) q += `&status=eq.${o.status}`;
      if (o.ids) { if (!o.ids.length) return []; q += `&id=in.(${o.ids.map(enc).join(',')})`; }
      return rest(q);
    },
    async get(id) { return (await rest(`?select=*&id=eq.${enc(id)}`))[0] || null; },
    async create(r, photo) {
      const id = randomUUID();
      let photo_url: string | null = null, photo_path: string | null = null;
      if (photo) {
        photo_path = `${id}.${photo.ext}`;
        const up = await fetch(`${url}/storage/v1/object/${BUCKET}/${photo_path}`, { method: 'POST', headers: { ...auth, 'Content-Type': photo.contentType, 'x-upsert': 'true' }, body: new Uint8Array(photo.data) });
        if (!up.ok) {
          // the details go to the server log (Vercel -> Logs); people see a plain message
          console.error(`[wheelpath] photo upload to bucket "${BUCKET}" failed (${up.status}): ${(await up.text()).slice(0, 300)}`);
          throw new StoreError('Your photo could not be uploaded. Try again, or remove the photo and send the report without it.', 502);
        }
        photo_url = `${url}/storage/v1/object/public/${BUCKET}/${photo_path}`;
      }
      try {
        return (await rest('', { method: 'POST', body: JSON.stringify({ id, ...r, status: 'pending', photo_url, photo_path }) }))[0];
      } catch (e) {
        // the report was not saved, so do not leave its photo behind in storage
        if (photo_path) await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [photo_path] }) }).catch(() => null);
        throw e;
      }
    },
    async update(id, patch) {
      return (await rest(`?id=eq.${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }))[0] || null;
    },
    async remove(id) {
      const rows = await rest(`?id=eq.${enc(id)}`, { method: 'DELETE' });
      const p = rows[0]?.photo_path;
      if (p) await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [p] }) }).catch(() => null);
      return rows.length > 0;
    },
  };
}

/* ---------------- local folder (development) ---------------- */
export const LOCAL_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.WHEELPATH_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), '.wheelpath-data'));
const FILE = path.join(LOCAL_DIR, 'reports.json');
export const PHOTO_DIR = path.join(LOCAL_DIR, 'photos');
let queue: Promise<unknown> = Promise.resolve();
function local(): Store {
  const read = async (): Promise<StoredReport[]> => { try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return []; } };
  const write = async (rows: StoredReport[]) => { await fs.mkdir(LOCAL_DIR, { recursive: true }); await fs.writeFile(FILE + '.tmp', JSON.stringify(rows, null, 1)); await fs.rename(FILE + '.tmp', FILE); };
  /** one change at a time so two requests never overwrite each other */
  const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => null); return p; };
  return {
    kind: 'local',
    async list(o = {}) {
      let rows = await read();
      if (o.status) rows = rows.filter((r) => r.status === o.status);
      if (o.ids) rows = rows.filter((r) => o.ids!.includes(r.id));
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async get(id) { return (await read()).find((r) => r.id === id) || null; },
    create: (r, photo) => locked(async () => {
      const id = randomUUID();
      let photo_url: string | null = null, photo_path: string | null = null;
      if (photo) {
        photo_path = `${id}.${photo.ext}`;
        await fs.mkdir(PHOTO_DIR, { recursive: true });
        await fs.writeFile(path.join(PHOTO_DIR, photo_path), photo.data);
        photo_url = `/api/photos/${photo_path}`;
      }
      const row: StoredReport = { id, created_at: new Date().toISOString(), updated_at: null, status: 'pending', ...r, photo_url, photo_path, admin_note: null, reviewed_at: null, reviewed_by: null };
      await write([row, ...(await read())]);
      return row;
    }),
    update: (id, patch) => locked(async () => {
      const rows = await read(), i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
      await write(rows);
      return rows[i];
    }),
    remove: (id) => locked(async () => {
      const rows = await read(), row = rows.find((r) => r.id === id);
      if (!row) return false;
      await write(rows.filter((r) => r.id !== id));
      if (row.photo_path) await fs.unlink(path.join(PHOTO_DIR, row.photo_path)).catch(() => null);
      return true;
    }),
  };
}

export function getStore(): Store {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return supabase();
  if (process.env.VERCEL) throw new StoreError('Report storage is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project settings.', 503);
  return local();
}

export function errorResponse(e: unknown) {
  const status = e instanceof StoreError ? e.status : 500;
  return Response.json({ error: (e as Error).message || 'Something went wrong' }, { status });
}
