-- مكتبي: باقات المكاتب + طلبات المساحة + حصص التخزين على مستوى المكتب
-- نفّذ هذا الملف في SQL Editor بعد الهجرات السابقة.
-- آمن للتشغيل المتكرر (IF NOT EXISTS / CREATE OR REPLACE).

-- ---------- 1) أعمدة الباقة والحصة على المكاتب ----------
alter table public.offices add column if not exists plan_id text default 'p1';
alter table public.offices add column if not exists addon_ids jsonb default '[]'::jsonb;
alter table public.offices add column if not exists custom_files_mb integer default 0;
alter table public.offices add column if not exists custom_db_mb integer default 0;
alter table public.offices add column if not exists file_limit_bytes bigint;
alter table public.offices add column if not exists db_limit_bytes bigint;

-- قيم افتراضية للمكاتب الحالية (باقة صغيرة إن لم تُضبط)
update public.offices
set plan_id = coalesce(nullif(plan_id, ''), 'p1'),
    addon_ids = coalesce(addon_ids, '[]'::jsonb),
    custom_files_mb = coalesce(custom_files_mb, 0),
    custom_db_mb = coalesce(custom_db_mb, 0)
where true;

-- إن لم تُضبط الحصة: صغيرة = 250MB ملفات + 50MB بيانات
update public.offices
set file_limit_bytes = coalesce(file_limit_bytes, 250 * 1024 * 1024),
    db_limit_bytes   = coalesce(db_limit_bytes, 50 * 1024 * 1024)
where file_limit_bytes is null or db_limit_bytes is null;

-- ---------- 2) جدول طلبات الباقة/المساحة ----------
create table if not exists public.plan_requests (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references public.offices(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  requester_name  text,
  req_type        text not null default 'plan' check (req_type in ('plan','custom')),
  plan_id         text,
  addon_ids       jsonb default '[]'::jsonb,
  custom_files_mb integer default 0,
  custom_db_mb    integer default 0,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  resolve_note    text,
  created_at      timestamptz not null default now()
);

create index if not exists plan_requests_office_idx on public.plan_requests (office_id, created_at desc);
create index if not exists plan_requests_status_idx on public.plan_requests (status, created_at desc);

alter table public.plan_requests enable row level security;
revoke all on public.plan_requests from anon, authenticated;
grant select on public.plan_requests to authenticated;

drop policy if exists plan_requests_select on public.plan_requests;
create policy plan_requests_select on public.plan_requests for select to authenticated
using (
  public.mk_role() = 'owner'
  or (public.mk_role() = 'manager' and office_id = public.mk_office_id())
);

-- ---------- 3) حساب الحصة من الباقة ----------
create or replace function public.mk_calc_plan_limits(
  p_plan_id text,
  p_addon_ids jsonb,
  p_custom_files_mb integer,
  p_custom_db_mb integer
) returns jsonb
language plpgsql immutable as $$
declare
  v_files integer := 250;
  v_db integer := 50;
  a text;
begin
  case coalesce(p_plan_id, 'p1')
    when 'p2' then v_files := 450; v_db := 50;
    when 'p3' then v_files := 900; v_db := 100;
    else v_files := 250; v_db := 50;
  end case;

  if p_addon_ids is not null then
    for a in select jsonb_array_elements_text(p_addon_ids)
    loop
      if a = 'a1' then v_files := v_files + 500; v_db := v_db + 100;
      elsif a = 'a2' then v_files := v_files + 750; v_db := v_db + 150;
      elsif a = 'a3' then v_files := v_files + 1024; v_db := v_db + 200;
      end if;
    end loop;
  end if;

  v_files := v_files + greatest(coalesce(p_custom_files_mb, 0), 0);
  v_db := v_db + greatest(coalesce(p_custom_db_mb, 0), 0);

  return jsonb_build_object(
    'files_mb', v_files,
    'db_mb', v_db,
    'file_limit_bytes', (v_files::bigint) * 1024 * 1024,
    'db_limit_bytes', (v_db::bigint) * 1024 * 1024
  );
end $$;

