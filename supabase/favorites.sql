create table if not exists public.shopping_favorites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_text text not null check (char_length(trim(item_text)) between 1 and 200),
  category text not null default 'Sonstiges',
  repeat_weekday smallint check (repeat_weekday between 0 and 6),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, item_text)
);

alter table public.shopping_favorites enable row level security;

drop policy if exists "family members can read favorites" on public.shopping_favorites;
create policy "family members can read favorites"
on public.shopping_favorites for select
using (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

drop policy if exists "family members can insert favorites" on public.shopping_favorites;
create policy "family members can insert favorites"
on public.shopping_favorites for insert
with check (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

drop policy if exists "family members can update favorites" on public.shopping_favorites;
create policy "family members can update favorites"
on public.shopping_favorites for update
using (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
))
with check (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

drop policy if exists "family members can delete favorites" on public.shopping_favorites;
create policy "family members can delete favorites"
on public.shopping_favorites for delete
using (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

alter publication supabase_realtime add table public.shopping_favorites;
