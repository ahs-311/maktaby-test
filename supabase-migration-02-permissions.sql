-- =====================================================================
-- مكتبي — Migration 02: فرض صلاحيات الأقسام داخل قاعدة البيانات
-- نفّذه بعد migration-01 (آمن لو أعدت تنفيذه).
-- الفكرة: كل قسم (module) يملك حق قراءة/كتابة مجموعات بيانات محددة (جدول collection_modules).
-- المدير: كل شيء داخل مكتبه. المحامي والموكل: حسب الأقسام الممنوحة لهما.
-- يمكنك تعديل الربط لاحقًا بـ insert/delete على collection_modules دون تغيير الكود.
-- =====================================================================
reset role;

-- ---------- 1) جدول الربط ----------
create table if not exists public.collection_modules (
  collection text not null,
  module     text not null,
  mode       text not null check (mode in ('read','write')),
  primary key (collection, module, mode)
);
alter table public.collection_modules enable row level security;
revoke all on public.collection_modules from anon, authenticated;
grant select on public.collection_modules to authenticated;
drop policy if exists collection_modules_select on public.collection_modules;
create policy collection_modules_select on public.collection_modules for select to authenticated using (true);

-- إعادة التعبئة الكاملة (ثابتة): احذف ثم أدخل
delete from public.collection_modules;
insert into public.collection_modules (collection, module, mode) values
  ('bailiffs','dashboard','read'),
  ('cases','dashboard','read'),
  ('events','dashboard','read'),
  ('sessions','dashboard','read'),
  ('tasks','dashboard','read'),
  ('bailiffs','dashboard','write'),
  ('tasks','dashboard','write'),
  ('attachments','clients','read'),
  ('cases','clients','read'),
  ('clients','clients','read'),
  ('docs','clients','read'),
  ('events','clients','read'),
  ('notes','clients','read'),
  ('poas','clients','read'),
  ('clients','clients','write'),
  ('attachments','cases','read'),
  ('cases','cases','read'),
  ('clients','cases','read'),
  ('docs','cases','read'),
  ('events','cases','read'),
  ('notes','cases','read'),
  ('poas','cases','read'),
  ('sessions','cases','read'),
  ('tasks','cases','read'),
  ('attachments','cases','write'),
  ('cases','cases','write'),
  ('sessions','cases','write'),
  ('tasks','cases','write'),
  ('bailiffs','courtday','read'),
  ('cases','courtday','read'),
  ('clients','courtday','read'),
  ('sessions','courtday','read'),
  ('tasks','courtday','read'),
  ('cases','courtday','write'),
  ('sessions','courtday','write'),
  ('tasks','courtday','write'),
  ('cases','agenda','read'),
  ('clients','agenda','read'),
  ('events','agenda','read'),
  ('sessions','agenda','read'),
  ('tasks','agenda','read'),
  ('bailiffs','calendar','read'),
  ('cases','calendar','read'),
  ('clients','calendar','read'),
  ('events','calendar','read'),
  ('sessions','calendar','read'),
  ('tasks','calendar','read'),
  ('events','calendar','write'),
  ('bailiffs','tasks','read'),
  ('cases','tasks','read'),
  ('clients','tasks','read'),
  ('tasks','tasks','read'),
  ('bailiffs','tasks','write'),
  ('tasks','tasks','write'),
  ('bailiffs','bailiffs','read'),
  ('cases','bailiffs','read'),
  ('clients','bailiffs','read'),
  ('tasks','bailiffs','read'),
  ('bailiffs','bailiffs','write'),
  ('events','bailiffs','write'),
  ('tasks','bailiffs','write'),
  ('attachments','poas','read'),
  ('cases','poas','read'),
  ('clients','poas','read'),
  ('poas','poas','read'),
  ('attachments','poas','write'),
  ('cases','poas','write'),
  ('poas','poas','write'),
  ('cases','notes','read'),
  ('notes','notes','read'),
  ('notes','notes','write'),
  ('attachments','documents','read'),
  ('cases','documents','read'),
  ('docs','documents','read'),
  ('attachments','documents','write'),
  ('docs','documents','write'),
  ('cases','billing','read'),
  ('clients','billing','read'),
  ('invoices','billing','read'),
  ('cases','billing','write'),
  ('invoices','billing','write'),
  ('cases','lawsuits','read'),
  ('clients','lawsuits','read'),
  ('notes','lawsuits','read'),
  ('notes','lawsuits','write'),
  ('cases','conflict','read'),
  ('clients','conflict','read'),
  ('notes','conflict','read'),
  ('poas','conflict','read'),
  ('sessions','conflict','read'),
  ('events','calculators','read'),
  ('events','calculators','write'),
  ('ld_cases','calculators','write'),
  ('cases','deadlines','read'),
  ('ld_cases','deadlines','read'),
  ('ld_checklist','deadlines','read'),
  ('ld_cases','deadlines','write'),
  ('ld_checklist','deadlines','write'),
  ('attachments','settings','read'),
  ('bailiffs','settings','read'),
  ('cases','settings','read'),
  ('clients','settings','read'),
  ('docs','settings','read'),
  ('events','settings','read'),
  ('invoices','settings','read'),
  ('ld_cases','settings','read'),
  ('ld_checklist','settings','read'),
  ('notes','settings','read'),
  ('poas','settings','read'),
  ('sessions','settings','read'),
  ('tasks','settings','read'),
  ('attachments','settings','write'),
  ('bailiffs','settings','write'),
  ('cases','settings','write'),
  ('clients','settings','write'),
  ('docs','settings','write'),
  ('events','settings','write'),
  ('invoices','settings','write'),
  ('ld_cases','settings','write'),
  ('ld_checklist','settings','write'),
  ('notes','settings','write'),
  ('poas','settings','write'),
  ('sessions','settings','write'),
  ('tasks','settings','write');

