-- Shared pieces for the tab systems (events, challenges, community, store).
-- Run after supabase/schema.sql. Safe to run again.

-- LEGONRUSH administrators: add a row with the user's id (Authentication → Users) to make someone an admin.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (auth.uid() = user_id);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- Prices admins can change without a new release (coins). Read by everyone.
create table if not exists public.config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.config enable row level security;
drop policy if exists "config read" on public.config;
create policy "config read" on public.config for select using (true);
drop policy if exists "config admin write" on public.config;
create policy "config admin write" on public.config for all using (public.is_admin()) with check (public.is_admin());
