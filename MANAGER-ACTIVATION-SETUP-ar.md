# تفعيل حساب مدير المكتب برمز خادمي

جهّزت `supabase/functions/manager-activation` وملف الترحيل `supabase-migration-11-manager-activation.sql` وتعديل واجهة التسجيل في `mk-cloud.js`.

## ما يفعله المسار

- يولّد الخادم رمزًا عشوائيًا من 6 أرقام، ويحفظ بصمته فقط؛ لا يظهر الرمز في المتصفح أو استجابة الدالة.
- صلاحية الرمز 10 دقائق، وبحد أقصى 8 محاولات و3 طلبات لكل حساب خلال 15 دقيقة.
- يرسل البريد عبر API HTTPS لمزوّد بريد، أو WhatsApp Cloud API باستخدام قالب مصادقة معتمد.
- لا يُفعّل ملف المدير إلا بعد تحقق الخادم من الرمز؛ ويستهلك الرمز مرة واحدة.
- يزيل التعديل الأكواد القديمة المولّدة في المتصفح من التخزين المحلي.
- الترحيل لا يغيّر الحسابات الحالية أو دالة `manager-recovery`؛ لكنه يجعل ملفات المديرين الجدد التي تُنشأ ذاتيًا غير نشطة حتى التحقق. حالة هذا المشروع: الترحيل شُغّل على الإنتاج وتأكد وجود الجداول والدوال؛ لا تعِد تشغيله لمجرد اتباع هذا الدليل.

## إعداد Gmail / Supabase Auth

إذا كان المقصود رسائل Supabase Auth نفسها (تأكيد البريد عند التسجيل، OTP أو magic link من Supabase Auth، الاستعادة والدعوات)، فإعدادات Gmail الدقيقة هي:

- SMTP host: `smtp.gmail.com`
- Port `465` مع SSL/TLS الضمني، أو `587` مع STARTTLS
- Username: `alih303200@gmail.com`
- Password: كلمة مرور التطبيق المحفوظة في Wallet؛ لا تنسخها إلى الكود أو المحادثة
- Sender email: `alih303200@gmail.com` (ويفضّل أن يطابق اسم المرسل هذا الحساب)
- في Supabase Dashboard: Authentication → SMTP Settings / Enable Custom SMTP، ثم أدخل القيم أعلاه واحفظ. إعداد Gmail SMTP حُفظ لـSupabase Auth؛ هذا لا يرسل أكواد التفعيل المخصصة في Maktaby.

لكن هذا ليس البريد الخاص برمز التفعيل الذي يبنيه Maktaby: التطبيق يسجّل المستخدم داخليًا بعنوان `username@maktaby.app`، وبريد التواصل المراد التحقق منه قيمة مستقلة. مسار التفعيل يرسل الرمز من Edge Function مباشرة عبر Gmail API HTTPS. لذلك SMTP المحفوظ في Supabase Auth لا يرسل هذا الرمز، وكلمة مرور Gmail أو كلمة مرور التطبيق لا تُستخدم في هذا التكامل. لم أرسل رسالة اختبار ولم أغيّر إعدادات الإنتاج.

## إعداد Gmail API للبريد المخصص لرمز التفعيل

التعديل المحلي يستخدم OAuth 2.0 لتجديد access token قصير العمر عند الحاجة، ثم Gmail API `users.messages.send` بنطاق `https://www.googleapis.com/auth/gmail.send`. لا يستخدم رموز Gmail المتصلة بـWabi أو إعداد SMTP، ولا يسجّل الأسرار أو رمز OTP في السجلات. جهّز الحساب الذي سيظهر كمرسل؛ يجب أن يطابق `ACTIVATION_GMAIL_FROM` الحساب الذي منحه OAuth الموافقة (أو عنوان إرسال بديل موثّق ومسموح به في Gmail).

خطوات المالك:

1. في Google Cloud Console، أنشئ/اختر مشروعًا وفعّل Gmail API.
2. أعد شاشة OAuth consent باسم واضح، وأضف حساب المرسل كمستخدم اختبار إن كانت الشاشة في وضع Testing. أنشئ OAuth Client ID واحتفظ بـClient ID وClient Secret داخل إعداد آمن؛ لا تضعهما في GitHub أو المحادثة.
3. أنشئ موافقة OAuth للحساب نفسه، بنطاق `https://www.googleapis.com/auth/gmail.send` وطلب وصول offline، ثم استخرج refresh token. يمكن استخدام OAuth Playground مع خيار استخدام بيانات OAuth الخاصة بك؛ إن اخترته، أضف `https://developers.google.com/oauthplayground` كـredirect URI لعميل Web، واطلب النطاق أعلاه ثم بدّل authorization code إلى tokens. لا تشارك access token أو refresh token هنا. لا تستخدم أسرار اتصال Gmail الخاص بـWabi.
4. في Supabase Dashboard للمشروع الصحيح، افتح Edge Functions → Secrets، وأضف الأسماء التالية كقيم منفصلة:
   - `ACTIVATION_GMAIL_CLIENT_ID` — OAuth Client ID.
   - `ACTIVATION_GMAIL_CLIENT_SECRET` — OAuth Client Secret.
   - `ACTIVATION_GMAIL_REFRESH_TOKEN` — refresh token للحساب المخوّل.
   - `ACTIVATION_GMAIL_FROM` — عنوان Gmail نفسه، مثل `alih303200@gmail.com` إذا كان هو الحساب الذي وافق على OAuth.
   - أبقِ `ACTIVATION_CODE_PEPPER` الحالي مضبوطًا؛ الدالة تحتاجه لحماية بصمة الرمز.
