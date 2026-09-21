# سجل الصفحات والإجراءات

يُقرأ مع [عقد الواجهة](../20-UI-CONTRACT.md) و[الصلاحيات](../02-IDENTITY-ROLES-PERMISSIONS.md). جميع الأفعال ترث حالات الخطأ والتأكيد وidempotency حيث تنطبق. الجداول أدناه مواصفات مخططة لا إثبات تنفيذ.

| الصفحة | المسار | الملف |
|---|---|---|
| PUB-01 — الرئيسية | `/` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-02 — استكشاف المشاريع | `/explore` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-03 — الخريطة | `/map` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-04 — دليل الجهات | `/organizations` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-05 — ملف الجهة العام | `/organizations/:slug` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-06 — المشروع الخيري | `/projects/:slug` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-07 — فهرس الاستثمار | `/invest` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-08 — تفاصيل العرض | `/invest/:id` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-09 — فرص التدريب والعمل | `/opportunities` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-10 — تفاصيل البرنامج | `/programs/:id` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-11 — تفاصيل الوظيفة | `/jobs/:id` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-12 — الأثر والشفافية | `/impact` | [01-PUBLIC.md](01-PUBLIC.md) |
| PUB-13 — عن تمكين والسياسات | `/about و/policies/:slug` | [01-PUBLIC.md](01-PUBLIC.md) |
| AUTH-01 — تسجيل الدخول | `/login` | [02-AUTH.md](02-AUTH.md) |
| AUTH-02 — إنشاء الحساب | `/register` | [02-AUTH.md](02-AUTH.md) |
| AUTH-03 — التحقق والاسترداد | `/verify و/recover و/reset` | [02-AUTH.md](02-AUTH.md) |
| AUTH-04 — تهيئة الفرد | `/onboarding` | [02-AUTH.md](02-AUTH.md) |
| PER-01 — الرئيسية الشخصية | `/app` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-02 — المساهمات | `/app/contributions` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-03 — تفاصيل المساهمة | `/app/contributions/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-04 — Checkout خيري | `/checkout/:campaignId` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-05 — نتيجة الدفع | `/payments/:intentId` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-06 — محفظة الاستثمار | `/app/investments` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-07 — الأهلية الاستثمارية | `/app/investor/eligibility` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-08 — الاكتتاب | `/invest/:id/subscribe` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-09 — تفاصيل الاستثمار وغرفة البيانات | `/app/investments/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-10 — ملف المهارات | `/app/career/profile` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-11 — طلب جديد أو مسودة | `/app/applications/new و/app/applications/:id/edit` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-12 — طلباتي وتفاصيلها | `/app/applications و/app/applications/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-13 — تدريبي | `/app/training/:enrollmentId` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-14 — العرض الوظيفي والمتابعة | `/app/job-offers/:id و/app/placements/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-15 — طلبات المساعدة | `/app/assistance و/app/assistance/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-16 — أفكاري واحتضاني | `/app/proposals و/app/proposals/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-17 — التطوع | `/volunteer و/app/volunteering` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-18 — إعدادات الفرد والأمان | `/app/settings` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-19 — الإشعارات والمحفوظات | `/app/notifications و/app/saved` | [03-PERSONAL.md](03-PERSONAL.md) |
| PER-20 — الدعم | `/contact و/app/tickets/:id` | [03-PERSONAL.md](03-PERSONAL.md) |
| ORG-01 — إنشاء جهة | `/app/organizations/new` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-02 — لوحة الجهة | `/org/:orgId` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-03 — ملف وإعدادات الجهة | `/org/:orgId/settings` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-04 — توثيق الجهة | `/org/:orgId/verification` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-05 — الفريق والصلاحيات | `/org/:orgId/team` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-06 — قائمة المشاريع | `/org/:orgId/projects` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-07 — محرر المشروع | `/org/:orgId/projects/new و/projects/:pid/edit` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-08 — إدارة المشروع والمراحل | `/org/:orgId/projects/:pid` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-09 — المساهمون والمساهمات | `/org/:orgId/contributions` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-10 — المالية والدفتر | `/org/:orgId/finance` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-11 — إنشاء صرف | `/org/:orgId/payouts/new` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-12 — مراجعة وتتبع الصرف | `/org/:orgId/payouts/:id` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| ORG-13 — التقارير | `/org/:orgId/reports و/reports/:rid` | [04-ORGANIZATIONS.md](04-ORGANIZATIONS.md) |
| BUS-01 — عروض الشركة | `/org/:orgId/offerings` | [05-BUSINESS.md](05-BUSINESS.md) |
| BUS-02 — محرر العرض | `/org/:orgId/offerings/new و/:oid/edit` | [05-BUSINESS.md](05-BUSINESS.md) |
| BUS-03 — غرفة البيانات والأسئلة | `/org/:orgId/offerings/:oid/dataroom` | [05-BUSINESS.md](05-BUSINESS.md) |
| BUS-04 — الاكتتابات والتخصيص | `/org/:orgId/offerings/:oid/allocations` | [05-BUSINESS.md](05-BUSINESS.md) |
| BUS-05 — تقارير الشركة والتوزيعات | `/org/:orgId/investor-relations` | [05-BUSINESS.md](05-BUSINESS.md) |
| BUS-06 — الشراكات والمنح | `/org/:orgId/agreements و/:aid` | [05-BUSINESS.md](05-BUSINESS.md) |
| PRG-01 — لوحة الحاضنة والبرامج | `/org/:orgId/programs` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-02 — محرر البرنامج | `/org/:orgId/programs/new و/:pid/edit` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-03 — فرز المتقدمين | `/org/:orgId/applications` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-04 — إدارة الدفعة | `/org/:orgId/cohorts/:cid` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-05 — الحضور والتقييم | `/org/:orgId/cohorts/:cid/sessions/:sid` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-06 — البدلات والشهادات | `/org/:orgId/programs/:pid/outcomes` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-07 — إدارة الوظائف | `/org/:orgId/jobs و/:jid/edit` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-08 — عروض العمل | `/org/:orgId/job-offers` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-09 — التوظيف والمتابعة | `/org/:orgId/placements` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-10 — أفكار الاحتضان والإرشاد | `/org/:orgId/proposals و/:pid` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-11 — محفظة الراعي | `/org/:orgId/sponsorships` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-12 — طلبات المساعدة داخل الجمعية | `/org/:orgId/assistance/:caseId` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| PRG-13 — إدارة التطوع | `/org/:orgId/volunteering` | [06-PROGRAMS.md](06-PROGRAMS.md) |
| ADM-01 — قوائم عمل الإدارة | `/admin` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-02 — مراجعة التوثيق | `/admin/verifications/:id` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-03 — مراجعة المشروع والبرنامج والتقرير | `/admin/reviews/:type/:id` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-04 — مراجعة الاستثمار والأهلية | `/admin/investment-reviews/:id` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-05 — مركز المدفوعات والتسوية | `/admin/finance` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-06 — تنفيذ الصرف والاسترداد | `/admin/disbursements/:id` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-07 — التذاكر والبلاغات والتجميد | `/admin/tickets/:id` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-08 — التدقيق وصلاحيات التشغيل | `/admin/audit و/admin/team` | [07-ADMIN.md](07-ADMIN.md) |
| ADM-09 — مراقبة النظام والنشر المالي | `/admin/operations` | [07-ADMIN.md](07-ADMIN.md) |
| SUP-01 — قبول دعوة مؤسسة | `/invitations/:token` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-02 — تحقق إضافي للعملية الحساسة | `/mfa/challenge` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-03 — التحقق العام من الشهادة | `/certificates/:publicId` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-04 — تفاصيل تقرير أثر عام | `/impact/reports/:id` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-05 — تتبع ملف التصدير | `/app/exports/:jobId` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-06 — محفظة المستثمر المؤسسي | `/org/:orgId/investments` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-07 — التزام استثماري مؤسسي | `/org/:orgId/commitments/:id` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-08 — مهام فريق الجهة | `/org/:orgId/tasks` | [10-SUPPORTING.md](10-SUPPORTING.md) |
| SUP-09 — جلسة تدريب للمتدرب | `/app/training/:id/sessions/:sid` | [10-SUPPORTING.md](10-SUPPORTING.md) |

عدد مواصفات الصفحات/مجموعات المسارات: **87**. عدد الأفعال الخاصة: **347**، إضافة إلى 19 إجراء عامًا موروثًا. بعض مجموعات الصفحة تجمع القائمة والتفاصيل أو المسودة والتحرير تحت عقد واحد، ويجب اختبار كل route variant.

تفاصيل الصلاحيات الموسعة: [08-PERMISSION-EXTENSIONS](08-PERMISSION-EXTENSIONS.md). لا يعني وجود endpoint في هذا السجل أنه منفذ بعد؛ يضاف إلى OpenAPI وخدمة المجال والاختبارات في مرحلته.
