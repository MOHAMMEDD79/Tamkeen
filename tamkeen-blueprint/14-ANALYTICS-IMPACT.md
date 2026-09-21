# 14 — الأرقام والأثر

| المؤشر | التعريف | مصدره | استبعاد/قيد |
|---|---|---|---|
| إجمالي مساهمات | succeeded contributions gross | الدفع المؤكد | المعلق مستبعد |
| صافي تمويل | gross - confirmed refunds | دفتر/مدفوعات | الرسوم تعرض مستقلًا |
| متاح للصرف | settled liabilities - active holds | ledger projection | لا يساوي صافي تمويل |
| نسبة هدف | net confirmed / goal ×100 | campaign snapshot | وضح overfund إن سمح |
| إنجاز مشروع | مراحل متحقق منها بأوزان معلنة | milestones approvals | لا يتبع نسبة المال |
| مستفيدون موثقون | أشخاص فريدون بدعم مثبت ضمن النطاق | aid_deliveries | لا تجمع شخصًا مكررًا كفريد |
| استثمار ملتزم | commitments صالحة | commitments | ليس مالًا مقبوضًا |
| استثمار مخصص | allocation مثبت × سعره | allocations | ليس قيمة سوقية |
| توزيعات فعلية | paid distributions | ledger + provider proof | المقترح مستبعد |
| إكمال تدريب | completed / confirmed enrollments | enrollments | المنسحب ضمن المقام مع شرح |
| بدء توظيف | placements started verified | placements | offer accepted مستبعد |
| احتفاظ 90 يومًا | retained confirmed / eligible started cohort | followups | unknown تعرض كنسبة مستقلة |
| تكلفة نتيجة | program settled spend / verified results | ledger + outcomes | المقام صفر يعرض غير متاح |

كل widget يملك asOf وcurrency وdate range وfilter definition ورابط المصدر. الفلاتر الزمنية توضح هل التاريخ دفع أم تسوية أم بداية عمل. لا تعد private pending payments في إجمالي عام. projection eventual consistency تعرض «آخر تحديث»؛ صفحة تأكيد المال تستعلم المصدر.

## أحداث الاستخدام

project_viewed, filter_applied, contribution_started, payment_confirmed, offering_disclosure_viewed, commitment_created, application_submitted, enrollment_confirmed, placement_started. payload: معرف مجهول جلسي، نوع الصفحة، نوع المسار، timestamp؛ لا محتوى نماذج أو وثائق. لا تعتبر payment_redirected conversion.

## تقارير الراعي

الأهداف/الفعل، الميزانية/الصرف، الانحراف وأسبابه، تقدم كل دفعة، توظيف مباشر ومستقل، unknown، مخاطر، خطة تصحيح. مشاركة خارجية من snapshot منقح، مع version وتاريخ. لا يظهر GPA أو ملف هوية متدرب ضمن أثر تمويل مؤسسة.

## المطابقة

المرحلة الأولى قواعد فلاتر ومهارات وموقع وتوفر؛ أظهر سبب المطابقة «يتوافق مع مهارتين وموقعك المختار». المستخدم يستطيع تغيير الفلاتر. لا AI يلغي طلبًا أو يحجب مستفيدًا. أي نموذج مستقبلي يحتاج dataset governance وتقييم تحيز واعتراض بشري منفصل قبل تفعيله.
