# مرحلهٔ ۲ — زیرساخت اجرایی

این مرحله منطق ورود، رزرو، پرداخت یا داشبورد را فعال نمی‌کند. وب نصب‌شدهٔ مرحلهٔ ۱ مستقل می‌ماند.

## اجرا

پیش‌نیاز: Docker Engine و Compose v2؛ برای آماده‌سازی Node مطابق `.nvmrc`.
از ریشهٔ یک checkout جدید شاخهٔ `stage/02-infrastructure`:

```bash
npm run infra:prepare
npm run infra:up
npm run infra:test
npm run infra:restart-test
```

`infra:prepare` رمزهای تصادفی مستقل می‌سازد و اگر `infra/local` موجود باشد متوقف می‌شود؛ رمزهای موجود را بازنویسی نکنید. این پوشه در Git و Docker build context قرار نمی‌گیرد. مجوز پوشه 0700 است؛ فایل‌های mountشده برای کاربران داخلی کانتینر خواندنی‌اند و envها 0600 هستند. نسخهٔ پشتیبان رمزها همراه نسخهٔ پشتیبان volumeها در محل امن لازم است. این ابزار برای provisioning نخستین volume خالی است؛ SQL init روی volume موجود دوباره اجرا نمی‌شود.

Compose پروژهٔ مستقلی به نام `vianoor-stage2` دارد؛ فقط Gateway به `127.0.0.1:18871` متصل است. اگر پورت اشغال باشد `VIANOOR_GATEWAY_PORT` را تنظیم کنید. PostgreSQL، Redis، NATS و سایر سرویس‌ها هیچ پورت عمومی ندارند. Compose هیچ Nginx، دامنه، SSH، بانک موجود یا کانتینر پروژهٔ دیگری را تغییر نمی‌دهد.

اجرای پیش‌فرض: PostgreSQL، Redis، NATS، identity-service و api-gateway. تمام ۳۲ سرویس:

```bash
docker compose -f infra/compose.json --profile all up -d --wait
```

اجرای همهٔ سرویس‌ها مصرف حافظهٔ بیشتری دارد؛ برای سرور مشترک ابتدا حالت پیش‌فرض کافی است. محدودیت هر پردازش سرویس 256MiB است. این اندازه‌گذاری آزمایش بار نیست.

## قرارداد سلامت و Gateway

- `/health/live`: زنده بودن فرایند؛ مستقل از وابستگی‌ها.
- `/health/infra`: 200 فقط پس از اتصال PostgreSQL همان سرویس، Redis و JetStream؛ هنگام قطعی 503. Gateway بانک ندارد.
- `/health/ready`: همچنان 503؛ آماده‌بودن زیرساخت به معنی آماده‌بودن کسب‌وکار نیست.
- `/api/v1/services/identity`: فقط GET metadata سرویس هویت، با مقصد ثابت و timeout؛ مسیر دلخواه یا عملیات دامنه پروکسی نمی‌شود.
- `traceparent` معتبر با trace ID مشترک منتقل می‌شود؛ مقدار نامعتبر جایگزین می‌شود. پاسخ خطا و هدر `x-trace-id` همان شناسه را دارند.
- log ساخت‌یافته شامل نام سرویس، روش، وضعیت و مدت درخواست است؛ query، بدنه، هدرهای محرمانه و payload رویداد ثبت نمی‌شوند.

## مالکیت داده و پیام

۳۱ database و role مستقل از کاتالوگ ساخته می‌شود. نقش‌ها superuser، createdb یا createrole نیستند؛ CONNECT عمومی از تمام بانک‌های سرویس و بانک‌های مدیریتی برداشته می‌شود. هر سرویس فقط credential خودش را می‌گیرد. مالک database در این مرحله مالک migration فنی نیز هست؛ تفکیک نقش migration از runtime برای سخت‌سازی تولید بعدی لازم است.

migration فنی idempotent با advisory lock، جدول‌های `infra_outbox` و `infra_inbox` را فقط در بانک همان سرویس می‌سازد. schema دامنه همچنان به سرویس مربوط تعلق دارد.

`transaction` و `enqueue` باید همراه تغییر دامنه در یک تراکنش استفاده شوند. relay هر ثانیه batch محدود را با `FOR UPDATE SKIP LOCKED` می‌خواند؛ تنها بعد از publish acknowledgment وضعیت ارسال ثبت می‌شود. شکست ارسال پنج ثانیه بعد مجدداً تلاش می‌شود. رویدادها با قرارداد نسخه‌دار اعتبارسنجی می‌شوند و producer باید با سرویس مطابقت داشته باشد.

