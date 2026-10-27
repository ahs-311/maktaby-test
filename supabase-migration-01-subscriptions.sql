-- =====================================================================
-- مكتبي — Migration 01: الاشتراكات + تنبيهات المالك
-- نفّذه مرة واحدة بعد supabase-schema.sql (آمن لو أعدت تنفيذه).
-- =====================================================================
reset role;

-- ---------- 1) أعمدة الاشتراك ----------
alter table public.offices add column if not exists trial_ends_at timestamptz;
alter table public.offices add column if not exists paid_until   timestamptz;

-- المكاتب الموجودة حاليًا: تبدأ تجربتها المجانية (أسبوعان) من لحظة التنفيذ
update public.offices set trial_ends_at = now() + interval '14 days' where trial_ends_at is null;
alter table public.offices alter column trial_ends_at set default (now() + interval '14 days');
alter table public.offices alter column trial_ends_at set not null;

-- ---------- 2) سجل الدفعات (للمالك فقط) ----------
create table if not exists public.subscription_payments (
  id             uuid primary key default gen_random_uuid(),
  office_id      uuid not null references public.offices(id) on delete cascade,
  amount         numeric(12,2),
  method         text,
  reference      text,
  note           text,
  days_added     int,
  ends_at_after  timestamptz not null,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists subscription_payments_office_idx on public.subscription_payments (office_id, created_at desc);

-- ---------- 3) تنبيهات المالك ----------
create table if not exists public.announcements (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 150),
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  severity         text not null default 'info' check (severity in ('info','warning','urgent')),
  target_office_id uuid references public.offices(id) on delete cascade,  -- null = كل المديرين
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create index if not exists announcements_target_idx on public.announcements (target_office_id, created_at desc);

-- ---------- 4) حالة الاشتراك ----------
-- trial / active / expiring (آخر 7 أيام) / readonly (يومان بعد النهاية) / suspended
create or replace function public.mk_office_state(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not f.active                                      then 'suspended'
    when now() > f.e + interval '2 days'                   then 'suspended'
    when now() > f.e                                       then 'readonly'
    when now() > f.e - interval '7 days'                   then 'expiring'
    when f.paid_until is not null and f.paid_until >= f.trial_ends_at then 'active'
    else 'trial'
  end
  from (
    select active, trial_ends_at, paid_until,
           greatest(trial_ends_at, coalesce(paid_until, trial_ends_at)) as e
    from public.offices where id = o
  ) f
$$;

create or replace function public.mk_office_readable(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mk_office_state(o) in ('trial','active','expiring','readonly'), false)
$$;

create or replace function public.mk_office_writable(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mk_office_state(o) in ('trial','active','expiring'), false)
$$;

create or replace function public.my_office_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o uuid := public.mk_office_id(); r record;
begin
  if v_o is null then
    return jsonb_build_object('state', 'none', 'server_now', now());
  end if;
  select name, active, trial_ends_at, paid_until,
         greatest(trial_ends_at, coalesce(paid_until, trial_ends_at)) as e
    into r from public.offices where id = v_o;
  return jsonb_build_object(
    'office_id', v_o, 'name', r.name,
    'state', public.mk_office_state(v_o),
    'ends_at', r.e, 'readonly_until', r.e + interval '2 days',
    'trial_ends_at', r.trial_ends_at, 'paid_until', r.paid_until,
    'manual_stop', not r.active, 'server_now', now());
end $$;

-- ---------- 5) الأمان (RLS) ----------
alter table public.subscription_payments enable row level security;
alter table public.announcements         enable row level security;
revoke all on public.subscription_payments, public.announcements from anon, authenticated;
grant select on public.subscription_payments, public.announcements to authenticated;

drop policy if exists payments_select on public.subscription_payments;
create policy payments_select on public.subscription_payments for select to authenticated
using ( public.mk_role() = 'owner' );

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  public.mk_role() = 'owner'
  or ( public.mk_role() = 'manager'
       and ( target_office_id is null or target_office_id = public.mk_office_id() ) )
);

-- سجلات البيانات: القراءة حتى وضع العرض فقط، والكتابة قبله فقط
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
using (
  office_id = public.mk_office_id()
  and public.mk_office_readable(office_id)
  and (
    public.mk_role() in ('manager','lawyer')
    or (public.mk_role() = 'client' and public.mk_client_can_read(office_id, collection, id, data))
  )
);

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
with check (
  office_id = public.mk_office_id()
  and public.mk_office_writable(office_id)
  and public.mk_role() in ('manager','lawyer')
);

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
using (
  office_id = public.mk_office_id()
  and public.mk_office_writable(office_id)
  and public.mk_role() in ('manager','lawyer')
)
with check (
  office_id = public.mk_office_id()
  and public.mk_office_writable(office_id)
  and public.mk_role() in ('manager','lawyer')
);

