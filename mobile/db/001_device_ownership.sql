begin;

create table public.dryspool_devices (
  serial text primary key check (serial ~ '^[-a-zA-Z0-9_]{1,128}$'),
  owner_id uuid not null references auth.users(id),
  label text not null check (length(label) between 1 and 64),
  created_at timestamptz not null default now()
);
create index dryspool_devices_owner on public.dryspool_devices(owner_id, created_at);

create table public.dryspool_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serial text not null check (serial ~ '^[-a-zA-Z0-9_]{1,128}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  completed_at timestamptz
);
create index dryspool_claims_user on public.dryspool_claims(user_id, created_at);

alter table public.dryspool_devices enable row level security;
alter table public.dryspool_claims enable row level security;
revoke all on public.dryspool_devices, public.dryspool_claims from public, anon, authenticated;
grant select, update on public.dryspool_devices to service_role;
grant select on public.dryspool_claims to service_role;

create function public.dryspool_start_claim(p_user uuid, p_serial text, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created public.dryspool_claims%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
  if exists (select 1 from public.dryspool_devices where serial = p_serial) then
    return null;
  end if;

  delete from public.dryspool_claims
  where user_id = p_user and expires_at < now() - interval '1 day';

  if (select count(*) from public.dryspool_claims
      where user_id = p_user and created_at > now() - interval '10 minutes') >= 20 then
    return '{}'::jsonb;
  end if;

  insert into public.dryspool_claims (user_id, serial, token_hash)
  values (p_user, p_serial, p_hash) returning * into created;
  return jsonb_build_object('id', created.id, 'expires_at', created.expires_at);
end;
$$;

create function public.dryspool_finish_claim(p_user uuid, p_id uuid, p_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  attempt public.dryspool_claims%rowtype;
  current_owner uuid;
begin
  select * into attempt from public.dryspool_claims
    where id = p_id and user_id = p_user and token_hash = p_hash for update;
  if not found then return 'expired'; end if;
  if attempt.completed_at is not null then return 'added'; end if;
  if attempt.expires_at <= clock_timestamp() then return 'expired'; end if;

  insert into public.dryspool_devices (serial, owner_id, label)
    values (attempt.serial, p_user, 'Box ' || right(attempt.serial, 6))
    on conflict (serial) do nothing;
  select owner_id into current_owner from public.dryspool_devices where serial = attempt.serial;
  if current_owner is distinct from p_user then return 'claimed'; end if;

  update public.dryspool_claims set completed_at = clock_timestamp() where id = attempt.id;
  return 'added';
end;
$$;

revoke all on function public.dryspool_start_claim(uuid,text,text),
  public.dryspool_finish_claim(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.dryspool_start_claim(uuid,text,text),
  public.dryspool_finish_claim(uuid,uuid,text) to service_role;
commit;