-- ---------- 4) تقديم طلب من المدير ----------
create or replace function public.submit_plan_request(
  p_req_type text,
  p_plan_id text,
  p_addon_ids jsonb,
  p_custom_files_mb integer,
  p_custom_db_mb integer,
  p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles;
  v_id uuid;
begin
  select * into v_me from public.profiles where user_id = auth.uid() and active;
  if v_me.role is distinct from 'manager' then raise exception 'forbidden'; end if;
  if v_me.office_id is null then raise exception 'forbidden'; end if;
  if coalesce(p_req_type, 'plan') not in ('plan','custom') then raise exception 'bad_request'; end if;

  insert into public.plan_requests(
    office_id, requested_by, requester_name, req_type, plan_id, addon_ids,
    custom_files_mb, custom_db_mb, note, status
  ) values (
    v_me.office_id, auth.uid(), v_me.full_name,
    coalesce(p_req_type, 'plan'), p_plan_id, coalesce(p_addon_ids, '[]'::jsonb),
    coalesce(p_custom_files_mb, 0), coalesce(p_custom_db_mb, 0), nullif(btrim(p_note), ''), 'pending'
  ) returning id into v_id;

  return v_id;
end $$;

-- ---------- 5) قائمة الطلبات (المالك: الكل / المدير: مكتبه) ----------
create or replace function public.list_plan_requests(p_status text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.mk_role();
  v_office uuid := public.mk_office_id();
  v_rows jsonb;
begin
  if v_role = 'owner' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
    from (
      select r.id, r.office_id, r.requested_by, r.requester_name, r.req_type, r.plan_id,
             r.addon_ids, r.custom_files_mb, r.custom_db_mb, r.note, r.status,
             r.resolved_by, r.resolved_at, r.resolve_note, r.created_at, o.name as office_name
      from public.plan_requests r
      join public.offices o on o.id = r.office_id
      where (p_status is null or r.status = p_status)
      order by r.created_at desc
      limit 200
    ) x;
  elsif v_role = 'manager' and v_office is not null then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
    from (
      select r.id, r.office_id, r.requested_by, r.requester_name, r.req_type, r.plan_id,
             r.addon_ids, r.custom_files_mb, r.custom_db_mb, r.note, r.status,
             r.resolved_by, r.resolved_at, r.resolve_note, r.created_at, o.name as office_name
      from public.plan_requests r
      join public.offices o on o.id = r.office_id
      where r.office_id = v_office
        and (p_status is null or r.status = p_status)
      order by r.created_at desc
      limit 100
    ) x;
  else
    raise exception 'forbidden';
  end if;
  return coalesce(v_rows, '[]'::jsonb);
end $$;

-- ---------- 6) تعيين باقة/حصة مكتب (المالك) + إشعار ----------
create or replace function public.set_office_plan(
  p_office_id uuid,
  p_plan_id text,
  p_addon_ids jsonb,
  p_custom_files_mb integer,
  p_custom_db_mb integer,
  p_announce boolean default true,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lim jsonb;
  v_name text;
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.offices where id = p_office_id) then raise exception 'not_found'; end if;

  v_lim := public.mk_calc_plan_limits(p_plan_id, coalesce(p_addon_ids, '[]'::jsonb), coalesce(p_custom_files_mb, 0), coalesce(p_custom_db_mb, 0));

  update public.offices set
    plan_id = coalesce(nullif(p_plan_id, ''), plan_id),
    addon_ids = coalesce(p_addon_ids, '[]'::jsonb),
    custom_files_mb = coalesce(p_custom_files_mb, 0),
    custom_db_mb = coalesce(p_custom_db_mb, 0),
    file_limit_bytes = (v_lim->>'file_limit_bytes')::bigint,
    db_limit_bytes = (v_lim->>'db_limit_bytes')::bigint
  where id = p_office_id
  returning name into v_name;

  if coalesce(p_announce, true) then
    insert into public.announcements(title, body, severity, target_office_id, created_by)
    values (
      'تحديث باقة/مساحة مكتبك',
      'قام المالك بتحديث باقة ومساحة مكتبك.' || E'\n' ||
      'الباقة: ' || coalesce(p_plan_id, '—') || E'\n' ||
      'مستندات: ' || (v_lim->>'files_mb') || ' ميجا · بيانات: ' || (v_lim->>'db_mb') || ' ميجا' ||
      case when p_note is not null and btrim(p_note) <> '' then E'\nملاحظة: ' || btrim(p_note) else '' end ||
      E'\n\n' || '[[MK_PLAN_DECISION]]' || jsonb_build_object(
        'planId', p_plan_id,
        'addonIds', coalesce(p_addon_ids, '[]'::jsonb),
        'customFilesMB', coalesce(p_custom_files_mb, 0),
        'customDbMB', coalesce(p_custom_db_mb, 0),
        'approved', true,
        'at', now()
      )::text,
      'info',
      p_office_id,
      auth.uid()
    );
  end if;

  return v_lim || jsonb_build_object('office_id', p_office_id, 'office_name', v_name);
end $$;

