# دليل تشغيل تمكين المحلي

## بدء وإيقاف الخدمات

1. `pnpm db:local` لتشغيل PostgreSQL المحلية الدائمة.
2. `pnpm db:migrate` ثم `pnpm dev` لتشغيل web/api/worker.
3. الجاهزية: `GET http://127.0.0.1:4000/api/v1/health/ready`، والحياة: `/health/live`.
4. أوقف مجموعة الخدمات وPostgreSQL بـCtrl+C في الطرفيتين. لا تقتل ملفات البيانات ولا تحذف `.local/postgres`.

## تهيئة العرض

- `pnpm demo:reset` يعيد قاعدة محلية اسمها يحوي `demo` أو `test` فقط، ويرفض remote/production.
- `pnpm demo:stories` يشغل seed والعمل الخيري والاستثمار والاكتتاب والبرنامج والتوظيف والتمكين بالتتابع. كل المال محاكى.

## فشل worker أو الإشعارات

- domain event يبقى ناجحًا ولو فشل التسليم. راقب `/admin/operations` لحالة outbox وdead-letter وعمر worker.
- retry مسموح للعمل غير المالي فقط. لا تعِد payout أو webhook مالي بنتيجة مجهولة؛ استخدم inquiry/reconciliation.
- خمس محاولات فاشلة تنقل الإشعار إلى dead-letter دون مضاعفة الإشعار المنطقي.

## نتيجة مالية مجهولة

- لا تبدأ محاولة دفع ثانية. ابحث بواسطة provider reference ثم شغّل inquiry.
- افتح incident إذا بقيت النتيجة مجهولة أو ظهر فرق تسوية. لا تغلقه بلا دليل مزود أو reconciliation.

## النسخ والاستعادة

- الهدف قبل الإنتاج: نسخ مشفرة + PITR، object versioning، RPO ساعة وRTO أربع ساعات كهدف اختبار لا ضمان.
- محليًا: `pnpm ops:restore-rehearsal` ينشئ نسخة PostgreSQL معزولة ثم قاعدة استعادة ثانية، ويفحص counts وتوازن كل transaction ومراجع ملفات غرفة البيانات، ثم يحذف قاعدتي التدريب فقط.
- rollback للكود لا يعكس migration مدمرة. استخدم expand/migrate/contract ونافذة توافق.

## تحقق الإصدار

`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm demo:stories`, `pnpm ops:restore-rehearsal`.

## ملكية الحوادث

- Support: التذاكر والاتصال بالمستخدم.
- Operations: queues وworker وrestore وfeature flags.
- Finance: reconciliation والنتائج المالية المجهولة.
- Risk/Review: قرارات الأهلية والمحتوى والتوثيق؛ لا قرار AI آلي.
