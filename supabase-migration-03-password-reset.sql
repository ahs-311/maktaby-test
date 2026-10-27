-- =====================================================================
-- مكتبي — Migration 03: دعم تغيير كلمة مرور موظف (Edge Function)
-- نفّذه بعد migration-02 (آمن لو أعدت تنفيذه).
-- =====================================================================
reset role;

-- رقم يزيد عند كل إعادة تعيين، فيُلغي الدخول الأوفلاين القديم على أجهزة الموظف
alter table public.profiles add column if not exists pw_version int not null default 0;

-- سجل العمليات الإدارية (يقرؤه المدير والمالك)
create table if not exists public.member_events (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.offices(id) on delete cascade,
  actor_id    uuid,
  target_id   uuid,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists member_events_actor_idx  on public.member_events (actor_id, action, created_at desc);
create index if not exists member_events_office_idx on public.member_events (office_id, created_at desc);

alter table public.member_events enable row level security;
revoke all on public.member_events from anon, authenticated;
grant select on public.member_events to authenticated;

drop policy if exists member_events_select on public.member_events;
create policy member_events_select on public.member_events for select to authenticated
using (
  public.mk_role() = 'owner'
  or ( public.mk_role() = 'manager' and office_id = public.mk_office_id() )
);

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'pw_version';
