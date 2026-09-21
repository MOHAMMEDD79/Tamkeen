# 11 — عقود API

Base: `/api/v1`. مسارات الشاشات تنتمي للويب، ومسارات الأفعال الواردة في سجل الإجراءات تضاف إلى هذا الأساس. JSON UTF-8. cookie session؛ CSRF mutations؛ التحقق من permission + ownership + state على كل endpoint.

## Envelope

نجاح مفرد: `{ data, meta: { requestId, version? } }`. قائمة: `{ data: [], page: { nextCursor, hasMore }, meta }`. خطأ: `{ error: { code, message, fieldErrors?, requestId, retryable } }`. لا stack trace ولا أسرار أو هوية خاصة في الخطأ.

أكواد: 400 malformed، 401 unauthenticated، 403 forbidden، 404 absent/hidden، 409 state_conflict/idempotency_conflict/version_conflict/capacity_exceeded، 422 validation/eligibility_failed، 429 rate_limited مع Retry-After، 503 provider_unavailable. النجاح 201 لإنشاء و200 لقراءة/transition. عمليات async ترجع 202 وoperationId قابلًا للاستعلام.

## عقود الكتابة

كل mutation مالية تحتاج `Idempotency-Key`; حفظ key مع actor + route + request_hash + response. نفس key/body يعيد نفس النتيجة، body مختلف =409. retry يعيد نفس key. `If-Match`/version للتحرير؛ تضارب يعرض مقارنة واسترجاع أحدث نسخة. لا client-supplied status: الانتقالات commands صريحة.

```json
{
  "campaignId": "uuid",
  "amountMinor": "10000",
  "currency": "ILS",
  "publicVisibility": "anonymous",
  "showAmountPublicly": false,
  "policyVersion": 3,
  "payerPartyId": "uuid"
}
```

استجابة إنشاء contribution تعيد contributionId, paymentIntentId, status, providerRedirectUrl إلى domain مسموح، expiresAt. السعر والرسوم وسياسة المشروع يعاد حسابها والتحقق منها بالخادم. عند تغير quote يجب إقرار جديد قبل إرسال الدفع.

## مجموعات endpoints

