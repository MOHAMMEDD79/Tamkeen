# 08 — قاموس الصلاحيات المكمل لسجل الصفحات

يكمّل [نموذج الهوية والصلاحيات](../02-IDENTITY-ROLES-PERMISSIONS.md). الأسماء الواردة هنا تخطط إلى permission records صريحة، لا فحص نص دور في الواجهة. يحمل الدور مجموعة أذونات، ثم يقيّد policy كل طلب بالجهة والكائن والحالة ووقت الصلاحية وتعارض المصالح. لا أحد يكتسب كل ما في الجدول بمجرد عضوية مؤسسة.

## نطاقات الفرد والقراءة العامة

- `public`: قراءة projection منشورة فقط؛ الاستثناءات login/register/recovery/contact لها schema/rate limiting وحماية إساءة. contact المجهول لا يقبل الوصول لتذكرة خاصة دون تحقق قناة وربط هوية.
- `self`: session صحيحة وresource.party/user يعود للفرد أو الجهة النشطة التي يملك إذن تمثيلها **لهذا الفعل**. صفة صاحب الكائن لا تغني عن permission مؤسسية لمال الشركة.
- `token owner`: token محفوظ hash، غير منتهٍ، أحادي الاستخدام، غرضه مطابق. session وحدها لا تكفي لاسترداد كلمة مرور برمز شخص آخر.
- `ticket participant`: صاحب التذكرة أو عضو فريق دعم مسند مخول؛ ليس أي شخص يعرف ticket ID.
- `member active` في ORG-02 يعرض مهام العضو فقط؛ لا مهمة بلا صلاحية على المورد.
- `scoped review` في ADM-01 يعني الاختصاص المقابل verification.review/content.review/offering.review/eligibility.review، لا permission عامة تفتح كل المراجعات.

## أذونات مكملة

