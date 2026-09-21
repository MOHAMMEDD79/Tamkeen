# ADR-011 — تثبيت بيئة تأسيس تمكين

التاريخ: 2026-09-15. الحالة: مقبول للتطوير المحلي؛ لا اعتماد تشغيل مالي.

## الواقع الذي فُحص

المجلد احتوى حزمة التخطيط فقط. لا AGENTS.md موروث موجود وقت بدء التأسيس. Node 24.19.0 وpnpm 11.19.0 متاحان؛ Docker وpsql غير متاحين على PATH، ولم يوجد تثبيت PostgreSQL داخل Program Files. أنشئ Git repository على main دون commit أو remote.

## الإصدارات المثبتة

| مكوّن | إصدار |
|---|---|
| Node.js | 24.19.0 |
| pnpm | 11.19.0 |
| Next.js | 16.3.5 |
| React / React DOM | 19.3.0 |
| NestJS common/core/platform-express | 12.0.2 |
| Prisma/client/adapter-pg | 7.10.0 |
| TypeScript | 5.9.3 |
| ESLint | 10.10.0 |
| typescript-eslint | 8.70.0 |
| tsx | 4.23.13 |
| PostgreSQL binary via embedded-postgres | 18.4 عبر helper 18.4.0-beta.17 |

الإصدارات قُرئت من npm وثُبتت في manifests وpnpm-lock.yaml. TypeScript 5.9.3 اختير لأن typescript-eslint 8.70.0 يعلن peer `<6.1.0`؛ لذلك لم نستخدم TypeScript 7 الحالي. ESLint 9 عُدل إلى 10 بعد إعلان npm انتهاء دعمه. NestJS 12 يستهلك ESM، فالمستودع NodeNext/ESM، مع decorators في API و@Inject صريح ليعمل أيضًا في مراقبة tsx.

## قاعدة البيانات

PostgreSQL فعلية عبر helper تطوير محمول؛ إصدار الحزمة يحمل beta ولذلك نطاقه تطوير محلي فقط. البيانات محفوظة داخل المشروع، والمنفذ loopback 55432، والتوثيق SCRAM، والأسرار مولدة. لم تثبت خدمة نظام أو تنشأ هوية نظام جديدة. أضيف بديل Docker غير مختبر على هذا الجهاز.

Prisma 7 يستخدم generator prisma-client بمخرجات TypeScript وadapter-pg. SQL migrations هي التغيير الدائم، لا db push. أول migration ينشئ runtime_metadata وworker_heartbeats فقط؛ لا نقرر كيانات الهوية قبل PART-02.

## التحقق والتشغيل

حياة API مستقلة عن القاعدة؛ الجاهزية تتطلب سجل إصدار schema الفعلي. worker يسجل heartbeat ولا يعلن وجود queue processor غير منفذ. إعدادات المال والبريد الخارجي ممنوعة في foundation mode في جميع البيئات حتى تطبيق adapters وقرارات إطلاق لاحقة.

S3/Redis queues وUI components وAPI contracts للأعمال تؤجل إلى أول شريحة تستخدمها؛ لم ننشئ حزمًا فارغة توحي بوجود وظائف. هذه مواءمة لحد PART-01، لا حذف من الخطة.

## مصادر

- [Next installation](https://nextjs.org/docs/app/getting-started/installation) ووثائق الإصدار المثبت داخل apps/web/node_modules/next/dist/docs.
- [Nest migration guide](https://docs.nestjs.com/migration-guide).
- [Prisma Client setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction).
- [embedded-postgres repository](https://github.com/leinelissen/embedded-postgres) وREADME الحزمة المثبتة.
- peerDependencies داخل node_modules/typescript-eslint/package.json؛ lockfile مصدر الإصدارات الفعلية.

## تعليمات Next المولدة

Next dev أنشأ apps/web/AGENTS.md وCLAUDE.md. حُفظا كما هما وقرئت التعليمات. يجب في المراحل اللاحقة مراجعة الوثائق المحلية للإصدار قبل تعديل الواجهة، لأن Next 16.3 قد يختلف عن أمثلة الإصدارات السابقة.