-- ---------- 7) البت في طلب (موافقة/رفض) ----------
create or replace function public.resolve_plan_request(
  p_request_id uuid,
  p_approve boolean,
  p_plan_id text default null,
  p_addon_ids jsonb default null,
  p_custom_files_mb integer default null,
  p_custom_db_mb integer default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.plan_requests;
  v_lim jsonb := '{}'::jsonb;
  v_plan text;
  v_addons jsonb;
  v_cf integer;
  v_cd integer;
begin
  if public.mk_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  select * into r from public.plan_requests where id = p_request_id;
  if not found then raise exception 'not_found'; end if;
  if r.status is distinct from 'pending' then raise exception 'already_resolved'; end if;

  if p_approve then
    v_plan := coalesce(nullif(p_plan_id, ''), r.plan_id, 'p1');
    v_addons := coalesce(p_addon_ids, r.addon_ids, '[]'::jsonb);
    v_cf := coalesce(p_custom_files_mb, r.custom_files_mb, 0);
    v_cd := coalesce(p_custom_db_mb, r.custom_db_mb, 0);
    v_lim := public.set_office_plan(r.office_id, v_plan, v_addons, v_cf, v_cd, true, p_note);
    update public.plan_requests set
      status = 'approved', resolved_by = auth.uid(), resolved_at = now(), resolve_note = nullif(btrim(p_note), '')
    where id = p_request_id;
  else
    update public.plan_requests set
      status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolve_note = nullif(btrim(p_note), '')
    where id = p_request_id;
    insert into public.announcements(title, body, severity, target_office_id, created_by)
    values (
      'رفض طلب تعديل الباقة/المساحة',
      'تم رفض طلب تعديل الباقة أو المساحة.' ||
      case when p_note is not null and btrim(p_note) <> '' then E'\nالسبب: ' || btrim(p_note) else '' end ||
      E'\n\n' || '[[MK_PLAN_DECISION]]' || jsonb_build_object('approved', false, 'at', now())::text,
      'warning', r.office_id, auth.uid()
    );
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approve, 'limits', v_lim);
end $$;

grant execute on function public.mk_calc_plan_limits(text, jsonb, integer, integer) to authenticated;
grant execute on function public.submit_plan_request(text, text, jsonb, integer, integer, text) to authenticated;
grant execute on function public.list_plan_requests(text) to authenticated;
grant execute on function public.set_office_plan(uuid, text, jsonb, integer, integer, boolean, text) to authenticated;
grant execute on function public.resolve_plan_request(uuid, boolean, text, jsonb, integer, integer, text) to authenticated;

-- ---------- 8) تحديث my_storage_usage إن وُجدت جداول الملفات ----------
-- تعتمد على أعمدة file_limit_bytes / db_limit_bytes في offices.
-- إن كانت الدالة معرفة سابقًا بشكل مختلف، هذا التعريف يُفضّل حدود المكتب من الجدول.
create or replace function public.my_storage_usage()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_office uuid := public.mk_office_id();
  v_role text := public.mk_role();
  o public.offices;
  v_file_used bigint := 0;
  v_db_used bigint := 0;
  v_file_lim bigint;
  v_db_lim bigint;
  v_total_used bigint;
  v_total_lim bigint;
  v_pct numeric;
begin
  if v_role = 'owner' then
    return jsonb_build_object(
      'file_used', 0, 'file_limit', 0, 'db_used', 0, 'db_limit', 0,
      'total_used', 0, 'total_limit', 0, 'percent', 0
    );
  end if;
  if v_office is null then raise exception 'forbidden'; end if;
  select * into o from public.offices where id = v_office;
  if not found then raise exception 'not_found'; end if;

  v_file_lim := coalesce(o.file_limit_bytes, 250 * 1024 * 1024);
  v_db_lim := coalesce(o.db_limit_bytes, 50 * 1024 * 1024);

  -- حجم بيانات القضايا من records (تقريبي عبر jsonb)
  begin
    select coalesce(sum(octet_length(data::text)), 0) into v_db_used
    from public.records where office_id = v_office and not deleted;
  exception when others then
    v_db_used := 0;
  end;

  -- حجم الملفات إن وُجد جدول file_objects أو office_files
  begin
    if to_regclass('public.file_objects') is not null then
      execute 'select coalesce(sum(size_bytes),0) from public.file_objects where office_id = $1'
        into v_file_used using v_office;
    elsif to_regclass('public.office_files') is not null then
      execute 'select coalesce(sum(size_bytes),0) from public.office_files where office_id = $1'
        into v_file_used using v_office;
    else
      v_file_used := 0;
    end if;
  exception when others then
    v_file_used := 0;
  end;

  v_total_used := v_file_used + v_db_used;
  v_total_lim := v_file_lim + v_db_lim;
  v_pct := case when v_total_lim > 0 then round((v_total_used::numeric * 1000 / v_total_lim)) / 10 else 0 end;

  return jsonb_build_object(
    'file_used', v_file_used,
    'file_limit', v_file_lim,
    'db_used', v_db_used,
    'db_limit', v_db_lim,
    'total_used', v_total_used,
    'total_limit', v_total_lim,
    'percent', v_pct,
    'plan_id', o.plan_id,
    'addon_ids', o.addon_ids,
    'custom_files_mb', o.custom_files_mb,
    'custom_db_mb', o.custom_db_mb
  );
end $$;

grant execute on function public.my_storage_usage() to authenticated;
