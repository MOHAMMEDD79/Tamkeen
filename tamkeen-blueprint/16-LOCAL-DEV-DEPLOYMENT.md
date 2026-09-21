# 16 — التشغيل المحلي والنشر

## Local profile

PART-01 يكتشف Node/package manager/Docker المتاحين على Windows ثم يثبت تشغيلًا متكررًا. الهدف docker compose لخدمات PostgreSQL وRedis وS3-compatible storage وMailpit، وتشغيل web/api/worker عبر workspace scripts. إذا Docker غير متاح وثق البديل ولا تثبت خدمات نظام بلا داعٍ.

Scripts مستهدفة بعد إنشائها فعلًا: `dev`, `build`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `db:migrate`, `db:seed`, `demo:reset`. لا تدعي أن هذه الأوامر متاحة قبل تنفيذ scaffold.

## Environment contract

`.env.example` أسماء دون أسرار: APP_ENV, APP_BASE_URL, API_BASE_URL, DATABASE_URL, REDIS_URL, STORAGE_ENDPOINT/BUCKET, SESSION_SECRET, PAYMENT_MODE=simulator, EMAIL_MODE=mailpit, MONEY_ENABLED=false, INVESTMENT_ENABLED=false, MAP_PROVIDER, DEFAULT_LOCALE=ar, DEFAULT_CURRENCY=ILS. التحقق من env عند startup يفشل بوضوح إذا خلطت simulator مع مفاتيح production.

`demo:reset` مسموح لقاعدة بيانات اسمها/بيئتها demo فقط، مع guard يمنع prod. seed idempotent ببيانات مصطنعة. لا أسماء أو هويات أو حسابات بنك حقيقية في المستودع.

## CI

install frozen lockfile → lint/types → unit → DB migrations على قاعدة مؤقتة → integration → build → critical E2E. لا نشر إذا فشل gate. secrets من secret store، logs منقحة، dependency/security checks بإصدارات أدوات مثبتة. فحص OpenAPI client drift ضمن CI.

## نشر تدريجي

staging له مزود sandbox وبيانات اختبار؛ production مفصول حسابات ومفاتيح وتخزينًا وقاعدةً. rollback للكود لا يعني عكس migration مدمرة؛ expand/migrate/contract مع نافذة توافق. flags per module توقف كتابة مالية مع إبقاء الاستعلام والتسوية ومعالجة webhooks محفوظة.

## Observability

structured logs مع requestId/correlationId بدون PII، metrics للـlatency وerrors وqueue age وwebhook lag وunreconciled balances وfailed notifications، tracing بين API/worker، health/live وready لا يكشفان أسرارًا. تنبيه لكل فرق تسوية غير محسوم أو payout unknown؛ لا تسيل الرسائل مع كل retry.

## Backup / restore

نسخ DB مشفرة وpoint-in-time عند توفره ونسخ metadata للمستندات مع object versioning. حدد RPO/RTO عند اختيار الاستضافة؛ استهدف مبدئيًا RPO ساعة وRTO أربع ساعات كهدف اختبار غير مضمون. قبل الإطلاق نفذ restore إلى بيئة معزولة وافحص ledger ومراجع الملفات ونسخ العقود. سجل الأدلة والوقت الفعلي.

## قائمة إطلاق تقنية

domain/TLS، env isolation، migration rehearsed، backup restore tested، permissions audited، payment sandbox E2E، provider webhooks and reconciliation verified، ownership of incidents، privacy/public projection check، source fees/custody documented، money flag default off حتى اكتمال متطلبات التشغيل المعنية.
