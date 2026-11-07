-- Maktaby manager recovery: short-lived server-only verification challenges.
-- Run once in Supabase SQL Editor before deploying the manager-recovery Edge Function.
create table if not exists public.manager_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('recovery','contact')),
  channel text not null check (channel in ('email','sms','whatsapp')),
  destination text not null,
  code_hash text,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 8),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
-- Recovery destinations are isolated from profiles, which are readable by office members.
create table if not exists public.manager_recovery_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recovery_email text,
  recovery_email_verified boolean not null default false,
  recovery_phone text,
  recovery_phone_verified boolean not null default false,
  updated_at timestamptz not null default now(),
  check (recovery_email is null or length(recovery_email) <= 320),
  check (recovery_phone is null or length(recovery_phone) <= 16)
);
alter table public.manager_recovery_contacts enable row level security;
revoke all on public.manager_recovery_contacts from anon, authenticated;
grant select on public.manager_recovery_contacts to authenticated;
create policy manager_recovery_contacts_self_read on public.manager_recovery_contacts
  for select to authenticated using (user_id = auth.uid());
grant all on public.manager_recovery_contacts to service_role;

create index if not exists manager_recovery_user_created_idx
  on public.manager_recovery_challenges(user_id, purpose, created_at desc);
create index if not exists manager_recovery_expiry_idx
  on public.manager_recovery_challenges(expires_at);
alter table public.manager_recovery_challenges enable row level security;
revoke all on public.manager_recovery_challenges from anon, authenticated;
grant all on public.manager_recovery_challenges to service_role;

-- Service-only helpers make OTP attempt limits and one-time use atomic.
create or replace function public.mk_recovery_bump_attempt(p_challenge_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_attempts integer;
begin
  update public.manager_recovery_challenges
     set attempts = attempts + 1
   where id = p_challenge_id and used_at is null and expires_at > now() and attempts < 8
   returning attempts into v_attempts;
  return v_attempts;
end $$;
revoke all on function public.mk_recovery_bump_attempt(uuid) from public, anon, authenticated;
grant execute on function public.mk_recovery_bump_attempt(uuid) to service_role;

create or replace function public.mk_recovery_consume(p_challenge_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.manager_recovery_challenges
     set used_at = now()
   where id = p_challenge_id and used_at is null and expires_at > now() and attempts <= 8
   returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.mk_recovery_consume(uuid) from public, anon, authenticated;
grant execute on function public.mk_recovery_consume(uuid) to service_role;

create or replace function public.mk_set_recovery_contact(p_user_id uuid, p_channel text, p_destination text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id and role = 'manager' and active) then
    raise exception 'manager_not_found';
  end if;
  if p_channel = 'email' then
    insert into public.manager_recovery_contacts (user_id, recovery_email, recovery_email_verified, updated_at)
      values (p_user_id, lower(btrim(p_destination)), true, now())
      on conflict (user_id) do update set recovery_email = excluded.recovery_email,
        recovery_email_verified = true, updated_at = now();
  elsif p_channel in ('sms','whatsapp') then
    insert into public.manager_recovery_contacts (user_id, recovery_phone, recovery_phone_verified, updated_at)
      values (p_user_id, btrim(p_destination), true, now())
      on conflict (user_id) do update set recovery_phone = excluded.recovery_phone,
        recovery_phone_verified = true, updated_at = now();
  else
    raise exception 'bad_channel';
  end if;
end $$;
revoke all on function public.mk_set_recovery_contact(uuid,text,text) from public, anon, authenticated;
grant execute on function public.mk_set_recovery_contact(uuid,text,text) to service_role;

create or replace function public.mk_recovery_increment_pw_version(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set pw_version = coalesce(pw_version,0) + 1
   where user_id = p_user_id and role = 'manager' and active;
  if not found then raise exception 'manager_not_found'; end if;
end $$;
revoke all on function public.mk_recovery_increment_pw_version(uuid) from public, anon, authenticated;
grant execute on function public.mk_recovery_increment_pw_version(uuid) to service_role;
