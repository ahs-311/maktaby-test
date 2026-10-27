-- =====================================================================
-- مكتبي — Migration 04: التعليقات على المهام والجلسات والمواعيد (المرحلة D)
-- نفّذه بعد migration-01 و02 و03 (آمن لو أعدت تنفيذه).
-- ما يفعله:
--   1) يسمح بمجموعة جديدة اسمها comments في جدول records.
--   2) يربطها بالأقسام في collection_modules (دون حذف أي ربط قديم).
--   3) الموكل لا يرى تعليقًا إلا إذا كان visibleToClient = true ومرتبطًا بسجلاته.
--   4) يضيف comments إلى my_permissions() ليعرف التطبيق صلاحياتك مبكرًا.
-- لا يغيّر سياسات records: تعمل عليها نفس قواعد الاشتراك والأقسام (mk_can).
-- =====================================================================
reset role;

-- ---------- 1) السماح بالمجموعة الجديدة ----------
alter table public.records drop constraint if exists records_collection_check;
alter table public.records add constraint records_collection_check check (collection in (
  'attachments','bailiffs','cases','clients','docs','events','fin_entries','invoices',
  'ld_cases','ld_checklist','notes','poas','sessions','tasks','workdays','comments','_meta'
));

-- ---------- 2) ربط التعليقات بالأقسام (إضافة فقط) ----------
-- من يقرأ المهام/الجلسات/المواعيد في قسم يستطيع قراءة تعليقاتها والتعليق عليها.
-- (تعديل نتيجة الجلسة أو تأجيلها يحتاج صلاحية كتابة sessions/events/tasks كما كان.)
insert into public.collection_modules (collection, module, mode)
select 'comments', m, x.mode
from unnest(array['dashboard','agenda','calendar','tasks','courtday','cases','settings']) as m
cross join (values ('read'), ('write')) as x(mode)
on conflict do nothing;

-- ---------- 3) رؤية الموكل ----------
-- نفس الدالة القديمة + فرع comments. الموكل لا يكتب أبدًا (mk_can تمنعه).
create or replace function public.mk_client_can_read(o uuid, c text, i text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mk_client_id() is null then false
    when c = 'clients' then i = public.mk_client_id()
    when c in ('cases','invoices','poas') then d->>'clientId' = public.mk_client_id()
    when c in ('sessions','events','tasks','notes','docs','attachments','bailiffs') then
      d->>'clientId' = public.mk_client_id()
      or exists (
        select 1 from public.records r
        where r.office_id = o and r.collection = 'cases' and r.id = d->>'caseId'
          and not r.deleted and r.data->>'clientId' = public.mk_client_id()
      )
    when c = 'comments' then
      d->>'visibleToClient' = 'true'
      and (
        d->>'clientId' = public.mk_client_id()
        or exists (
          select 1 from public.records r
          where r.office_id = o and r.collection = 'cases' and r.id = d->>'caseId'
            and not r.deleted and r.data->>'clientId' = public.mk_client_id()
        )
      )
    else false
  end
$$;

-- ---------- 4) صلاحياتي ----------
create or replace function public.my_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c text; r jsonb := '[]'::jsonb; w jsonb := '[]'::jsonb;
begin
  foreach c in array array['attachments','bailiffs','cases','clients','docs','events','fin_entries','invoices',
                           'ld_cases','ld_checklist','notes','poas','sessions','tasks','workdays','comments','_meta'] loop
    if public.mk_can(c, false) then r := r || to_jsonb(c); end if;
    if public.mk_can(c, true)  then w := w || to_jsonb(c); end if;
  end loop;
  return jsonb_build_object('role', public.mk_role(), 'read', r, 'write', w);
end $$;

revoke execute on function public.mk_client_can_read(uuid, text, text, jsonb), public.my_permissions() from public, anon;
grant  execute on function public.mk_client_can_read(uuid, text, text, jsonb), public.my_permissions() to authenticated;

-- للتحقق: يجب أن يظهر صفّا comments (read و write) لكل قسم من الأقسام السبعة
select module, mode from public.collection_modules where collection = 'comments' order by 1, 2;
