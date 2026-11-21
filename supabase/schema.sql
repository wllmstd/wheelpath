-- WheelPath: community reports and their photos.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'fixed')),
  type           text not null,
  sev            smallint not null check (sev between 1 and 3),
  title          text not null,
  note           text,
  lng            double precision not null,
  lat            double precision not null,
  photo_url      text,
  photo_path     text,
  reporter_name  text,
  reporter_email text,
  admin_note     text,
  reviewed_at    timestamptz,
  reviewed_by    text
);
create index if not exists reports_status_created on public.reports (status, created_at desc);

-- Only the WheelPath server (service role key) reads and writes this table.
-- With RLS on and no policies, the public anon key cannot see reporters' emails.
alter table public.reports enable row level security;

-- Newer Supabase projects do not grant new tables to the API roles automatically.
grant usage on schema public to service_role;
grant all on table public.reports to service_role;

-- Public bucket for report photos (anyone with the link can view a photo; only the server can upload or delete).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Make the Data API see the new table right away.
notify pgrst, 'reload schema';