JetStream دارای ذخیرهٔ فایل، سقف 512MiB و نگهداری هفت روز است؛ راهکار آرشیو نیست. پنجرهٔ dedup دو دقیقه است؛ Inbox با کلید `(consumer,event_id)` از تکرار اثر در پایگاه داده مستقل از آن پنجره جلوگیری می‌کند. `processMessage` فقط پس از commit ACK می‌دهد؛ شکست به NAK با تأخیر منجر می‌شود. handler فقط همان بانک را تغییر می‌دهد؛ ارسال خارجی باید Outbox جدید بسازد. مصرف‌کنندهٔ durable با ACK صریح را سرویس مالک ایجاد می‌کند؛ این مرحله مصرف‌کنندهٔ کسب‌وکار جعلی ندارد. poison message، DLQ، retention Inbox و تضمین ترتیب aggregate باید هنگام تعریف مصرف‌کنندهٔ دامنه مشخص شوند.

Redis دارای AOF و NATS دارای volume پایدار است. اجرای فعلی تک‌گره و شبکهٔ داخلی بدون TLS است؛ مناسب پایهٔ توسعه و آزمون روی یک میزبان. توکن مشترک NATS و credential مشترک Redis مرز tenant نیستند؛ ACL موضوعی و کلیدمحور قبل از استقرار تولید چندمستأجری لازم است. رهگیری فعلی propagation و log است، نه سامانهٔ کامل OpenTelemetry و داشبورد metrics.

## آزمون و توقف

`npm run check` و `npm run smoke` آزمون‌های محلی مخزن هستند. workflow مستقل `Infrastructure integration` کانتینر واقعی می‌سازد و موارد زیر را بررسی می‌کند:

- مجوز CONNECT تمام جفت‌های ۳۱ بانک/role و رد اتصال واقعی به بانک دیگری؛
- rollback Outbox، publish واقعی JetStream، Inbox همزمان و عدم تکرار اثر؛
- redelivery مصرف‌کنندهٔ durable و ACK پس از commit؛
- Redis و انتقال trace از Gateway به سرویس هویت؛
- قطعی Redis/NATS، باقی‌ماندن liveness، بازیابی سلامت و پایداری رکورد PostgreSQL بعد از restart.

آزمون integration به credentialهای همهٔ سرویس‌ها دسترسی دارد و فقط در کانتینر test و محیط اختصاصی آزمون اجرا شود. `infra:restart-test` وابستگی‌های همین Compose را موقتاً متوقف می‌کند؛ روی سرویس در حال استفاده اجرا نکنید.

```bash
npm run infra:stop
# شروع دوباره با حفظ داده‌ها:
docker compose -f infra/compose.json up -d --wait
```

از `down -v` در سرور دارای داده استفاده نکنید؛ این دستور فقط در CI موقتی استفاده می‌شود. rollback کد با image قبلی و حفظ volumeها انجام می‌شود؛ این مرحله migration تخریبی ندارد. آزمون restore کامل در مرحلهٔ ۲۰ انجام خواهد شد.

تنظیمات اختصاصی `srun.ir/vianoor` و کلید SSH عمداً در این تغییر نیستند.

## منابع تصمیم فنی

- https://www.postgresql.org/docs/17/ddl-priv.html
- https://docs.nats.io/nats-concepts/jetstream/consumers
- https://docs.nats.io/using-nats/developer/develop_jetstream/model_deep_dive

## شواهد اجرا

- بررسی محلی `npm run check`: موفق؛ ۱۵ آزمون، build و typecheck تمام workspaceها و کنترل مرز سرویس.
- `npm run smoke`: موفق؛ ۳۲ سرویس و مسیرهای فارسی/انگلیسی هر دو برنامه.
- `npm audit --omit=dev --audit-level=high`: صفر آسیب‌پذیری گزارش‌شده.
- [اجرای واقعی Docker در GitHub Actions](https://github.com/ostaddehdari/vianoor/actions/runs/36218279036): موفق؛ image، Compose، DB isolation، پیام تکراری، trace و restart. این اجرا مربوط به کامیت `66c7cf6` است؛ گسترش آزمون پایداری Redis/JetStream در کامیت بعدی نیز در workflow اجرا خواهد شد.
- هیچ آزمون یا نصب مرحلهٔ ۲ روی سرور شخصی کاربر توسط این محیط انجام نشده است.