5. قبل الاستخدام الفعلي، تأكد من وضع شاشة OAuth وسياسة Google للنطاق الحساس `gmail.send`: شاشة Testing قد تفرض قيودًا أو انتهاءً لرمز refresh؛ للإنتاج قد يلزم إكمال نشر/تحقق التطبيق حسب حالة المشروع. لا تعتبر حفظ الأسرار وحده اختبارًا ناجحًا.
6. بعد مراجعة التغيير، انشر Edge Function والواجهة في خطوة منفصلة، ثم اختبر بحساب تجريبي وبإذن المالك. هذا التعديل محلي فقط؛ لم أنشره أو أرسل رسالة حقيقية.

إذا أُلغي refresh token أو تعذر تجديده، يلزم إصدار موافقة offline جديدة وتحديث secret. لا تُرسل أي قيمة سرية إلى Wabi.

## إعداد WhatsApp Cloud API

الدالة المعدّة تستدعي Graph API باستخدام `PHONE_NUMBER_ID` وAccess Token محفوظين في Edge Function secrets؛ لا تُسجّل رقمًا ولا تغيّر WhatsApp Business assets. تحتاج:

- `ACTIVATION_META_ACCESS_TOKEN`
- `ACTIVATION_META_PHONE_NUMBER_ID`
- `ACTIVATION_META_TEMPLATE_NAME`
- `ACTIVATION_META_TEMPLATE_LANGUAGE` (مطابق للغة القالب المعتمد)
- اختياريًا `ACTIVATION_META_GRAPH_VERSION` (الافتراضي في الكود `v23.0`)

خطوات اختبار Meta الرسمية قبل ربط رقم حقيقي:

1. من Meta for Developers أنشئ/افتح تطبيقًا باختيار WhatsApp، واربطه بملف الأعمال أو أنشئ ملفًا للاختبار.
2. في WhatsApp → API Setup استخدم رقم الإرسال التجريبي الذي توفره Meta، ثم Generate access token المؤقت.
3. في خانة To أضف رقمًا مستلمًا تملكه، اطلب رمز التحقق، وأكمل تأكيده؛ Meta تتيح حتى 5 أرقام مستلمة للاختبار. هذا الرقم المستلم ليس رقم الإرسال.
4. جرّب أولًا قالب Meta التجريبي `hello_world`. لاختبار OTP المخصص، استخدم قالب AUTHENTICATION معتمدًا (نسخة Copy Code) ثم ضع قيمته وPhone Number ID والرمز المؤقت كـ secrets فقط بعد الحصول عليها. أسرار/رمز الاختبار المؤقت لا يصلحان للإنتاج.

الرقم `01098848735` حدده المالك كرقم الإرسال التجاري، وليس رقمًا مستلمًا اختباريًا. اختبار Meta المجاني يستخدم رقم إرسال تجريبيًا صادرًا من Meta؛ لذلك لا أستخدم هذا الرقم في الاختبار ولا أسجّله. ربطه كمرسل حقيقي لاحقًا يتطلب خطوات تسجيل وتحقق منفصلة. Meta تقول إن رقمًا مستخدمًا حاليًا في WhatsApp Messenger أو WhatsApp Business لا يمكن تسجيله للـCloud API إلا بعد حذفه أولًا من التطبيق؛ لو ظهر مثل هذا الشرط، يجب التوقف وطلب قرار المالك لأن ذلك قد يقطع الاستخدام الحالي. لم أفحص حالة الرقم أو أبدأ التسجيل.

لتفعيل الإرسال التجاري بعد الاختبار يلزم WhatsApp Business Account، رقم هاتف متحقق ومسجّل دون تجاوز أي قيود Meta، token/permissions مناسبة، وقالب AUTHENTICATION معتمد. القالب والاسم واللغة يجب أن تطابق بيانات Meta الفعلية. لم أتحقق من حساب Meta أو حالة الرقم/القالب.

## الترتيب اللازم قبل اختبار التدفق

1. ترحيل `supabase-migration-11-manager-activation.sql` موجود على الإنتاج، وقد تأكد وجود جداول ودوال التفعيل. لا تعِد تشغيله. التغيير يجعل المديرين الجدد غير نشطين قبل التحقق، ولا يمسّ المديرين الحاليين أو `manager-recovery`.
2. جهّز مزوّد البريد أو Meta، والقالب والرقم المسموح، ثم أضف أسرار قناة الإرسال إلى Edge Functions. لم أغيّر أسرار Supabase.
3. بعد حفظ الأسرار ومراجعة الكود، انشر دالة `manager-activation` من جذر المشروع بالأمر `supabase functions deploy manager-activation`، ثم انشر واجهة `mk-cloud.js` المعدّلة في الإصدار نفسه. الملفات جاهزة محليًا فقط ولم تُنشر من هذا العمل؛ لا تعِد تشغيل ترحيل قاعدة البيانات.
4. اختبر على حساب تجريبي فقط. التدفق غير مختبر end-to-end؛ يلزم إعداد Meta والقالب المعتمد، ثم نشر الوظيفة والواجهة واختبار الاستلام. لم يُسجّل رقم المالك ولم يُرسل رمز WhatsApp.