| الأذونات | الدور الممنوح افتراضيًا | القيود الإضافية |
|---|---|---|
| finance.read | FinanceMaker, FinanceApprover؛ Analyst بمنح صريح | org/pool؛ بدون هوية دفع حساسة افتراضيًا |
| finance.export | FinanceMaker, FinanceApprover بمنح تصدير | نفس scope؛ تسجيل تنزيل؛ تنقيح |
| bank.manage | Owner أو FinanceMaker مفوض | طلب تغيير فقط؛ مراجع مستقل يعتمد البنك؛ re-auth |
| project.read | ProjectManager وViewer المخول | مشروع الجهة؛ public مختلف |
| project.pause, project.close | ProjectManager, OrgAdmin | أسباب وانتقالات وسياسة التزامات؛ لا تجاوز تجميد |
| project.archive | OrgAdmin | مغلق وتسوية مكتملة؛ لا حذف ledger |
| report.create, report.submit | ProjectManager, ProgramManager | مشروع/برنامج مسند؛ أرقام من النظام |
| report.read | Viewer/Analyst/إدارة المشروع حسب المنح | نطاق الجهة؛ نسخة عامة لا تعني فتح الأصل الخاص |
| dataroom.manage | InvestmentManager | offering داخل الجهة؛ صلاحية grant محددة بمدة |
| allocation.preview, allocation.request | InvestmentManager + Finance مفوض | preview لا ينتج holding؛ request لا finalize |
| investment.export | InvestmentManager/Finance مفوض | عرض الجهة؛ لا عروض جهات أخرى |
| distribution.request | FinanceMaker مع اختصاص الاستثمار | مستند/رصيد/holding snapshot |
| distribution.approve | FinanceApprover مع اختصاص الاستثمار | actor مختلف عن المنشئ؛ نسخة ثابتة |
| agreement.manage | Owner أو ProjectManager/ProgramManager مفوض | يمثل جهة واحدة من طرفي الاتفاق |
| agreement.accept | Owner أو مفوض توقيع مستقل | قبول باسم party الصحيح ونسخة محددة |
| agreement.review | مسؤول راعٍ/مشغل مفوض | مرحلة أو تقرير داخل اتفاق الجهة؛ منع مراجعة تسليم ذاتي إن كانت السياسة تتطلب الطرف الآخر |
| program.read | ProgramManager, Trainer لمجموعته، Viewer للمجاميع | فصل قوائم الأسماء عن أثر الراعي |
| program.publish | ProgramManager | approved من مراجع مخول أولًا؛ ليس تخطي المراجعة |
| candidate.export | Recruiter/ProgramManager بمنح مستقل | target ضمن الجهة وموافقة مشاركة محفوظة |
| attendance.correct | Trainer/ProgramManager | revision وسبب؛ تعديل يؤثر مالًا بعد الإقفال يحتاج مراجعة مستقلة |
| attendance.review | ProgramManager أو مراجع مخول | لا حسم اعتراض ضد تعديل نفذه الشخص ذاته عند تعارض |
| assessment.record | Trainer مسند | rubric version وenrollment ضمن مجموعته |
| stipend.request | ProgramManager أو FinanceMaker | حضور مثبت وفترة غير مصروفة؛ ليس execute |
| certificate.issue, certificate.revoke | ProgramManager | استحقاق/سبب سحب ودليل؛ لا دفع مالي ضمني |
| job.manage, job.publish | Recruiter | جهة موثقة/مفعلة؛ نشر بعد اكتمال المتطلبات |
| placement.review | ProgramManager أو مراجع أثر مفوض | دليل من الطرفين أو مراجعة تعارض؛ لا إخفاء unknown |
| proposal.review | ProgramManager؛ Mentor يعلق دون قرار نهائي افتراضيًا | فكرة مسندة؛ لا وصول لكل الأفكار |
| sponsorship.fund | ممثل مالي للراعي مخول | Party المؤسسة + اتفاق نشط + حدود صلاحية الدفع |
| volunteer.manage | VolunteerCoordinator (دور إضافي مؤسسي) | فرص ومهام الجهة؛ لا ملفات مستفيدين تلقائيًا |
| review.claim | Verification/Content/Risk reviewer حسب الاختصاص | قائمة اختصاصه؛ claim ذري لمنع السباق |
| review.assign | مشرف فريق المراجعة | العامل الجديد يحمل الاختصاص نفسه |
| verification.review | VerificationReviewer | case جهة/فرد ضمن التكليف وليس وثائق كل المنصة |
| content.review | ContentReviewer أو ImpactReviewer (دور إضافي) | أنواع مشاريع/برامج/تقارير يملك مراجعتها فقط |
| eligibility.review | RiskReviewer مفوض للأهلية | وصول حساس مسجل؛ تاريخ انتهاء وسبب |
| reconciliation.manage | FinanceOperator | imports/matches/resolutions؛ تصحيح دفتر عبر command معتمد |
| payment.inquire | FinanceOperator | استعلام الحالة فقط، لا charge جديد |
| webhook.replay | FinanceOperator/Operations مفوض | حدث محفوظ بنفس unique key؛ لا قبول payload مصطنع بالإنتاج |
| refund.execute | FinanceOperator | approved + رصيد/تغطية + idempotency |
| support.manage | Support مسند | رد وتصعيد وحل، لا تجميد/صرف |
| risk.freeze, risk.unfreeze | RiskReviewer مفوض | نطاق محدد وسبب وقرار؛ فك التجميد لا يكرر إجراء قديم |
| audit.export | Auditor بمنح مستقل | فلاتر وتدقيق وتخزين مؤقت مشفر |
| platform.access.manage | PlatformAdmin مفوض | لا يرفع نفسه إلى صلاحية مالية بلا مسار منح مستقل ومراجع |
| ops.read | Operations/Auditor مفوض | metrics وحوادث منقحة |
| ops.jobs.manage | Operations | jobs غير مالية idempotent؛ مالية محصورة inquiry/replay المصرح |
| ops.manage | Operations | تدوين تمرين/incident من أدلة؛ لا تعديل مال |
| platform.release.manage | مسؤول إطلاق مفوض | change request مع checklist تشغيل موثقة؛ لا يتجاوز money flag dependencies |
| task.claim, task.complete | عضو مخول بالمورد الأساسي | مهمة غير مالية/مهمة يدوية؛ لا تثبيت مال أو أثر بإنهاء task |
| task.assign | OrgAdmin أو مدير المسار | داخل الجهة؛ الفرد الجديد يحمل أذونات المورد |

## تفويض مؤسسي لعمليات توصف self في الواجهة

في حساب الفرد تكفي ملكية المورد مع شروط الحالة والأهلية. في السياق المؤسسي:

| الفعل | إذن مؤسسي إضافي |
|---|---|
| إنشاء مساهمة/تمويل جهة | contribution.create أو sponsorship.fund مع party ممثل |
| تأكيد التزام ودفع استثمار | commitment.create + تفويض تمويل المؤسسة بحسب حدوده |
| قراءة/تصدير استثمارات المؤسسة | investment.read / investment.export لممثل مخول |
| إلغاء التزام مؤسسي | commitment.manage لممثل مفوض؛ لا أي عضو |
| تنزيل إثباتات دفع/أسهم المؤسسة | finance.read أو investment.read + document grant |
| طلب استرداد مؤسسي | refund.request؛ بقية دورة الاعتماد مستقلة |

`investment.read` و`commitment.manage` يمنحان InvestmentManager أو Finance ضمن جهة المستثمر بتفويض صريح. تعرض لوحات المستثمر المؤسسي نفس مكونات PER-06/08/09 داخل shell الجهة ومسارات `/org/:orgId/investments` و`/org/:orgId/commitments/:id`، وقراءات `/orgs/:orgId/investments` بدل `/me/investments`. لا ترجع endpoints `/me` بيانات المؤسسة بمجرد تبديل query.

## منح الأذونات واختبارها

عرّف ملف policy registry typed، وجدول grant migration، واختبار allowed/denied لكل permission. الأدوار الإضافية VolunteerCoordinator وImpactReviewer وOperations وMentor تخصصات ضمن العضوية/طاقم المنصة؛ ليست User Types جديدة. أي اسم إذن في السجل غير موجود بالـregistry يفشل CI بدل default allow.
