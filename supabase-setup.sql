-- Family Flow 0.1
-- Supabase-Datenmodell für zwei Erwachsene und eine gemeinsame Einkaufsliste.
-- Diese Datei vollständig im Supabase SQL Editor ausführen.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Unsere Familie'
    check (char_length(name) between 1 and 80),
  invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.family_users (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'parent' check (role = 'parent'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id),
  constraint one_family_per_user unique (user_id)
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_text text not null check (char_length(btrim(item_text)) between 1 and 200),
  shopping_date date,
  is_done boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint completed_state_consistent check (
    (is_done = false and completed_at is null)
    or (is_done = true and completed_at is not null)
  )
);

create index if not exists family_users_user_id_idx
  on public.family_users(user_id);

create index if not exists shopping_items_family_date_idx
  on public.shopping_items(family_id, shopping_date, created_at);

create or replace function private.is_family_member(requested_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_users fu
    where fu.family_id = requested_family_id
      and fu.user_id = (select auth.uid())
  );
$$;

create or replace function private.set_shopping_item_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.item_text := btrim(new.item_text);
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;

  if new.is_done and (tg_op = 'INSERT' or old.is_done is distinct from true) then
    new.completed_at := now();
  elsif not new.is_done then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists shopping_items_audit_trigger on public.shopping_items;
create trigger shopping_items_audit_trigger
before insert or update on public.shopping_items
for each row execute function private.set_shopping_item_audit_fields();

create or replace function public.create_family(
  family_name text default 'Unsere Familie',
  member_name text default 'Elternteil 1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_family public.families;
begin
  if current_user_id is null then
    raise exception 'Anmeldung erforderlich';
  end if;

  if exists (select 1 from public.family_users where user_id = current_user_id) then
    raise exception 'Dieses Gerät gehört bereits zu einer Familie';
  end if;

  if char_length(btrim(coalesce(family_name, ''))) not between 1 and 80 then
    raise exception 'Der Familienname muss 1 bis 80 Zeichen lang sein';
  end if;

  if char_length(btrim(coalesce(member_name, ''))) not between 1 and 40 then
    raise exception 'Der Name muss 1 bis 40 Zeichen lang sein';
  end if;

  insert into public.families (name, created_by)
  values (btrim(family_name), current_user_id)
  returning * into new_family;

  insert into public.family_users (family_id, user_id, role, display_name)
  values (new_family.id, current_user_id, 'parent', btrim(member_name));

  return jsonb_build_object(
    'family_id', new_family.id,
    'family_name', new_family.name,
    'invite_token', new_family.invite_token
  );
end;
$$;

create or replace function public.join_family(
  invitation_token text,
  member_name text default 'Elternteil 2'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_family public.families;
  current_member_count integer;
begin
  if current_user_id is null then
    raise exception 'Anmeldung erforderlich';
  end if;

  if exists (select 1 from public.family_users where user_id = current_user_id) then
    raise exception 'Dieses Gerät gehört bereits zu einer Familie';
  end if;

  if char_length(btrim(coalesce(member_name, ''))) not between 1 and 40 then
    raise exception 'Der Name muss 1 bis 40 Zeichen lang sein';
  end if;

  select * into target_family
  from public.families
  where invite_token = btrim(invitation_token)
  for update;

  if not found then
    raise exception 'Einladungslink ist ungültig';
  end if;

  select count(*) into current_member_count
  from public.family_users
  where family_id = target_family.id;

  if current_member_count >= 2 then
    raise exception 'Diese Familie hat bereits zwei Zugänge';
  end if;

  insert into public.family_users (family_id, user_id, role, display_name)
  values (target_family.id, current_user_id, 'parent', btrim(member_name));

  return jsonb_build_object(
    'family_id', target_family.id,
    'family_name', target_family.name
  );
end;
$$;

alter table public.families enable row level security;
alter table public.family_users enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists "family members can read family" on public.families;
create policy "family members can read family"
on public.families for select to authenticated
using ((select private.is_family_member(id)));

drop policy if exists "family members can update family" on public.families;
create policy "family members can update family"
on public.families for update to authenticated
using ((select private.is_family_member(id)))
with check ((select private.is_family_member(id)));

drop policy if exists "family members can read memberships" on public.family_users;
create policy "family members can read memberships"
on public.family_users for select to authenticated
using ((select private.is_family_member(family_id)));

drop policy if exists "family members can read shopping items" on public.shopping_items;
create policy "family members can read shopping items"
on public.shopping_items for select to authenticated
using ((select private.is_family_member(family_id)));

drop policy if exists "family members can add shopping items" on public.shopping_items;
create policy "family members can add shopping items"
on public.shopping_items for insert to authenticated
with check (
  (select private.is_family_member(family_id))
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists "family members can update shopping items" on public.shopping_items;
create policy "family members can update shopping items"
on public.shopping_items for update to authenticated
using ((select private.is_family_member(family_id)))
with check ((select private.is_family_member(family_id)));

drop policy if exists "family members can delete shopping items" on public.shopping_items;
create policy "family members can delete shopping items"
on public.shopping_items for delete to authenticated
using ((select private.is_family_member(family_id)));

revoke all on public.families from anon, authenticated;
revoke all on public.family_users from anon, authenticated;
revoke all on public.shopping_items from anon, authenticated;

grant select, update on public.families to authenticated;
grant select on public.family_users to authenticated;
grant select, insert, update, delete on public.shopping_items to authenticated;
grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text) to authenticated;

revoke all on function public.create_family(text, text) from public, anon;
revoke all on function public.join_family(text, text) from public, anon;

alter table public.shopping_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end
$$;

commit;