-- ---------- 6) إجراءات المالك ----------
create or replace function public.renew_subscription(
  p_office_id uuid, p_days int, p_until timestamptz,
  p_amount numeric, p_method text, p_reference text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.offices; v_end timestamptz; v_base timestamptz; v_new timestamptz;
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  select * into o from public.offices where id = p_office_id;
  if not found then raise exception 'not_found'; end if;
  if p_until is null and coalesce(p_days, 0) <= 0 then raise exception 'bad_duration'; end if;
  v_end  := greatest(o.trial_ends_at, coalesce(o.paid_until, o.trial_ends_at));
  v_base := greatest(now(), v_end);   -- ساري: يمتد من نهايته، منتهٍ: من لحظة التجديد
  v_new  := coalesce(p_until, v_base + make_interval(days => p_days));
  update public.offices set paid_until = v_new where id = p_office_id;
  insert into public.subscription_payments
    (office_id, amount, method, reference, note, days_added, ends_at_after, created_by)
  values
    (p_office_id, p_amount, nullif(btrim(p_method),''), nullif(btrim(p_reference),''), nullif(btrim(p_note),''),
     greatest(0, round(extract(epoch from (v_new - v_base)) / 86400)::int),
     greatest(o.trial_ends_at, v_new), auth.uid());
  return jsonb_build_object('ends_at', greatest(o.trial_ends_at, v_new));
end $$;

-- تصحيح التواريخ يدويًا (خطأ في تجديد مثلًا)
create or replace function public.adjust_office_dates(
  p_office_id uuid, p_trial_ends_at timestamptz, p_paid_until timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  if p_trial_ends_at is null then raise exception 'bad_duration'; end if;
  update public.offices set trial_ends_at = p_trial_ends_at, paid_until = p_paid_until where id = p_office_id;
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.create_announcement(
  p_title text, p_body text, p_severity text, p_target_office_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  insert into public.announcements(title, body, severity, target_office_id, created_by)
  values (btrim(p_title), btrim(p_body), coalesce(nullif(p_severity,''), 'info'), p_target_office_id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  delete from public.announcements where id = p_id;
end $$;

-- ---------- 7) إدارة الحسابات تحترم وضع العرض فقط ----------
create or replace function public.add_member(
  p_user_id uuid, p_username text, p_full_name text, p_role text,
  p_permissions jsonb default '[]'::jsonb, p_client_id text default null, p_extra jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles;
  v_user text := lower(btrim(p_username));
begin
  select * into v_me from public.profiles where user_id = auth.uid() and active;
  if v_me.role is distinct from 'manager' then raise exception 'forbidden'; end if;
  if not public.mk_office_writable(v_me.office_id) then raise exception 'office_readonly'; end if;
  if p_role not in ('lawyer','client') then raise exception 'bad_role'; end if;
  if p_role = 'client' and coalesce(p_client_id,'') = '' then raise exception 'client_required'; end if;
  if v_user !~ '^[a-z0-9._-]{3,30}$' then raise exception 'bad_username'; end if;
  if not exists (
    select 1 from auth.users
    where id = p_user_id and lower(email) = v_user || '@maktaby.app'
      and created_at > now() - interval '10 minutes'
  ) then raise exception 'invalid_target'; end if;
  if exists (select 1 from public.profiles where user_id = p_user_id) then raise exception 'profile_exists'; end if;
  insert into public.profiles(user_id, office_id, username, full_name, role, permissions, client_id, extra)
  values (p_user_id, v_me.office_id, v_user, btrim(p_full_name), p_role,
          coalesce(p_permissions,'[]'::jsonb), nullif(p_client_id,''), coalesce(p_extra,'{}'::jsonb));
end $$;

create or replace function public.update_member(
  p_user_id uuid, p_full_name text, p_permissions jsonb, p_client_id text,
  p_extra jsonb, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_me public.profiles; v_n int;
begin
  select * into v_me from public.profiles where user_id = auth.uid() and active;
  if v_me.role is distinct from 'manager' then raise exception 'forbidden'; end if;
  if not public.mk_office_writable(v_me.office_id) then raise exception 'office_readonly'; end if;
  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name),''), full_name),
         permissions = coalesce(p_permissions, permissions),
         client_id = case when role = 'client' then nullif(p_client_id,'') else null end,
         extra = coalesce(p_extra, extra),
         active = coalesce(p_active, active)
   where user_id = p_user_id and office_id = v_me.office_id and role in ('lawyer','client');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'not_found'; end if;
end $$;

create or replace function public.delete_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me public.profiles;
begin
  select * into v_me from public.profiles where user_id = auth.uid() and active;
  if v_me.role is distinct from 'manager' then raise exception 'forbidden'; end if;
  if not public.mk_office_writable(v_me.office_id) then raise exception 'office_readonly'; end if;
  if not exists (select 1 from public.profiles
                 where user_id = p_user_id and office_id = v_me.office_id and role in ('lawyer','client')) then
    raise exception 'not_found';
  end if;
  delete from auth.users where id = p_user_id;
end $$;

-- ---------- 8) صلاحيات التنفيذ ----------
revoke execute on function
  public.mk_office_state(uuid), public.mk_office_readable(uuid), public.mk_office_writable(uuid),
  public.my_office_status(),
  public.renew_subscription(uuid, int, timestamptz, numeric, text, text, text),
  public.adjust_office_dates(uuid, timestamptz, timestamptz),
  public.create_announcement(text, text, text, uuid),
  public.delete_announcement(uuid)
from public, anon;

grant execute on function
  public.mk_office_state(uuid), public.mk_office_readable(uuid), public.mk_office_writable(uuid),
  public.my_office_status(),
  public.renew_subscription(uuid, int, timestamptz, numeric, text, text, text),
  public.adjust_office_dates(uuid, timestamptz, timestamptz),
  public.create_announcement(text, text, text, uuid),
  public.delete_announcement(uuid)
to authenticated;

-- للتحقق: يجب أن تظهر حالة كل مكتب
select name, public.mk_office_state(id) as state, trial_ends_at, paid_until from public.offices;