| النطاق | قراءة | كتابة وانتقالات |
|---|---|---|
| Auth | GET /me، /sessions | POST /auth/register، /auth/login، /auth/logout، /auth/recovery، /auth/reset، /auth/verify، /sessions/:id/revoke |
| ملف | GET /me/profile، /me/capabilities | PATCH /me/profile؛ POST /me/capabilities؛ PATCH /me/preferences |
| جهات | GET /organizations، /organizations/:slug، /orgs/:id | POST /orgs؛ PATCH /orgs/:id؛ POST /orgs/:id/invitations؛ PATCH /orgs/:id/members/:uid |
| سياق | GET /me/contexts | POST /me/context؛ POST /invitations/:token/accept |
| توثيق | GET /orgs/:id/verification | POST /orgs/:id/verification/submissions؛ POST /admin/verifications/:id/decision |
| مشاريع | GET /projects، /projects/:slug، /map/projects | POST /orgs/:id/projects؛ PATCH /orgs/:id/projects/:pid؛ POST .../:pid/submit، /pause، /close |
| محتوى | GET /projects/:id/updates، /reports، /contributors | POST /orgs/:id/projects/:pid/updates؛ POST .../reports؛ POST /admin/projects/:pid/decision |
| تبرعات | GET /me/contributions، /me/contributions/:id | POST /contributions؛ PATCH /me/contributions/:id/privacy؛ POST /contributions/:id/refund-requests |
| مال | GET /orgs/:id/finance/summary، /ledger، /payouts | POST /orgs/:id/payouts؛ POST /payouts/:id/approve؛ POST /admin/payouts/:id/execute |
| استرداد | GET /refunds/:id | POST /refunds/:id/approve؛ POST /admin/refunds/:id/execute |
| مزود | GET /payment-intents/:id/status | POST /webhooks/payments/:provider؛ POST /admin/reconciliation/imports |
| استثمار | GET /offerings، /offerings/:id، /me/investments | POST /orgs/:id/offerings؛ PATCH /orgs/:id/offerings/:oid؛ POST /offerings/:id/commitments |
| أهلية | GET /me/investor-eligibility | POST /me/investor-eligibility/submissions؛ POST /admin/eligibility/:id/decision |
| إغلاق عرض | GET /orgs/:id/offerings/:oid/allocations | POST /orgs/:id/offerings/:oid/submit، /close؛ POST /admin/offerings/:id/decision، /allocations/finalize |
| التزام | GET /me/commitments/:id | POST /commitments/:id/confirm، /cancel، /payment-intents |
| مستندات استثمار | GET /offerings/:id/dataroom | POST /offerings/:id/access-requests؛ POST /offerings/:id/nda-acceptances؛ POST /offerings/:id/questions |
| تقارير وتوزيعات | GET /me/holdings، /me/distributions | POST /orgs/:id/company-reports؛ POST /orgs/:id/distributions؛ POST /distributions/:id/approve |
| برامج | GET /programs، /programs/:id | POST /orgs/:id/programs؛ PATCH /orgs/:id/programs/:pid؛ POST .../:pid/submit، /publish، /close |
| تقديم | GET /me/applications، /me/applications/:id | POST /applications؛ PATCH /applications/:id؛ POST /applications/:id/submit، /withdraw |
| اختيار | GET /orgs/:id/applications | POST /orgs/:id/applications/:aid/decision؛ POST .../:aid/interviews؛ POST /enrollments/:id/accept |
| تدريب | GET /me/enrollments، /orgs/:id/cohorts/:cid | POST /orgs/:id/cohorts؛ PUT /cohorts/:id/sessions/:sid/attendance؛ POST /assessments/:id/results |
| بدلات وشهادة | GET /me/stipends، /certificates/:publicId | POST /stipends/batches؛ POST /certificates؛ POST /certificates/:id/revoke |
| وظائف | GET /jobs، /jobs/:id | POST /orgs/:id/jobs؛ PATCH /orgs/:id/jobs/:jid؛ POST .../:jid/publish، /close |
| عرض وظيفي | GET /me/job-offers/:id | POST /orgs/:id/job-offers؛ POST /job-offers/:id/accept، /decline |
| توظيف | GET /me/placements، /orgs/:id/placements | POST /placements؛ POST /placements/:id/start-confirmations؛ POST /placements/:id/followups |
| أفكار | GET /me/proposals، /orgs/:id/proposals | POST /proposals؛ PATCH /proposals/:id؛ POST /proposals/:id/submit؛ POST /orgs/:id/proposals/:pid/decision |
| رعاية/شراكة | GET /orgs/:id/agreements | POST /orgs/:id/agreements؛ POST /agreements/:id/accept؛ POST /agreements/:id/milestones/:mid/decision |
| مساعدة/تطوع | GET /me/assistance، /volunteer-opportunities | POST /assistance؛ POST /assistance/:id/replies؛ POST /volunteer-applications؛ POST /volunteer-hours |
| مشترك | GET /me/notifications، /me/bookmarks، /tickets/:id | POST /bookmarks، /follows، /tickets؛ DELETE /bookmarks/:id، /follows/:id؛ POST /notifications/:id/read؛ POST /tickets/:id/replies |
| ملفات | GET /documents/:id/download | POST /documents/upload-intents؛ POST /documents/:id/finalize |
| إدارة | GET /admin/audit، /admin/queues | POST /admin/subjects/:id/freeze، /unfreeze؛ POST /admin/reports/:id/decision |

هذه سطح العقود المخطط؛ أثناء التنفيذ يثبت كل DTO وOpenAPI schema قبل ربط الشاشة، وتضاف أي تفاصيل ناقصة مع معرف الإجراء. لا تكفي تسمية endpoint لإعلان اكتمال تنفيذه.

## pagination وexports

cursor مستقر مع id tie-breaker، limit default 20 maximum 100، فلاتر allowlist. البحث لا يمرر SQL من العميل. exports الكبيرة async job مع snapshot/filter metadata، صلاحية تُعاد عند التنزيل، رابط مؤقت، تدقيق، وحماية CSV formula injection. لا تصدر بيانات حساسة افتراضيًا.

## عقود الخدمات الخارجية

PaymentPort: createIntent/getStatus/refund/createPayout/getSettlementReport/verifyWebhook. SigningPort: createEnvelope/getStatus/verifyEvent. StoragePort: createUpload/scan/createDownload. MessagingPort: sendTemplate. لكل port fake محلي وcontract tests وtimeouts/retries وحدود sandbox/production منفصلة.
