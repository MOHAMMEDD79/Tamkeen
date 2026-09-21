# 10 — البنية التقنية واللغات

## القرار المقترح

**Frontend: TypeScript + React + Next.js App Router. Backend: TypeScript + NestJS. Database: PostgreSQL + SQL migrations، باستخدام Prisma للوصول الاعتيادي وSQL صريح للقيود والمعاملات المعقدة.**

هذا اختيار معماري للمنتج: الواجهات العامة تحتاج صفحات قابلة للفهرسة، واللوحات تحتاج مكونات تفاعلية مشتركة؛ الخادم يحتاج حدود نطاق وصلاحيات ومعاملات وعمال خلفية. TypeScript مشتركة تقلل تضارب DTOs، لكن لا تُشارك كيانات ORM مباشرة مع المتصفح. المظهر الاحترافي ينتج من نظام التصميم، لا من لغة برمجة بعينها.

Next.js يدعم بناء تطبيقات App Router وفق [توثيقه الرسمي](https://nextjs.org/docs). NestJS يشرح تنظيم التحقق من الأذونات باستخدام guards والـpermissions في [توثيق authorization](https://docs.nestjs.com/security/authorization). اختيار الجمع بينهما هنا اجتهاد معماري لهذه المنصة.

## البنية: modular monolith

خادم أعمال واحد بوحدات مستقلة: identity, organizations, projects, charity, investment, enablement, finance, verification, documents, notifications, support, analytics. PostgreSQL واحدة بعلاقات واضحة. worker منفصل للتشغيل الخلفي من نفس المستودع. لا microservices ولا event sourcing شامل في البداية؛ الدفتر وaudit append-only فقط.

```text
Browser → Next.js web → NestJS API → PostgreSQL
                             ├── Object storage adapter
                             ├── Payment / signing adapter
                             └── Outbox → worker → email / jobs / reconciliation
```

## توزيع العمل

- Next server components للقراءة العامة حسب الحاجة؛ client components للforms/maps/tables.
- Tailwind CSS مع tokens وCSS variables ومكونات accessible؛ لا نسخ صفحة قالب جاهز كهوية المنتج.
- React Hook Form + Zod للنماذج؛ خادم يعيد التحقق مستقلًا.
- TanStack Query لطلبات اللوحات وتحديث caches وفق tenant/context. لا optimistic update للأرصدة أو التخصيص.
- REST OpenAPI لتوليد client types؛ DTOs منفصلة عن entity.
- PostgreSQL للمعاملات؛ Redis/BullMQ للمهام القابلة للإعادة عند المرحلة الخلفية، مع بقاء outbox في PostgreSQL مصدر التسليم الموثوق.
- S3-compatible object storage وMailpit محليًا. PaymentSimulator داخل adapter واضح.
- جلسات opaque في cookie HttpOnly Secure بالإنتاج، SameSite وسياسة CSRF للكتابة. لا access tokens طويلة في localStorage.
- وحدة authentication تتصل بمكتبة/مزود ناضج عند التنفيذ؛ لا تكتب تشفير كلمات المرور أو بروتوكول استرداد من الصفر.

## هيكل المستودع المستهدف

```text
apps/web/                 # Next.js
apps/api/src/modules/     # NestJS bounded modules
apps/worker/              # scheduled jobs / queues
packages/ui/              # tokens + accessible components
packages/contracts/       # generated API client + schemas
packages/config/          # TS, lint, test config
packages/test-fixtures/   # factories, provider simulator scenarios
database/                 # schema, migrations, seed
infra/                    # compose, deployment examples
docs/adr/                 # verified architecture decisions
tamkeen-blueprint/        # هذه المواصفات والتقدم
```

## حدود الوحدات

Charity لا يكتب ledger مباشرة؛ يستدعي Finance command. Investment لا ينشئ holding قبل Allocation service. Programs لا يصرف stipend من تحديث attendance؛ ينشئ استحقاقًا قابلًا للمراجعة. Notifications لا تقرر نجاح عملية. Analytics قراءة من projections لا تحكم قبولًا أو صرفًا.

## حماية تعدد الجهات

كل query داخل org يمر tenant scope على الخادم. يمكن إضافة PostgreSQL RLS كدفاع ثانٍ بعد ضبط أدوار الاتصال والسياق داخل transaction؛ فهي تسمح بسياسات صفوف كما يوضح [توثيق PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). لا تفترض أن table owner أو connection pool يطبق العزل تلقائيًا؛ اختبر bypass roles وتسرب سياق الاتصالات.

## الإصدارات

أرقام الإصدارات الدقيقة تثبت في PART-01 بعد فحص وثائق official compatibility وتوفر بيئة المستخدم. استخدم stable supported، lockfile واحد وpackage manager محدد. لا تبدأ upgrade كبيرًا في منتصف مرحلة دون ADR. الجوال responsive web أولًا؛ React Native ممكن لاحقًا عبر API، وليس شرطًا قبل إثبات المسارات.
