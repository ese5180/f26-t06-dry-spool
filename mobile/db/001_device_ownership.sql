begin;

create table public.dryspool_devices (
  serial text primary key check (serial ~ '^[-a-zA-Z0-9_]{1,128}$'),
  owner_id uuid not null references auth.users(id),
  label text not null check (length(label) between 1 and 64),
  created_at timestamptz not null default now()
);
create index dryspool_devices_owner on public.dryspool_devices(owner_id, created_at);

alter table public.dryspool_devices enable row level security;
revoke all on public.dryspool_devices from public, anon, authenticated;
grant select, update on public.dryspool_devices to service_role;
commit;
