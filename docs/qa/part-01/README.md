# PART-01 — أدلة التحقق المحلي

التاريخ: 2026-09-15. النتيجة: **LOCAL_VERIFIED** على Windows x64، Node 24.19.0 وpnpm 11.19.0.

## الأوامر والنتائج الفعلية

| الأمر/الفحص | النتيجة |
|---|---|
| pnpm install --frozen-lockfile | نجح؛ lockfile مطابق للإصدارات المثبتة |
| pnpm setup | أنشأ .env بأسرار محلية عشوائية دون طباعة القيم |
| pnpm db:local | PostgreSQL فعلية جاهزة على loopback 55432 |
| pnpm db:migrate | طبق 202609150001_foundation بنجاح |
| pnpm db:seed | نجح؛ seed_profile فقط دون حسابات أو أموال |
| pnpm lint | نجح |
| pnpm typecheck | نجح للحزم والتطبيقات الخمسة |
| pnpm test | 5 ناجحة، 0 فاشلة، 0 متخطاة |
| pnpm build | Next production build + config/database/API/worker نجحت |
| pnpm test:integration | 1 ناجح متعدد التحققات، 0 فاشل، 0 متخطى |
| pnpm dev | web/api/worker بدأت؛ API listening وworker heartbeat |
| قراءة worker_heartbeats | سجل موجود وعمره 7862ms عند الفحص، ضمن دورة 10000ms |

آخر فحص تجميعي: `pnpm check` ثم `pnpm test:integration` أعادا exit code 0 بعد إصلاح جميع الأعطال أدناه.

## ما تختبره الاختبارات

الـunit tests: قبول إعداد محلي صالح؛ منع live payment/email ومفاتيح مزود؛ منع قاعدة بعيدة أو مسماة إنتاجًا في demo؛ رفض flags/ports/secrets غير صالحة؛ عدم كشف الأسرار برسائل الأخطاء.

الـintegration: قراءة marker الفعلي من PostgreSQL بعد migration؛ تشغيل Nest على منفذ مؤقت؛ live=200؛ ready=200 مع schema صحيحة؛ endpoint غير موجود=404؛ تطبيق ثانٍ يشير لاسم قاعدة غير موجود يعيد ready=503 مع بقاء live=200؛ الاستجابة لا تحتوي كلمة مرور أو تفاصيل Prisma. يُغلق التطبيق والاتصال بعد الاختبار.

## الفحص البصري الفعلي

فُتحت http://127.0.0.1:3000 في متصفح Codex، وظهرت رسالة «الخادم وقاعدة البيانات متصلان وجاهزان». عوينت لقطة سطح المكتب ثم لقطة viewport 360×800. لا قطع للنص أو تمدد أفقي؛ document lang=ar وdir=rtl، scrollWidth=345 وinnerWidth=360. أعيد viewport الافتراضي بعد الفحص. اللقطات عُرضت في جلسة العمل ولم تُحفظ كملفات في المستودع.

لا توجد عناصر أعمال قابلة للنقر في هذه الشاشة؛ النص يوضح أنها صفحة تقنية مؤقتة. فحص نموذج لوحة مفاتيح وaccessibility شامل مؤجل لواجهات PART-02/03، ولا يُدعى اجتياز WCAG من هذه المعاينة.

## أعطال ظهرت وتمت معالجتها

1. سجل npm محجوب داخل العزل: اكتمل تنزيل المكتبات بإذن التنفيذ الموسع.
2. pnpm 11 طلب allowBuilds صريحة: ضُبطت للحزم اللازمة Prisma/esbuild/PostgreSQL؛ لا سماح عام لكل scripts.
3. مكتبة PostgreSQL وtsx فشلتا بقراءة معلومات مستخدم Windows داخل العزل؛ تشغيلهما خارج العزل المصرح نجح. ليس نقص RAM فعليًا مثبتًا رغم نص ENOMEM.
4. اختبار integration استورد reflect-metadata من الجذر رغم وجوده في API فقط؛ أزيل الاستيراد الزائد وبقي استيراد API الصحيح.
5. تعديل manifest تطلّب مزامنة modules مع lockfile؛ install --frozen-lockfile نجح ثم أعيد الفحص.
6. أضيف lifecycle hook لإغلاق اتصال DB مع إغلاق Nest، وidle timeout قصير للحوض؛ الاختبار النهائي ينتهي بنحو ثانية.

## غير مختبر/غير منفذ

CI على GitHub، Docker services، Redis jobs، S3، money adapters، auth/RBAC، business journeys، استعادة backup، نشر إنتاجي. يوجد workflow CI وإعداد Docker كمخرجات تأسيس فقط، ولا يعني وجودهما أنهما شُغلا.

## الاستئناف

ابدأ [PART-02](../../../tamkeen-blueprint/parts/PART-02.md) بعد قراءة السجل. أبقِ قاعدة البيانات والـenv الموجودين، وأنشئ migrations جديدة للهوية. لا تعدّل migration مطبقة لإضافة كيانات مستقبلية.
