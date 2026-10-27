-- يضمن التنفيذ بدور postgres حتى لو كان المحرر مضبوطًا على دور آخر
reset role;

-- فحص حساب المالك: يجب أن يظهر صف واحد، email_confirmed_at غير فارغ، وله دور owner
select u.email, u.email_confirmed_at, p.role
from auth.users u
left join public.profiles p on p.user_id = u.id
where lower(u.email) = 'ali7assansa3id@maktaby.app';

-- لو email_confirmed_at فارغ: فعّل المستخدم
update auth.users set email_confirmed_at = now()
where lower(email) = 'ali7assansa3id@maktaby.app' and email_confirmed_at is null;

-- لو نسيت/أخطأت كلمة المرور: ضع كلمة جديدة (لا تحفظ هذا الاستعلام بعد التنفيذ)
-- update auth.users
--   set encrypted_password = extensions.crypt('ضع_كلمة_المرور_هنا', extensions.gen_salt('bf'))
-- where lower(email) = 'ali7assansa3id@maktaby.app';
