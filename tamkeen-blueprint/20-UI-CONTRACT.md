# 20 — عقد كل صفحة وإجراء

## كيف تقرأ سجل الشاشات

كل صفحة لها ID ومسار وسياق وبيانات وأفعال معرفّة. صيغة Action ID هي `PAGE-ID.ANN`. كل فعل يشير permission أو `public` أو `self`. `/api/v1` محذوفة للاختصار. `NAV` انتقال ويب، `LOCAL` عملية واجهة دون كتابة خادم، `GET` قراءة، وبقية methods mutations.

كل إجراء يرث القواعد التالية، وتذكر صفحته الشروط والنتيجة الخاصة. إذا كانت صلاحية جديدة غير موجودة في [02](02-IDENTITY-ROLES-PERMISSIONS.md)، يجب تعريفها قبل التنفيذ ولا تحويلها إلى admin wildcard.

## أزرار عامة موروثة وليست مجهولة

| ID | الزر | مالك/شرط | السلوك والفشل |
|---|---|---|---|
| GLOBAL-01 | شعار تمكين | public | NAV /؛ لا mutation |
| GLOBAL-02 | تغيير اللغة | public | LOCAL locale + URL؛ حفظ query وعدم فقد مسودة مع تنبيه |
| GLOBAL-03 | تبديل السياق | عضو/self | POST /me/context؛ إعادة صلاحيات/cache؛ 403 يبقى بالسياق القديم |
| GLOBAL-04 | فتح القائمة/إغلاقها | public | LOCAL focus trap في drawer وإعادة focus |
| GLOBAL-05 | إشعارات | self | NAV /app/notifications؛ unread من الخادم |
| GLOBAL-06 | خروج | authenticated | POST /auth/logout؛ إلغاء session ثم NAV / |
| GLOBAL-07 | بحث/تصفية | قارئ الصفحة | GET collection + query URL؛ إلغاء request قديم، 0 نتائج مع reset |
| GLOBAL-08 | مسح الفلاتر | قارئ الصفحة | LOCAL reset query وإعادة GET؛ لا محو تفضيلات أخرى |
| GLOBAL-09 | التالي/السابق | قارئ قائمة | GET cursor؛ disabled حسب hasMore/history |
| GLOBAL-10 | إعادة المحاولة | قارئ/منفذ مخول | إعادة read؛ write تستخدم نفس idempotency key ولا تعاد unknown payment عميانيًا |
| GLOBAL-11 | إلغاء/رجوع | صاحب نموذج | LOCAL confirm discard عند dirty ثم NAV آمن |
| GLOBAL-12 | حفظ مسودة | صاحب نموذج قابل للحفظ | POST/PATCH مورد الصفحة بversion؛ تظهر saved_at بعد نجاح فقط |
| GLOBAL-13 | رفع ملف/إزالة قبل الإرسال | إذن تعديل المورد | POST /documents/upload-intents ثم finalize؛ إزالة draft reference فقط؛ الحجر يمنع submit |
| GLOBAL-14 | تنزيل وثيقة | resource read + grant | GET /documents/:id/download؛ يعاد فحص الإذن وحالة الفحص؛ رابط مؤقت |
| GLOBAL-15 | تأكيد/تراجع dialog | مالك الفعل الأصلي | يرث method/permission/idempotency للفعل ولا يمنح إذنًا مستقلًا |
| GLOBAL-16 | إظهار كلمة المرور | صاحب الحقل | LOCAL toggle accessible؛ لا log ولا إرسال |
| GLOBAL-17 | إغلاق تنبيه | قارئ الصفحة | LOCAL؛ التنبيه الحاسم لا يختفي بما يوهم نجاحًا |
| GLOBAL-18 | فرز أعمدة | قارئ قائمة | GET sort allowlist؛ aria-sort وحفظ الفلاتر |
| GLOBAL-19 | فتح التفاصيل/تبويب | قارئ المورد | NAV route أو anchor/query؛ GET بيانات tab بعد إذن |

## حالات الصفحة الإلزامية

Loading skeleton يحافظ على الحجم؛ empty يوضح أول خطوة متاحة؛ error فيه requestId مختصر وإعادة محاولة؛ forbidden لا يعرض بيانات سابقة؛ not_found؛ offline يحافظ على المسودة ولا يدعي نجاح دفع؛ partial_data يفصل القسم المتعذر؛ pending_external يشرح التأكيد الخارجي؛ expired يوقف الفعل؛ conflict يتيح تحميل النسخة الأحدث ومقارنة مسودة المستخدم.

## عقد mutation

قبل: صلاحية وstate ومدخلات ونسخة صحيحة. أثناء: disable الزر ومنع double-submit مع إمكانية استعلام الحالة. بعد نجاح: تحديث cache المتأثر وإظهار نتيجة ورابط مرجع. فشل 422: خطأ عند الحقل وملخص أعلى النموذج مع focus. 409: refresh/review. 403: استرجاع صلاحيات. 503: احتفظ بالمدخلات. الإجراء المالي يؤكد status من الخادم، ويعرض processing إذا لم يتأكد المزود.

## confirmation semantics

تأكيد صريح داخل المنتج للصرف والاسترداد والاعتماد ونقل الملكية وتجميد وإلغاء مشروع وإرسال اكتتاب ملزم وقبول عرض عمل. الملخص يعرض الاسم والسياق والمبلغ والعملة والأثر وشروط الرجوع. عمليات التنقل والحفظ والفلترة لا تحتاج confirmation. هذه مواصفات سلوك التطبيق للمستخدم النهائي، وليست طلب موافقة إضافي من صاحب المشروع على كتابة الكود.

## التصدير

زر تصدير لا يعني كل الأعمدة؛ ينفذ export permission على نفس النطاق والفلاتر ويعرض عددًا تقديريًا وملفات منقحة. كل export job له حالة ready/failed/expired ورابط تنزيل مؤقت. يختبر formula injection وtenant isolation.

## قاعدة عدم الثغرات

سجل الشاشات يعرّف الصفحات المستهدفة في هذا الإصدار، والأزرار العامة تورث لهذه الصفحات عند انطباقها. أي زر أو menu item أو bulk action إضافي أثناء التصميم يحتاج صفًا جديدًا بالمعرف والشروط قبل اعتباره جزءًا مكتملًا. لا يمكن ادعاء حصر أي واجهة مستقبلية لم تُصمم بعد.
