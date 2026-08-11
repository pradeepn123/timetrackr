-- Work Log — Supabase schema (entries table + RLS + screenshots storage bucket)
--
-- One-time setup: paste this whole file into the Supabase SQL Editor and run it.
-- Safe to re-run after edits (uses `if not exists` / `drop policy if exists`).

create extension if not exists pgcrypto;

create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date          date not null,
  date_display  text not null,
  project       text not null,
  task          text not null,
  remark        text not null default '',
  screenshots   jsonb not null default '[]'::jsonb,
  urls          text[] not null default '{}',
  start_ts      bigint not null,
  end_ts        bigint not null,
  start_time    text not null,
  end_time      text not null,
  total_ms      bigint not null,
  is_break      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Backfills the column for a table created before this line existed; a no-op
-- on a fresh install since the column is already declared above.
alter table public.entries add column if not exists is_break boolean not null default false;

create index if not exists entries_user_id_idx   on public.entries (user_id);
create index if not exists entries_user_date_idx on public.entries (user_id, date);

alter table public.entries enable row level security;

drop policy if exists entries_select_own on public.entries;
create policy entries_select_own on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists entries_insert_own on public.entries;
create policy entries_insert_own on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists entries_update_own on public.entries;
create policy entries_update_own on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists entries_delete_own on public.entries;
create policy entries_delete_own on public.entries
  for delete using (auth.uid() = user_id);

-- Screenshots: private bucket, one folder per user (`${userId}/${screenshotId}`).
-- Original filenames are kept only in entries.screenshots jsonb, not in the
-- storage path, so we never have to worry about escaping special characters.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

drop policy if exists screenshots_select_own on storage.objects;
create policy screenshots_select_own on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists screenshots_insert_own on storage.objects;
create policy screenshots_insert_own on storage.objects
  for insert with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists screenshots_delete_own on storage.objects;
create policy screenshots_delete_own on storage.objects
  for delete using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
