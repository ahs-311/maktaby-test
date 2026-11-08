-- Maktaby: server-side manager signup activation codes.
-- Review this migration before running it. It intentionally marks NEW manager profiles inactive
-- until a server-verified email/WhatsApp challenge is completed. It does not change existing
-- profiles, manager-recovery tables, functions, or secrets.

create table if not exists public.manager_activation_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  destination text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 8),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists manager_activation_user_created_idx
  on public.manager_activation_challenges (user_id, created_at desc);

alter table public.manager_activation_challenges enable row level security;
revoke all on public.manager_activation_challenges from anon, authenticated;
grant all on public.manager_activation_challenges to service_role;

create or replace function public.mk_manager_activation_pending()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'manager' and auth.uid() = new.user_id then
    new.active := false;
    new.extra := coalesce(new.extra, '{}'::jsonb) || jsonb_build_object('activationRequired', true);
  end if;
  return new;
end;
$$;
revoke all on function public.mk_manager_activation_pending() from public, anon, authenticated;

drop trigger if exists profiles_manager_activation_pending on public.profiles;
create trigger profiles_manager_activation_pending
before insert on public.profiles
for each row execute function public.mk_manager_activation_pending();

-- Called only by manager-activation using the service role. It counts every attempted code,
-- compares the digest, activates the pending manager and consumes the challenge atomically.
create or replace function public.mk_manager_activation_complete(
  p_challenge_id uuid,
  p_user_id uuid,
  p_code_hash text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.manager_activation_challenges%rowtype;
  v_updated integer;
begin
  select * into v_challenge
    from public.manager_activation_challenges
   where id = p_challenge_id and user_id = p_user_id
   for update;
  if not found or v_challenge.used_at is not null or v_challenge.expires_at <= now() then
    return false;
  end if;
  if v_challenge.attempts >= 8 then
    return false;
  end if;
  update public.manager_activation_challenges
     set attempts = attempts + 1
   where id = p_challenge_id;
  if v_challenge.code_hash <> p_code_hash then
    return false;
  end if;
  update public.profiles p
     set active = true,
         extra = (coalesce(p.extra, '{}'::jsonb) - 'activationRequired') ||
           case when v_challenge.channel = 'email' then
             jsonb_build_object('contactEmail', v_challenge.destination, 'emailVerified', true)
           else
             jsonb_build_object('contactPhone', v_challenge.destination, 'phoneVerified', true)
           end
   where p.user_id = p_user_id
     and p.role = 'manager'
     and p.active = false
     and coalesce((select o.active from public.offices o where o.id = p.office_id), false) = true;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return false;
  end if;
  update public.manager_activation_challenges
     set used_at = now()
   where id = p_challenge_id;
  return true;
end;
$$;
revoke all on function public.mk_manager_activation_complete(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mk_manager_activation_complete(uuid, uuid, text) to service_role;
