# تتبع تنفيذ الهوية — PART-02

الحالة العامة IN_PROGRESS. تعني «منفذ محليًا» هنا الشريحة المحددة فقط، وليست إغلاق قبول الصفحة كاملًا.

## الملفات الفعلية

- [Schema](../database/schema.prisma) وmigrations الهوية والمصادقة والملف العام والتوثيق والأصول وأدوار المنصة والدعوات ومنح التشغيل ونقل الملكية حتى `202609180004_ownership_transfers`.
- [خدمة الهوية](../apps/api/src/modules/identity/identity.service.ts)، [السياسات](../apps/api/src/modules/identity/policy.ts)، [Controller](../apps/api/src/modules/identity/identity.controller.ts).
- [المصادقة](../apps/api/src/modules/identity/auth.ts)، [جلسات hashed](../apps/api/src/modules/identity/session-adapter.ts).
- [الواجهة](../apps/web/app/identity-workspace.tsx)، [returnTo](../apps/web/lib/return-to.ts).
- [اختبار HTTP](../tests/auth.integration.test.ts)، [اختبار المجال](../tests/identity.integration.test.ts)، [السياسات](../tests/identity-policy.test.ts).
- [حماية المعرّف البنكي](../apps/api/src/modules/identity/bank-identifier.ts)، [قائمة مسارات المصادقة المسموحة](../apps/api/src/modules/identity/auth-routes.ts)، [عقد OpenAPI](../packages/contracts/src/openapi.ts).
- [اختبار تغيير البنك](../tests/bank-change.integration.test.ts)، [اختبار المعرّف البنكي](../tests/bank-identifier.test.ts)، [اختبار انحراف العقد](../tests/openapi.integration.test.ts).
- [مواءمة عقود الخطة](../docs/adr/ADR-012-identity-auth.md)، [قرار سجل التوثيق](../docs/adr/ADR-013-organization-verification.md)، [قرار الأصول العامة](../docs/adr/ADR-014-public-organization-assets.md)، [قرار MFA والمراجع](../docs/adr/ADR-015-verification-review-mfa.md)، [قرار منح المنصة](../docs/adr/ADR-016-platform-team-access.md)، [قرار نقل الملكية](../docs/adr/ADR-017-organization-ownership-transfer.md)، [قرار الحساب البنكي](../docs/adr/ADR-018-organization-bank-account.md)، [قرار العقد وفحص الانحراف](../docs/adr/ADR-019-api-contract-and-drift.md)، [تقرير QA](../docs/qa/part-02/README.md).

## تتبع الأفعال