-- ---------- 2) دوال الصلاحيات ----------
-- هل يستطيع المستخدم الحالي قراءة/كتابة هذه المجموعة؟
create or replace function public.mk_can(c text, w boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_perms jsonb;
begin
  select role, coalesce(permissions, '[]'::jsonb) into v_role, v_perms
    from public.profiles where user_id = auth.uid() and active;
  if v_role is null or v_role = 'owner' then return false; end if;      -- المالك لا يصل لبيانات المكاتب
  if v_role = 'manager' then return true; end if;
  if c = '_meta' then                                                    -- ملف المكتب وتصنيفات المستندات
    if not w then return true; end if;
    return v_role = 'lawyer' and (jsonb_exists(v_perms, 'settings') or jsonb_exists(v_perms, 'documents'));
  end if;
  if c in ('fin_entries', 'workdays') then return v_role = 'lawyer'; end if;  -- + فلترة الصفوف في mk_row_ok
  if v_role = 'client' and w then return false; end if;
  return exists (
    select 1 from public.collection_modules m
    where m.collection = c
      and ( (not w and m.mode in ('read','write')) or (w and m.mode = 'write') )
      and ( jsonb_exists(v_perms, m.module)
            or (m.module = 'bailiffs' and jsonb_exists(v_perms, 'tasks')) )
  );
end $$;

-- المحامي يرى/يكتب قيوده المالية وأيام عمله فقط
create or replace function public.mk_row_ok(c text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mk_role() is distinct from 'lawyer' then true
    when c = 'fin_entries' then (d->>'lawyerId') = auth.uid()::text or (d->>'createdById') = auth.uid()::text
    when c = 'workdays'    then (d->>'lawyerId') = auth.uid()::text
    else true
  end
$$;

-- صلاحياتي (يستعملها التطبيق لمنع التعديل غير المسموح مبكرًا)
create or replace function public.my_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c text; r jsonb := '[]'::jsonb; w jsonb := '[]'::jsonb;
begin
  foreach c in array array['attachments','bailiffs','cases','clients','docs','events','fin_entries','invoices',
                           'ld_cases','ld_checklist','notes','poas','sessions','tasks','workdays','_meta'] loop
    if public.mk_can(c, false) then r := r || to_jsonb(c); end if;
    if public.mk_can(c, true)  then w := w || to_jsonb(c); end if;
  end loop;
  return jsonb_build_object('role', public.mk_role(), 'read', r, 'write', w);
end $$;

-- ---------- 3) سياسات records ----------
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
using (
  office_id = public.mk_office_id()
  and public.mk_office_readable(office_id)
  and public.mk_can(collection, false)
  and public.mk_row_ok(collection, data)
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
  and public.mk_can(collection, true)
  and public.mk_row_ok(collection, data)
);

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
using (
  office_id = public.mk_office_id()
  and public.mk_office_writable(office_id)
  and public.mk_role() in ('manager','lawyer')
  and public.mk_can(collection, true)
  and public.mk_row_ok(collection, data)
)
with check (
  office_id = public.mk_office_id()
  and public.mk_office_writable(office_id)
  and public.mk_role() in ('manager','lawyer')
  and public.mk_can(collection, true)
  and public.mk_row_ok(collection, data)
);

-- ---------- 4) صلاحيات التنفيذ ----------
revoke execute on function public.mk_can(text, boolean), public.mk_row_ok(text, jsonb), public.my_permissions() from public, anon;
grant  execute on function public.mk_can(text, boolean), public.mk_row_ok(text, jsonb), public.my_permissions() to authenticated;

-- للتحقق: عدد قواعد الربط
select module, mode, count(*) from public.collection_modules group by 1,2 order by 1,2;
