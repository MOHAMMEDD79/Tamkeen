# PART-13 — سجل التنفيذ الجاري

الحالة: **LOCAL_VERIFIED**.

## الشريحة الأولى: الدعم والإشعارات والتدقيق والتجميد

- migration `202609230001_support_notifications_operations` يضيف تذاكر خاصة، وردودًا append-only، وإشعارات داخلية مع outbox وdedup key، وسجل تجميد محدد النطاق.
- التذكرة لا تغيّر حقًا ماليًا؛ الإغلاق يحتاج resolution code وشرحًا، وإعادة الفتح تضيف سببًا إلى التاريخ بدل محوه.
- claim ذري بالنسخة والمسؤول الفارغ. القراءة للمشارك أو Support/Risk/PlatformAdmin فقط، والملاحظات الداخلية لا تُعاد للمستخدم.
- `safe_path` في الإشعار يقبل مسارًا داخليًا فقط. فشل قناة التسليم منفصل عن نجاح domain event.
- التجميد يذكر `collect` أو `payout` أو `publish`. لا يوجد تجميدان نشطان للنطاق نفسه، ومن جمّد لا يفك تجميده بنفسه.
- قراءة التدقيق مقيدة بـAuditor/PlatformAdmin وتعيد DTO منقحًا، لا payloads أو أسرارًا.
- وُثقت المسارات التشغيلية في OpenAPI، وأضيفت شاشات PER-19/PER-20 وADM-07/08. شاشة موظف الدعم تفتح سجل التذكرة وتنفذ claim والتصعيد والرد والحل مع optimistic version.
- migration `202609230002_follows_notification_delivery` يضيف متابعة فريدة للمشروع/الجهة. صفحات الجمهور ترسل المتابعة بالـslug العام دون كشف معرف داخلي.
- fan-out يستخدم dedup key من event + recipient + template version. worker يطالب رسالة واحدة ذريًا، ويطبق exponential backoff، وينقلها إلى `dead_letter` بعد خمس محاولات؛ فشل القناة لا يعكس domain event.

## الأدلة الفعلية

- `pnpm db:migrate`: نجح وطبق migration على PostgreSQL المحلية.
- `pnpm --filter @tamkeen/database build`: نجح وولّد Prisma Client.
- `pnpm --filter @tamkeen/api build`: نجح.
- `pnpm --filter @tamkeen/contracts build`: نجح بعد إضافة عقد OpenAPI للشريحة.
- `pnpm --filter @tamkeen/web build`: نجح، بما فيه مسارات الإشعارات والدعم والتدقيق وإدارة التذكرة.
- `pnpm lint`: نجح.
- `pnpm test`: نجح 71/71. أضيف shim محلي خاص بـWindows لأن `tsx` كان يفشل قبل الاختبارات عند `uv_os_get_passwd ENOMEM`؛ لا يغير shim سلوك المنصات الأخرى.
- `pnpm test:integration`: نجح 18/18 على PostgreSQL الفعلية. يغطي `tests/operations.integration.test.ts` العزل وسباق claim والتاريخ append-only وملكية الإشعار وقراءة حدث التدقيق المنقح وفصل صانع/مزيل التجميد.
- اختبار PART-13 يغطي كذلك idempotency للمتابعة وfan-out المكرر وملكية الإلغاء وخمس محاولات فاشلة تنتهي في dead-letter.

## الشرائح المكتملة بعد الأساس

- ADM-01: قائمة مهام المراجعة وإعادة الإسناد مع MFA وفحص تعارض النسخة.
- ADM-09: مراقبة worker وoutbox وexports والحوادث، retry للعمل غير المالي فقط، وتمارين استعادة موثقة وطلبات تغيير feature flags.
- SUP-04/05: تقارير أثر عامة بلقطات غير قابلة للتعديل ومرشحات الجهة والعملات، وexport jobs منتهية الصلاحية قابلة للإلغاء وإعادة التوليد مع إعادة فحص الصلاحية.
- exports: مساهمات واستثمارات شخصية، مساهمات ودفتر جهة، سجل تخصيص، وطلبات برامج. المخرجات تحمي خلايا CSV من `= + - @`، وتحجب PII والملاحظات الداخلية حسب السياق.
- بيانات الحساب: MFA challenge مخصص، استهلاك مرة واحدة، ولا إعادة توليد دون MFA جديد.
- receipts/proofs والسياسات: إيصالات مساهمة خاصة، إثبات تخصيص خاص، وأرشيف نسخ سياسة عامة ثابتة.
- DOC-01: ملفات التوثيق وغرفة البيانات تدخل quarantine بحجم مطابق، وتفحص magic bytes والمحتوى النشط وتُحسب SHA-256 قبل promotion. تنزيل غرفة البيانات يعيد اشتقاق التصنيف والمنحة/NDA ويسجل `DataRoomDownload`.

## البوابة البصرية

- فُحصت `/ar/impact` في المتصفح الفعلي على سطح المكتب وعلى viewport هاتف `390×844`.
- أضيف `viewport=device-width, initial-scale=1`. القياس الفعلي: `innerWidth=390`, `clientWidth=390`, `scrollWidth=390`، وحاوية المحتوى من `x=16` بعرض `358.4`؛ لا فائض أفقي.
- اتجاه الصفحة `rtl`، وترتيب الرأس والبطاقات والجداول والرسائل صحيح. لم يُشغّل قارئ شاشة، لذلك لا يوجد ادعاء بفحص قارئ شاشة.

## أدلة الإغلاق

- migration `202609230006_dataroom_file_storage` طُبقت على PostgreSQL المحلية، مع migrations الإشعارات والتفضيلات السابقة.
- `pnpm test`: 72/72، ويتضمن فحص تخزين غرفة البيانات وترقية الملف النظيف وقراءة البايتات المطابقة.
- `pnpm test:integration`: 18/18 على PostgreSQL فعلية، بما فيها العزل والمال وOpenAPI وعمليات PART-13.
- `pnpm build`: نجح لكل حزم workspace.
- `pnpm lint`: نجح.

## حدود لا تُخفى

- لا مزود دفع أو بريد خارجي أو أموال حقيقية؛ unknown financial outcomes تُحسم بالاستعلام ولا تُعاد عميانًا.
- لا صلاحيات wildcard ولا قرار AI آلي.
- account closure لا ينفذ حذفًا أعمى مع وجود التزامات، وbrowser geolocation يحتاج قرار منتج/خصوصية؛ كلاهما خارج قبول PART-13 التشغيلي.
