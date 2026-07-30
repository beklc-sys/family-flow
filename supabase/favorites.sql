drop table if exists public.shopping_favorites cascade;

create table public.shopping_favorites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_text text not null check (char_length(trim(item_text)) between 1 and 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (family_id, item_text)
);

alter table public.shopping_favorites enable row level security;

create policy "family members can read favorites"
on public.shopping_favorites for select
using (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

create policy "family members can insert favorites"
on public.shopping_favorites for insert
with check (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

create policy "family members can delete favorites"
on public.shopping_favorites for delete
using (exists (
  select 1 from public.family_users fu
  where fu.family_id = shopping_favorites.family_id
    and fu.user_id = auth.uid()
));

alter publication supabase_realtime add table public.shopping_favorites;

notify pgrst, 'reload schema';