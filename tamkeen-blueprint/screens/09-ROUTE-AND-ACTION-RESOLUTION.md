# 09 — ضبط المسارات وعقود الأفعال

## مرجعية العقود

[11-API-CONTRACTS](../11-API-CONTRACTS.md) يحدد القواعد والعائلات الأساسية. جداول الشاشات تضيف عمليات تفصيلية مثل الاعتراض وإصدار الشهادة والرد على سؤال. عند بناء الوحدة تجمع جميع العمليات في OpenAPI وتمنح كل عملية operationId واحدًا، ثم يولد client typed. لا تفترض أن جدول العائلات حصر لجميع endpoints.

إذا ورد اسم عائلة عام واسم تفصيلي لنفس الوظيفة، اختر المسار التفصيلي canonical التالي، وحدّث المراجع قبل التنفيذ؛ لا تنفذ مسارين يسببان انتقالين مكررين:

- قرارات التوثيق: `POST /admin/verifications/:id/decision`.
- قرارات عرض الاستثمار: `POST /admin/offerings/:id/decision`، والأهلية `/admin/eligibility/:id/decision`.
- مراجعة مشروع/برنامج/تقرير: `POST /admin/reviews/:type/:id/decision`، مع type allowlist واختصاص مستقل لكل نوع. يحدّث اعتماد المشروع snapshot ويسمح نشره حسب workflow؛ لا يفتح عرض استثمار من endpoint محتوى.
- طلبات صرف الجهة: `POST /orgs/:orgId/payouts`؛ اعتمادها `POST /payouts/:id/approve`؛ تنفيذها `POST /admin/payouts/:id/execute`.
- إغلاق مشروع قبل اكتمال مراجعة الأثر هو close request؛ الإكمال terminal يحدث بعد المراجعة والتسوية، لا من نفس ضغط مدير المشروع.
- `POST أو PATCH` في صف واحد يعني create route وedit route منفصلين تحت نفس الشاشة؛ الاختبارات تغطي الاثنين.

## Route variants

جميع المسارات لها بادئة locale فعلية. أمثلة محرر مشروع كاملة: `/{locale}/org/:orgId/projects/new` و`/{locale}/org/:orgId/projects/:pid/edit`. الاختصارات `/projects/:pid/edit` داخل اسم صفحة الجهة ليست مسارًا عامًا مستقلًا. `:id` معرف UUID إلا slug/رمز تحقق عام منصوص عليه. لا يمرر مسار داخلي قيمة ID حساسة كslug عام.

## مسارات خدمات واجهة مكملة

| المسار | العرض/الإجراء | المالك والتحقق |
|---|---|---|
| /invitations/:token | معاينة دعوة ثم قبول | token صالح + بريد مطابق؛ POST /invitations/:token/accept؛ إلغاء يعود للصفحة الشخصية |
| /mfa/challenge | تحقق قبل إجراء حساس | challenge قصير العمر مرتبط actor/operation؛ POST /auth/mfa/challenge؛ retry محدود؛ إلغاء لا ينفذ الفعل |
| /certificates/:publicId | تحقق شهادة | GET public minimal: برنامج وحالة واسم عرض مسموح؛ لا رقم هوية؛ شهادة revoked لا تُعرض سارية |
| /impact/reports/:id | تقرير منشور | GET /public-reports/:id؛ تنزيل منقح؛ report غير منشور 404 |
| /app/exports/:jobId | تتبع تنزيل | GET /exports/:id؛ owner/scope؛ GET /exports/:id/download مع إعادة إذن وانتهاء |
| /org/:orgId/investments | محفظة مستثمر مؤسسي | نفس PER-06 مع Party المؤسسة وinvestment.read |
| /org/:orgId/commitments/:id | التزام مؤسسي | نفس PER-08/09 مع commitment.manage/create وليس self وحدها |
| /org/:orgId/tasks | مهام عضو الجهة | GET /orgs/:id/tasks؛ task assignee أو نطاق إذن؛ NAV للمورد وclaim إذا سمح دون إقرار مال |
| /app/training/:id/sessions/:sid | جلسة متدرب | GET /me/enrollments/:id/sessions/:sid؛ رابط جلسة موثوق/مورد مقرر؛ لا تعديل حضور ذاتي |

هذه مسارات فرعية داعمة محسوبة ضمن سجل الشاشات، ومعرفاتها على الترتيب SUP-01..09. تفاصيل أزرارها موجودة في [10-SUPPORTING](10-SUPPORTING.md)، وتُنفذ مع وحدتها: SUP-01/02 في PART-02، SUP-03 في PART-12، SUP-04/05/08 في PART-13، SUP-06/07 في PART-09، SUP-09 في PART-10.

## تبويبات صفحة المشروع

| Tab | القراءة | مالك البيانات |
|---|---|---|
| نظرة عامة | GET /projects/:slug | public projection |
| الميزانية والشفافية | GET /projects/:id/financial-transparency | مجاميع مراجعة دون البنك/هوية دفع |
| المراحل | GET /projects/:id/milestones | حقول عامة وأدلة منقحة |
| التحديثات | GET /projects/:id/updates | منشورة فقط |
| المساهمون | GET /projects/:id/contributors | visibility + amount consent |
| التقارير | GET /projects/:id/reports | snapshot عام |

فلترة، فتح تبويب، pagination، تنزيل ومشاركة هي GLOBAL-07/09/14/19 أو فعل الصفحة المحدد. ملخص المال يشرح gross/net/available ولا يفضح قيود دفتر داخلي.

## Action implementation manifest

في PART-03 أنشئ typed manifest للإجراءات المطبقة: id, page, method, endpoint/route, permission, states, handler, testRef. تحقق من unique IDs ووجود handler/route أو feature-unavailable state مفسرة. في PART-14 يجب ألا يبقى فعل داخل نطاق الإصدار مع feature-unavailable إلا تكامل خارجي مسجل بوضوح؛ demo simulator يجب أن ينجز الرحلة محليًا.