| Action ID | التنفيذ الفعلي | الحالة / النقص |
|---|---|---|
| AUTH-01.A01 | login → Better Auth → hashed session؛ safe returnTo | منفذ محليًا؛ فحص المتصفح الكامل متبقٍ |
| AUTH-01.A02 | رابط /recover | منفذ |
| AUTH-01.A03 | /register مع returnTo داخلي مسموح | منفذ؛ اختبار pure function للوجهات |
| AUTH-02.A01 | signup مع إصدار شروط إلزامي ووقت قبول من الخادم ثم تحقق محلي | منفذ محليًا ومختبر HTTP |
| AUTH-02.A02 | العودة إلى login مع returnTo | منفذ |
| AUTH-02.A03 | /policies/terms يعرض الإصدار المقبول وحدود البيئة | منفذ للنسخة المحلية؛ اعتماد السياسات النهائية خارج هذه النسخة |
| AUTH-03.A01 | request-password-reset برسالة عامة وحدود محاولات | منفذ HTTP؛ قياس429 منفصل متبقٍ |
| AUTH-03.A02 | send-verification-email برسالة عامة | منفذ ومختبر HTTP |
| AUTH-03.A03 | verify-email مع حجز hash ذري وعرض success/error | منفذ؛ اختبار طلبين متزامنين وreplay ينجح واحد فقط |
| AUTH-03.A04 | reset-password مع إلغاء الجلسات | منفذ ومختبر HTTP بما فيه إعادة الاستخدام |
| AUTH-04.A01 | PATCH /me/profile مع version ثم /app | منفذ محليًا |
| AUTH-04.A02 | حفظ capabilities مع الملف | منفذ؛ لا أهلية مالية ضمنية |
| AUTH-04.A03 | تخطي الاختياري إلى /app | منفذ |
| ORG-01.A01 | إنشاء جهة وOwner/المفوض الأول وParty ذريًا، واختيار PS/JO | منفذ محليًا |
| ORG-01.A02 | مسودة localStorage معلنة كغير منشأة | منفذ محليًا |
| ORG-01.A03 | متابعة التوثيق | منفذ؛ رابط من مساحة الجهة إلى `/org/:orgId/verification` بإذن الإدارة |
| ORG-02.A01–A03 | مشاريع/مهام/مالية | لم تنفذ؛ لا أزرار موهومة |
| ORG-02.A04 | قائمة الفريق بإذن member.read | منفذ محليًا |
| ORG-03.A01 | PATCH إعدادات عامة مع version؛ slug وشعار ووصف وقطاعات واتصال وموقع؛ تغيير الاسم القانوني للموثقة → changes_requested | منفذ محليًا؛ الشعار أصل Public مستقل لا يستبدل الحالي قبل نجاح الفحص |
| ORG-03.A02 | GET public-preview عبر DTO allowlist بلا legalName | منفذ محليًا ومختبر عزل الجهة |
| ORG-03.A03 | تغيير الحساب البنكي | منفذ محليًا ومختبر؛ `bank.manage` مستقل عن أذونات الصرف، تحدي MFA مربوط بنسخة الجهة، IBAN متحقق بـmod-97 ومخزن مشفرًا مع بصمة مطابقة، طلب واحد معلق، واعتماد `FinanceOperator` مختلف عن مقدم الطلب هو وحده ما يبدّل الحساب الفعال |
| ORG-03.A04 | نقل ملكية الجهة | منفذ محليًا؛ طلب مربوط بنسخة الجهة بعد MFA، قبول من عضو موثق فعّل MFA خلال 48 ساعة، تبديل ذري للأدوار، وسحب جلسات الطرفين |
| ORG-04.A01 | مسودة رقم التسجيل والجهة المصدرة والعنوان والانتهاء والوثائق | منفذ محليًا؛ upload intent أحادي الاستخدام، أحجام محدودة، حجر، magic bytes، وفحص محافظ لـPDF/PNG/JPEG |
| ORG-04.A02 | تقديم وثائق سليمة ومكتملة | منفذ ومختبر عبر HTTP؛ finalize وحده ينقل إلى clean ويبطل الرمز، والتقديم يرفض pending/rejected. محرك malware خارجي متبقٍ للإنتاج |
| ORG-04.A03 | إعادة التقديم بعد طلب تعديلات وربط النسخ | منفذ ومختبر: قرار changes_requested ثم تعديل المسودة وتسليم sequence جديد مرتبط بالسابق |
| ORG-04.A04 | عرض القرار العام | allowlist وواجهة العرض منفذان بلا reviewerId أو مفاتيح تخزين/بصمات |
| ORG-05.A01 | دعوة بصلاحيات ضمن المانح وتسليم ذري محلي | منفذ؛ UI يدعم ثلاثة أدوار حاليًا |
| ORG-05.A02 | API وواجهة تغيير role/version ضمن صلاحيات المانح | منفذ محليًا |
| ORG-05.A03 | PATCH status=suspended مع إلغاء الجلسات | منفذ؛ السياسة تمنع تعديل Owner/self |
| ORG-05.A04 | قائمة الدعوات وإلغاء pending ذريًا مع audit | منفذ ومختبر عزل الجهة |
| SUP-01.A01–A03 | معاينة دعوة ببريد مطابق ثم قبول أو رفض، مع login/returnTo آمن | منفذ محليًا؛ preview منقح، قبول يتحقق من أهلية المانح الحالية، ورفض لا ينشئ عضوية. قيد SQL وقفل الجهة يضمنان حالة نهائية واحدة حتى عند سباق القبول والرفض |
| ADM-02.A01–A03 | استلام مراجعة التوثيق وقرار اعتماد/تعديل/رفض | منفذ محليًا بمنحة VerificationReviewer مستقلة وMFA challenge وversion |
| ADM-08.A01، A03–A05 | قراءة حدث منقح، دعوة موظف، تعديل منح مؤقتة، وإلغاء وصول | منفذ محليًا؛ قراءة الحدث مقيدة بـAuditor/PlatformAdmin ولا تعيد payload، والدعوة ببريد مطابق وMFA، grant expiry حتى 90 يومًا، optimistic version، فصل تعارض، منع self-management، وسحب جلسات فوري. ADM-08.A02 للتصدير غير منفذ |
| SUP-02.A01–A03 | TOTP ورموز استرداد وتحدي عملية حساس وإلغاء | منفذ محليًا؛ التحدي مربوط actor/session/operation/resource/version وأحادي الاستهلاك |
| PER-18.A02 | GET `/sessions` وPOST `/sessions/:id/revoke` | منفذ محليًا؛ DTO بلا token، الجلسة الحالية مميزة، والإلغاء scoped للمالك ومدقق. إلغاء الحالية يؤدي إلى تسجيل الخروج |
| PER-18.A03 | إعداد MFA للحساب | منفذ محليًا عبر Better Auth TOTP مع تأكيد الرمز الأول ورموز استرداد |

## استئناف مضبوط

1. لا تعِد إنشاء المستودع أو أسرار `.env` أو migrations المطبقة.
2. بعد أي تغيير في `database/schema.prisma` شغّل `pnpm db:generate` ثم `pnpm --filter @tamkeen/database build` ثم `pnpm db:migrate`؛ التطبيقات تستهلك `database/dist` لا المصدر، وإغفال ذلك يكسر typecheck بأخطاء مضللة عن «خاصية غير موجودة».
3. أي مسار واجهة جديد يجب إضافته إلى [catch-all route](../apps/web/app/%5B...path%5D/page.tsx)، وإلا أعاد 404 مهما عالجه المكوّن. اختبارات HTTP لا تكشف هذا.
4. أي endpoint جديد يجب أن يدخل [عقد OpenAPI](../packages/contracts/src/openapi.ts) بـ`operationId` فريد، وإلا فشل اختبار الانحراف.
5. أبقِ S3 ومحركات الفحص الخارجية ومفتاح تشفير مستقل عن `SESSION_SECRET` كعوائق تشغيل إنتاجية موثقة.
6. أضف اختبارات HTTP للعزل وsession refresh وإلغاء الدعوات وتزامن نقل الملكية. endpoints التصدير ليست موجودة فلا تغطية مزعومة لها.
7. أكمل browser QA لجميع الشاشات ثم قيّم قبول PART-02. أبقِ PART-03 وما بعده NOT_STARTED حتى تقرير قبول الجزء.
