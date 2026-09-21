# مصفوفة تتبع المتطلبات

الأساس التقني ونظام التصميم والسطح العام والمشاريع والمال المحاكى والاستثمار والبرامج والتوظيف والتمكين والتشغيل وبوابة التسليم متحققة محليًا. الهوية ما زالت قيد التنفيذ بسبب بوابتها المحمية المستقلة وفق سجل الأفعال المرتبط أدناه. لا تعني التغطية المحلية جاهزية إنتاجية أو اكتمال التكاملات الخارجية.

**المال محاكى بالكامل**: الدفتر والمساهمات تعمل على مسار دفع محاكٍ، ولا يوجد مزود دفع ولا أموال حقيقية. كل صف «منفذ» أدناه يخص المال يعني «منفذ محليًا باستخدام محاكٍ».

سجل الأفعال التفصيلي لكل معرّف إجراء في [`packages/contracts/src/actions.ts`](../packages/contracts/src/actions.ts)، ويفرض اختباره أن كل فعل منفذ يذكر ملف اختبار موجود وأن كل فعل غير منفذ يذكر سببًا وجزءًا مالكًا.

| Requirement | المصدر | المرحلة | اختبارات القبول | التنفيذ |
|---|---|---|---|---|
| REQ-FOUNDATION | 10 و16 وPART-01 | 01 | config tests + real PostgreSQL integration + build/types/lint | LOCAL_VERIFIED — [أدلة](../docs/qa/part-01/README.md) |
| REQ-IDENTITY | 02 | 02 | AUTH-01/02/03 | IN_PROGRESS — [تفاصيل الأفعال والكود والاختبارات](IDENTITY-IMPLEMENTATION.md) |
| REQ-DESIGN-70-20-10 | 03 و20 | 03 وجميع واجهات المراحل | RTL/mobile/keyboard | LOCAL_VERIFIED — [النظام والأدلة](../docs/qa/part-03/README.md)؛ التباين مقيس آليًا والفحص البصري ولوحة المفاتيح أُجريا؛ قارئ الشاشة لم يُشغَّل |
| REQ-PUBLIC-MAP | 04 + screens public | 04 | projection privacy/filter navigation | LOCAL_VERIFIED — [أدلة](../docs/qa/part-04/README.md)؛ الخريطة التفاعلية معلنة غير مفعّلة والقائمة تحمل النتائج نفسها |
| REQ-CHARITY-LOOP | 05 و22 | 05–07 | CH-01/02 + FIN | LOCAL_VERIFIED — [05](../docs/qa/part-05/README.md) الخطة والمراجعة والنشر، و[06](../docs/qa/part-06/README.md) المساهمات، و[07](../docs/qa/part-07/README.md) الصرف والاسترداد والتسوية. حلقة LOOP-CH أُجريت كاملة عبر HTTP بجلسات فعلية؛ وبوابة 07 البصرية أُجريت |
| REQ-ANONYMITY | 05 و12 | 06 | PRIV-01 | LOCAL_VERIFIED — [PART-06](../docs/qa/part-06/README.md): الاسم والمبلغ خياران منفصلان، والإسقاط العام يُبنى حقلًا حقلًا، والتغيير يسري فورًا — مفحوص في المتصفح وفي التكامل |
| REQ-LEDGER | 08 | 06–07 | FIN-01..06 | LOCAL_VERIFIED — **FIN-01..06 كلها مفحوصة على PostgreSQL فعلية**: [06](../docs/qa/part-06/README.md) لـ01/02/06، و[07](../docs/qa/part-07/README.md) لـ03/04/05 مع المثال العددي في 08 كاملًا. المتبقي جدولة التسوية والانتهاء التلقائي للحجوزات، وهي مهام خلفية في 13 |
| REQ-INVESTMENT | 06 و22 | 08–09 | INV-01..04 | LOCAL_VERIFIED — [PART-08](../docs/qa/part-08/README.md) للشركة والعرض والإفصاح المرقّم والمراجعة المستقلة والأهلية وغرف البيانات وحساب الأسهم، و[PART-09](../docs/qa/part-09/README.md) للالتزام وعقد الاكتتاب والدفع في حساب ضمان مستقل والتخصيص المُعتمد والحصص وعلاقات المستثمرين. **INV-01..04 كلها مثبتة على PostgreSQL فعلية.** الحدود المعلنة: لا سجل مساهمين قانوني ولا ملكية ولا تداول ثانوي ولا قناة صرف إلى شخص |
| REQ-INCUBATION | 07 و14 و22 | 10–12 | PRG-01..13، PUB-10/11، PER-10..17 | LOCAL_VERIFIED — البرامج والتدريب والتوظيف والبدلات والشهادات والاحتضان والرعاية مكتملة محليًا عبر [PART-10](../docs/qa/part-10/README.md) و[PART-11](../docs/qa/part-11/README.md) و`tests/enablement.integration.test.ts`؛ المال محاكى |
| REQ-EMPLOYMENT | 07 و14 | 11 | JOB-01/02 | LOCAL_VERIFIED — العرض المقبول ليس بدء عمل، وunknown نتيجة مستقلة مثبتة في `tests/employment.integration.test.ts` |
| REQ-SUPPORT-VOLUNTEER | 02 و13 | 12 | scoped cases/hours | LOCAL_VERIFIED — المساعدة بموافقة قابلة للسحب والتسليم بتأكيد صاحبه، والتطوع بساعات لا يعتمدها صاحبها؛ `tests/enablement.integration.test.ts` |
| REQ-OPERATIONS | 12–16 | 13–14 | OPS-01/02 + DOC-01 | LOCAL_VERIFIED — [PART-13](../docs/qa/part-13/README.md): دعم وإشعارات وretry/dead-letter، audit/freeze، ADM-01/07/08/09، restore drills، exports منقحة وآمنة للـCSV، تقارير أثر بمرشحات وعملات، ومخزن وثائق quarantine/scan/checksum وتنزيل يعيد فحص الوصول ويسجل الحدث. PART-14 يجمع بوابة التسليم الشاملة. |
| REQ-DELIVERY | 15–18 و22 | 14 | build/lint/types + critical E2E + demo stories + restore + RTL/mobile | LOCAL_VERIFIED — [PART-14](../docs/qa/part-14/README.md): 72 unit و18 integration و9 critical E2E، قصص seed كاملة، تمرين استعادة معزول، وبوابات تشغيل وإطلاق؛ الإنتاج والتكاملات الخارجية وPART-02 ليست ضمن هذا الادعاء. |

