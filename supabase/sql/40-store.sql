-- Garage & Store. Run after 00-core.sql (needs public.is_admin()). Safe to run again.
-- The game works fully offline with its built-in catalogue; these tables only let admins change
-- prices / switch items off / schedule rotations without a release, and keep an honest purchase log.
-- Rush Coins and Diamonds are in-game only and never cashable.

-- Admin overrides for catalogue items (id = the game's item id, e.g. 'bike:x1', 'paint:gold').
create table if not exists public.store_items (
  id text primary key,
  price_coins integer check (price_coins is null or price_coins >= 0),
  price_diamonds integer check (price_diamonds is null or price_diamonds >= 0),
  disabled boolean not null default false,
  rarity text check (rarity is null or rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  name text,
  updated_at timestamptz not null default now()
);
alter table public.store_items enable row level security;
drop policy if exists "store items read" on public.store_items;
create policy "store items read" on public.store_items for select using (true);
drop policy if exists "store items admin write" on public.store_items;
create policy "store items admin write" on public.store_items for all using (public.is_admin()) with check (public.is_admin());

-- Scheduled slots that replace the date-seeded rotation while they are live.
create table if not exists public.store_rotation (
  id bigserial primary key,
  slot text not null check (slot in ('featured','drop','daily','ending')),
  item_id text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists store_rotation_live on public.store_rotation (slot, ends_at);
alter table public.store_rotation enable row level security;
drop policy if exists "store rotation read" on public.store_rotation;
create policy "store rotation read" on public.store_rotation for select using (true);
drop policy if exists "store rotation admin write" on public.store_rotation;
create policy "store rotation admin write" on public.store_rotation for all using (public.is_admin()) with check (public.is_admin());

-- What riders bought (in-game currency only). Riders see their own; admins see all.
create table if not exists public.store_purchases (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  coins integer not null default 0 check (coins >= 0),
  diamonds integer not null default 0 check (diamonds >= 0),
  at timestamptz not null default now()
);
create index if not exists store_purchases_user on public.store_purchases (user_id, at desc);
alter table public.store_purchases enable row level security;
drop policy if exists "store purchases insert own" on public.store_purchases;
create policy "store purchases insert own" on public.store_purchases for insert with check (auth.uid() = user_id);
drop policy if exists "store purchases read" on public.store_purchases;
create policy "store purchases read" on public.store_purchases for select using (auth.uid() = user_id or public.is_admin());

-- Wishlists (private per rider; only the aggregated counts below are public).
create table if not exists public.store_wishlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.store_wishlist enable row level security;
drop policy if exists "store wishlist own" on public.store_wishlist;
create policy "store wishlist own" on public.store_wishlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Most wished-for items: real counts only, never names. The client shows it only when 3+ riders wished.
create or replace function public.store_trending(p_limit integer default 6)
returns table (item_id text, riders bigint)
language sql stable security definer set search_path = public as $$
  select w.item_id, count(*)::bigint as riders
  from public.store_wishlist w
  group by w.item_id
  having count(*) >= 3
  order by riders desc, w.item_id
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;
grant execute on function public.store_trending(integer) to authenticated, anon;
