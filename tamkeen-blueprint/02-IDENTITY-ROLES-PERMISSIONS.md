# 02 — الهوية والأدوار والصلاحيات

## النموذج

`User` هو الإنسان الذي يسجل الدخول. يملك `IndividualProfile` واحدًا ومجموعة capabilities: Donor, Beneficiary, JobSeeker, Investor, Volunteer. يمكنه تفعيل أكثر من قدرة دون بريد أو كلمة مرور جديدة. المستثمر يحتاج حالة أهلية منفصلة عن اختياره «أنا مستثمر».

`Organization` كيان مؤسسي من نوع Charity/NGO, Company, Startup, Foundation, Government/Institution. الدخول إليه بواسطة `Membership(user_id, org_id, role, status)`؛ لا كلمات مرور مشتركة للمؤسسة. خصائص الجهة المرخصة/المفعلة تحدد ما يمكنها نشره، ونوعها وحده لا يمنح صلاحية مالية.

السياق النشط: Personal أو Organization(id). يحتفظ الخادم بالممثل actor وبالجهة represented_party. يملك المستخدم عضويات في عدة جهات. تبديل السياق يفرغ cache المقيد بالجهة ويعيد جلب الصلاحيات؛ يظهر اسم الجهة دائمًا أعلى صفحات الإجراءات المالية.

## أدوار الفريق

| الدور | الاختصاص | الحدود |
|---|---|---|
| Owner | الملكية وإدارة الفريق وإعدادات الجهة | لا يوافق على صرف أنشأه بنفسه |
| OrgAdmin | الفريق والإعدادات التشغيلية | لا نقل ملكية ولا تعديل دفتر مالي |
| ProjectManager | مشاريع ومراحل وتقارير | لا يرى وثائق أهلية المستثمر ولا يوافق على صرف |
| FinanceMaker | إنشاء طلب صرف/استرداد، كشف وتسوية | لا يعتمد طلبه |
| FinanceApprover | اعتماد مالي بعد مراجعة | لا يغير المستفيد البنكي داخل طلب معتمد |
| Recruiter | وظائف ومرشحون ومقابلات وعروض | لا يرى تبرعات أو ملفات مساعدة |
| ProgramManager | برامج ودفعات وقبول متدربين | لا يصرف منفردًا |
| Trainer | حضور وتقييم مجموعاته | لا يرى حسابات بنكية أو احتياج صحي |
| InvestmentManager | عرض وغرفة بيانات وتحديثات | لا يثبت ملكية خارج عقد التخصيص |
| Analyst/Viewer | مؤشرات وتقارير ضمن النطاق | قراءة فقط، تصدير حساس بإذن مستقل |

الموظف يمكنه حمل عدة أدوار؛ تعارض المُنشئ والمعتمد يفحص هوية الإنسان لا اسم الدور. إزالة آخر Owner ممنوعة حتى نقل ملكية مؤكد لمستخدم عضو نشط.

## أدوار المنصة

Support: تذاكر وبيانات مخففة. VerificationReviewer: توثيق جهات. ContentReviewer: مراجعة نشر. FinanceOperator: تسوية وتنفيذ دفعات معتمدة. RiskReviewer: تجميد ومراجعات. PlatformAdmin: إعدادات وفرق التشغيل. Auditor: سجل قراءة فقط. لا تمنح PlatformAdmin صلاحية مالية شاملة ضمنيًا؛ منحها مستقل ومؤقت ومُدقق.

## مصفوفة الأذونات الأساسية

| Permission | حامل افتراضي | نطاق الكائن وشروطه |
|---|---|---|
| profile.manage | الفرد | self |
| organization.manage | Owner, OrgAdmin | عضوية نشطة في الجهة |
| member.invite / member.role.update | Owner, OrgAdmin | لا منح أعلى من صلاحية المانح |
| ownership.transfer | Owner | إعادة تحقق وقبول المالك الجديد |
| project.create/update/submit | ProjectManager, OrgAdmin | جهة مالكة؛ draft أو changes_requested |
| project.publish | ContentReviewer | مراجعة مستقلة وتوثيق صالح |
| contribution.create | Donor أو ممثل جهة مخول بالتمويل | مشروع يقبل التمويل وعملة مطابقة |
| contribution.read | صاحبها؛ Finance ضمن الجهة | بيانات عامة منفصلة عن هوية الدفع |
| contribution.identity.read | صلاحية مؤسسية صريحة عند حاجة تشغيلية | ليس ضمن ملف عام أو تصدير افتراضي |
| payout.request | FinanceMaker | رصيد متاح ومستفيد موثق |
| payout.approve | FinanceApprover | actor != maker؛ نسخة الطلب لم تتغير |
| payout.execute | FinanceOperator/service | موافقة صالحة وفحص تجميد حالي |
| refund.request | صاحب المساهمة أو FinanceMaker | أهلية السياسة ومبلغ قابل للاسترداد |
| refund.approve | FinanceApprover | اعتماد منفصل؛ لا تجاوز المبلغ |
| offering.manage | InvestmentManager | جهة مالكة وعرض قابل للتحرير |
| offering.review | RiskReviewer | نسخة إفصاح ثابتة |
| commitment.create | Investor أو ممثل مؤسسي مخول | أهلية سارية للعرض والسياق |
| allocation.finalize | خدمة التخصيص/مشغل مخول | تسوية مثبتة ووثائق معتمدة |
| dataroom.read | مستثمر ممنوح وصولًا | عرض بعينه وNDA إن اشترط |
| program.manage | ProgramManager | الجهة المشغلة |
| application.submit/withdraw | JobSeeker | self ودورة مفتوحة |
| application.review | Recruiter أو ProgramManager | الوظيفة/البرنامج ضمن الجهة |
| attendance.record | Trainer | مجموعة مسندة وزمن مسموح |
| placement.verify | ProgramManager | دليل وقبول المرشح أو مراجعة نزاع |
| assistance.manage | مسؤول حالة مفوض | حالات مسندة، ليس كل موظفي الجمعية |
| report.publish | ProjectManager/ProgramManager | تقرير مراجع خالٍ من بيانات خاصة |
| audit.read | Auditor | نطاق مصرح وسجل الوصول نفسه مدقق |

## قاعدة السماح

`allow = authenticated AND activeMembershipIfOrg AND permission AND resourceScope AND resourceState AND eligibility AND noFreeze AND separationOfDuties`.

الفحص مطلوب في list/detail/export/mutation/jobs/download، وليس endpoints الكتابة فقط. default deny. ممنوع الثقة بـorgId أو userId القادمين من الواجهة دون تطابق العضوية. البحث العام يستخدم projection عامة فقط.

## حالات الحساب

invited → active → suspended → closed. التوثيق independently: not_started → submitted → in_review → changes_requested / verified / rejected → expired. إيقاف حساب لا يمحو التزاماته أو قيوده. الجلسات تُلغى فور إزالة عضوية أو تعليق المستخدم. دعوة الفريق token أحادي الاستخدام منتهي الصلاحية، والقبول يلزم تطابق هوية البريد المدعو.

## اختبارات إلزامية

عضو جهتين لا يقرأ مستند جهة أخرى بتبديل ID؛ صاحب دفعة لا يعتمدها بتبديل الدور؛ إعادة دعوة مستخدم موقوف لا تعيد صلاحياته؛ رابط ملف مُوقع يفشل بعد انتهاء صلاحيته؛ تغيير قدرة الفرد Investor لا يمنحه أهلية؛ Sponsor يرى أثر برنامجه دون ملفات المتدربين الخاصة.