## قالب action-level

`Action ID | Page route | Permission policy test | API operationId | Service/DB | UI component | E2E/error test | Status`.

لا يغني صف requirement عام عن تغطية أزرار الصفحات. عند إضافة action جديد يحدث السجل هنا أو ملف فرعي مرتبط منه، وتُفحص عدم وجود IDs بلا تنفيذ عند إغلاق المرحلة.

## توزيع الصفحات المساعدة

SUP-01/02 → PART-02. SUP-03 → PART-12. SUP-04/05/08 → PART-13. SUP-06/07 → PART-09. SUP-09 → PART-10. سجلها التفصيلي في [صفحات الدعم](screens/10-SUPPORTING.md).

## تتبع الأساس المنفذ

| المرجع | التنفيذ | الاختبار |
|---|---|---|
| FND-ENV | [config](../packages/config/src/index.ts) | [config.test.ts](../tests/config.test.ts) |
| FND-DB | [schema](../database/schema.prisma)، [migration](../database/migrations/202609150001_foundation/migration.sql) | [integration](../tests/integration.test.ts) |
| FND-HEALTH | [API](../apps/api/src/app.ts) | live 200، ready 200، unavailable 503، body منقح |
| FND-WORKER | [worker](../apps/worker/src/main.ts) | استعلام heartbeat حي في الجلسة؛ ليس اختبار queue بعد |
| FND-WEB | [الصفحة الرئيسية](../apps/web/app/%5Blocale%5D/page.tsx) | تحقق متصفح RTL/mobile وقراءة حالة ready؛ صارت صفحة عامة فعلية ضمن PART-04 |
| FND-CONTRACT | [عقد OpenAPI](../packages/contracts/src/openapi.ts)، [قائمة مسارات المصادقة](../apps/api/src/modules/identity/auth-routes.ts) | [اختبار الانحراف](../tests/openapi.integration.test.ts): 100 مسار مطابقة في الاتجاهين، operationId فريد، وكل عملية توثق 401/403/409 |
| ORG-BANK | [الخدمة](../apps/api/src/modules/identity/identity.service.ts)، [حماية المعرّف](../apps/api/src/modules/identity/bank-identifier.ts)، [migration](../database/migrations/202609180005_bank_change_review/migration.sql) | [وحدة](../tests/bank-identifier.test.ts)، [تكامل](../tests/bank-change.integration.test.ts)، [ADR-018](../docs/adr/ADR-018-organization-bank-account.md) |
| DS-TOKENS | [tokens](../packages/ui/src/tokens.ts)، [الأنماط](../packages/ui/src/styles.css) | [اختبار](../tests/design-tokens.test.ts): 16 زوج نص عند 4.5:1، 7 أزواج غير نصية عند 3:1، سلامة الـtokens، ومنع القواعد الفيزيائية |
| DS-COMPONENTS | [المكونات](../packages/ui/src/components.tsx)، [القشرة](../packages/ui/src/shell.tsx) | [معرض الحالات](../apps/web/app/%5Blocale%5D/design/states-gallery.tsx) بالعربية والإنجليزية؛ فُحص بصريًا على Chrome عند 360/768/1440 مع لوحة المفاتيح وحلقة التركيز |
| DS-LOCALE | [الأدوات](../packages/ui/src/locale.ts)، [proxy](../apps/web/proxy.ts)، [layout](../apps/web/app/%5Blocale%5D/layout.tsx) | [اختبار](../tests/locale-routing.test.ts) + فحص توجيه فعلي لـ`Accept-Language` وسلسلة الاستعلام |
| PROJ-MODEL | [schema](../database/schema.prisma)، [migration](../database/migrations/202609190001_projects/migration.sql)، [الخدمة](../apps/api/src/modules/projects/projects.service.ts) | [تكامل](../tests/projects.integration.test.ts): عزل الجهات، نوع ثابت في SQL، نسخ append-only، تعارض النسخة، والفلاتر |
| PROJ-PUBLIC | [الإسقاطات](../apps/api/src/modules/projects/projections.ts)، [صفحات الجمهور](../apps/web/app/%5Blocale%5D/explore/page.tsx) | [وحدة](../tests/public-projection.test.ts) 9 اختبارات، [تكامل HTTP](../tests/public-surface.integration.test.ts): لا اسم قانوني ولا معرّف داخلي ولا موقع مستفيد، وفلاتر allowlist |
| CHARITY-PLAN | [الخدمة](../apps/api/src/modules/projects/charity.service.ts)، [المال](../apps/api/src/modules/projects/money.ts)، [migration](../database/migrations/202609190002_charity_lifecycle/migration.sql) | [تكامل](../tests/charity-lifecycle.integration.test.ts): انتقالات ممنوعة، نسخ ميزانية append-only، أوزان 100، ومبالغ بوحدات صغرى نصية |
| CHARITY-REVIEW | [مراجعة المحتوى](../apps/api/src/modules/projects/charity.service.ts)، [شاشة المراجع](../apps/web/app/%5Blocale%5D/admin-project-reviews.tsx) | [تكامل](../tests/charity-lifecycle.integration.test.ts): منحة مستقلة بـMFA، استلام ذري، منع عضو الجهة من القرار والنشر، وإعادة فحص التوثيق عند النشر |
| DS-ACTION-MANIFEST | [السجل](../packages/contracts/src/actions.ts) | [اختبار](../tests/action-manifest.test.ts): معرّفات فريدة، مرجع اختبار موجود لكل منفذ، وسبب وجزء مالك لكل غير منفذ |

كانت FND-WEB شاشة تأسيس داخلية بلا أزرار أعمال. مع PART-04 صارت PUB-01 فعلية تقرأ من الخادم، وأفعالها مسجلة في سجل الأفعال. بقية الـ347 إجراءً تُضاف إلى السجل مع أجزائها، ولا يُحتسب أي إجراء منفذًا قبل أن يذكر ملف اختبار موجود.
