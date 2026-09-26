# ویانور | Vianoor

پلتفرم چندزبانهٔ مشاوره، پاسخ‌گویی دینی و منبر آنلاین.

**مرحلهٔ ۳ از ۲۰: رابط دو زبانه و واکنش‌گرا.** این نسخه پایهٔ قابل اجراست؛ ورود، رزرو، پرداخت و تماس هنوز قابلیت عملیاتی ندارند.

## اجرای توسعه

پیش‌نیاز: Node.js `24.19.0` و npm `11.9.x`. نسخه‌های وابستگی در `package-lock.json` تثبیت شده‌اند.

```bash
git clone --branch stage/03-responsive-ui https://github.com/ostaddehdari/vianoor.git
cd vianoor
npm ci
npm run build:packages
```

در سه ترمینال جداگانه:

```bash
npm run dev:web
npm run dev:admin
npm run dev:gateway
```

| برنامه               | نشانی                             |
| -------------------- | --------------------------------- |
| وب فارسی             | http://127.0.0.1:3000/fa          |
| وب انگلیسی           | http://127.0.0.1:3000/en          |
| محیط کارکنان فارسی   | http://127.0.0.1:3001/fa          |
| محیط کارکنان انگلیسی | http://127.0.0.1:3001/en          |
| سلامت process درگاه  | http://127.0.0.1:4100/health/live |

bind پیش‌فرض localhost است. اجرای Docker و سلامت وابستگی‌ها در راهنمای مرحلهٔ ۲ آمده است. برای هر سرویس دیگر: `npm run dev --workspace @vianoor/identity-service`؛ پورت در [کاتالوگ سرویس‌ها](docs/architecture/service-catalog.json).

پس از تغییر package مشترک، `npm run build:packages` را مجدداً اجرا کنید؛ watcher سرویس فقط خروجی ساخته‌شدهٔ خودش را اجرا می‌کند. `.env.example` راز واقعی ندارد؛ runtime سرویس env را خودکار از فایل نمی‌خواند. روش تنظیم در README همان سرویس آمده است.

## بررسی نسخه

```bash
npm run format:check
npm run check
npm run smoke
npm audit --omit=dev --audit-level=high
```

`check` شامل کنترل معماری، lint، آزمون‌ها، build و typecheck است. `smoke` بعد از build، هر ۳۲ سرویس و هر دو برنامهٔ production را اجرا و متوقف می‌کند. در مرحلهٔ ۱، liveness پاسخ ۲۰۰ و readiness عمداً پاسخ ۵۰۳ می‌دهد.

## ساختار و اسناد

| مسیر                       | محتوا                                               |
| -------------------------- | --------------------------------------------------- |
| `apps/web`                 | عمومی، مراجعه‌کننده و استاد؛ فعلاً صفحهٔ پایه fa/en |
| `apps/admin`               | محیط کارکنان؛ فعلاً صفحهٔ پایه fa/en                |
| `services`                 | ۳۲ سرویس NestJS مستقل                               |
| `packages/contracts`       | schemaهای فنی API، event، پول و تنظیمات AI          |
| `packages/service-runtime` | runtime فنی Nest؛ بدون منطق مشترک دامنه             |
| `packages/ui`              | ترجمه، token و اجزای پایه مطابق سبک ماکاپ‌ها        |
| `python-services`          | محل کارهای FastAPI مرحلهٔ ۱۸؛ هنوز اجرا نمی‌شوند    |
| `infrastructure`           | قرارداد زیرساخت مرحلهٔ ۲                            |

- [گزارش تحویل مرحلهٔ ۱](docs/stages/01-foundation.md)
- [معماری و مرز سرویس‌ها](docs/architecture/overview.md)
- [مدل permission و سازمان](docs/architecture/authorization.md)
- [۷ تصمیم معماری](docs/adr)
- [برنامهٔ ۲۰ مرحله‌ای](docs/roadmap/20-stages.md)
- [ردیابی ۱۱۲ نیازمندی](docs/roadmap/traceability.md)
- [نقشهٔ ۱۹۲ صفحه/نما](docs/design/pages.md)
- [مبنای طراحی](docs/design/design-system.md)
- [OpenAPI اجرایی](docs/contracts/openapi.json) و [قراردادهای آینده](docs/contracts/core-api-draft.md)
- [قرارداد رویداد](docs/contracts/events.md)
- [راهبرد آزمون](docs/testing/strategy.md)

## اصول ثابت

میکروسرویس از ابتدا، دیتابیس و credential مستقل، عدم query بین پایگاه‌ها، رویداد نسخه‌دار با Outbox/Inbox، پول بدون float، زمان UTC، دسترسی permission-based، AI فقط از Gateway، پیام‌رسان مستقل از رسانه و فارسی/انگلیسی در تمام محصول.

ورود اصلی ایمیل/رمز است. GapGPT ارائه‌دهندهٔ اولیهٔ AI با آدرس، secret و مدل قابل تنظیم خواهد بود؛ اتصال واقعی در مرحلهٔ ۷ است. کلید واقعی در Git ثبت نمی‌شود.

تاریخچه با کامیت‌های فارسی در شاخه‌های مرحله‌ای نگه‌داری می‌شود؛ روش ادغام merge commit است تا کامیت‌های جزئی حفظ شوند.

## زیرساخت مرحلهٔ ۲

Docker Compose، PostgreSQL با ۳۱ پایگاه و نقش مستقل، Redis، NATS JetStream، Outbox/Inbox و رهگیری درخواست در شاخهٔ مرحلهٔ ۲ اضافه شده‌اند. راه‌اندازی و محدودیت‌ها: [راهنمای مرحلهٔ ۲](docs/stages/02-infrastructure.md). این تغییر صفحات داشبورد یا ورود واقعی را فعال نمی‌کند و تنظیمات اختصاصی سرور را شامل نمی‌شود.

## رابط مرحلهٔ ۳

صفحهٔ اول جدید، صفحات عمومی و گالری ۱۲ داشبورد با فونت وزیر و Font Awesome. پس از اجرای وب، `/fa/dashboards` یا `/en/dashboards` را باز کنید. این صفحات پیش‌نمایش با دادهٔ نمونه هستند. [راهنمای مرحلهٔ ۳ و مسیرها](docs/stages/03-responsive-ui.md).
