# بوابات الإطلاق والفجوات الخارجية

الحالة الحالية **demo محلي فقط**. نجاح الاختبارات لا يجيز إطلاق المال الحقيقي.

| البوابة | الحالة | المطلوب قبل الإنتاج |
|---|---|---|
| الكيان والبلد والتنظيم | BLOCKED_EXTERNAL | تحديد الكيان المشغل، البلدان، التراخيص والاحتفاظ والقاصرين |
| الدفع والحفظ | BLOCKED_EXTERNAL | مزود sandbox/production، من يحفظ المال، الرسوم والاسترداد، webhook keys وتسوية مثبتة |
| الاستثمار والملكية | BLOCKED_EXTERNAL | أداة الاستثمار، أهلية المستثمر، جهة سجل الملكية والتوقيع |
| البريد | BLOCKED_EXTERNAL | مزود إرسال، DNS، suppression/bounce policy وSLA |
| الخرائط | BLOCKED_EXTERNAL | مزود وترخيص tiles وسياسة geolocation |
| التخزين | BLOCKED_EXTERNAL | bucket مع تشفير وversioning وretention وفحص malware |
| الاستضافة | BLOCKED_EXTERNAL | بيئات وحسابات ومفاتيح منفصلة، TLS/domain، secret store ومراقبة |
| backup/PITR | LOCAL_REHEARSED | اختيار خدمة، نسخ مشفرة، قياس RPO/RTO فعلي في staging |
| المال الحقيقي | OFF | يبقى `MONEY_ENABLED=false` و`INVESTMENT_ENABLED=false` حتى توقيع كل ما سبق |

لا تُحوّل flags إلى true لمجرد أن demo يعمل. يجب تكرار payment sandbox E2E وwebhook/reconciliation وrestore في staging ببيانات اختبار قبل قرار الإطلاق.
